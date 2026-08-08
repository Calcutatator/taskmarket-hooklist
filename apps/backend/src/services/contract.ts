// Implements: ADR-0055
// Implements: ADR-0075
import {
  parseAbi,
  parseAbiItem,
  decodeEventLog,
  keccak256,
  encodeFunctionData,
  ContractFunctionRevertedError,
  BaseError,
  type Log,
} from 'viem';
import { TRPCError } from '@trpc/server';
import { createServerWallet, dispatchServerWalletTransaction } from '../lib/wallet';
import { ServerTransactionPendingError } from '../lib/server-transaction-dispatcher';
import { UndeterminedRelayError, classifyRelayFailure } from '../lib/relay-failure';
import { getPublicClient, runWithRpcApplicationAttempt } from '../lib/rpc-gateway';
import { getServerConfig } from '../config/env';
import { SETTLEMENT_READ_ABI, TASK_COMPLETED_EVENT } from './settlement-contract';
import { currentRelayEnvelope, currentRelayOutboxLink, newRelayEnvelope } from './relay-envelope';
import { computeRelayReceiptHash } from './relay-receipt';
import {
  projectSettlementLogs,
  toSettlementCompletionLogs,
  type EventLog,
  type ProjectedSettlement,
  type SettlementChainState,
} from './settlement-projector';

// Map known 4-byte selectors to human-readable error names
const KNOWN_ERRORS: Record<string, string> = {
  '0xfe894217': 'TaskNotOpen',
  '0x1a3daf1f': 'TaskIsExpired',
  '0x1b42f1bf': 'TaskIsCancelled',
  '0xbb1ed08e': 'TaskAlreadyAccepted',
  '0xda319dff': 'TaskDoesNotExist',
  '0xe39da59e': 'NotRequester',
  '0xfb55adaf': 'NotWorker',
  '0x504e2b37': 'BidsExist',
  '0x88f82d67': 'SubmissionsExist',
  '0xe6919d76': 'SubmissionAlreadyRejected',
  '0x4188e885': 'NoActiveSubmissions',
  '0x5f86f09d': 'BidDeadlinePassed',
  '0xa00cee25': 'BidDeadlineNotPassed',
  '0x45db67c0': 'PitchDeadlinePassed',
  '0xabbfac0d': 'TaskNotClaimed',
  '0x86e9980a': 'TaskNotAccepted',
  '0xaa41dc9f': 'NotTrustedForwarder',
  '0x3ee5aeb5': 'ReentrancyGuardReentrantCall',
  '0xc9051603': 'InvalidWorker',
  '0xe4966367': 'InvalidRequester',
  '0x7bc4e046': 'DeliverableRequired',
  '0x0debe113': 'DeliverableAlreadySet',
  '0x646cf558': 'AlreadyClaimed',
  '0xef94626f': 'HookCheckSubmitRejected',
  '0xca46673e': 'HookCheckClaimRejected',
  '0xc6671ec1': 'HookCheckCompleteRejected',
  '0x3f79f31d': 'NoBidsSubmitted',
  '0x418108b9': 'WinnerNotSelected',
  '0xc5c36f76': 'WorkerMismatch',
  '0x579c5e17': 'DeliverableMismatch',
  '0xb579719d': 'AwardsExceedEscrow',
  '0x089087ea': 'SharesMustSumTo10000',
  '0xff633a38': 'LengthMismatch',
  '0x91edfffa': 'SubmissionNotFound',
  // Guard-level errors (LibTaskMarket) -- these fire before any facet-specific logic
  // runs, so they can surface on almost any relayed call, including createTask.
  '0xd93c0665': 'EnforcedPause',
  // createTask-specific validation (CoreFacet.createTask / _buildAndCheckHooks). These
  // decoded incorrectly as "unknown revert" before this map existed for them -- see the
  // 2026-07-24 createTask payment-orphan incident.
  '0xcc3440c9': 'RewardMustBeGreaterThanZero',
  '0xcf478f23': 'DurationMustBeGreaterThanZero',
  '0xa0042b17': 'InvalidMode',
  '0xba204b83': 'InvalidAuctionSubtype',
  '0xa2425099': 'StakeBpsTooHigh',
  '0x0cbb8fa2': 'PitchDeadlineMustBeGreaterThanZero',
  '0xe27d6e53': 'BidDeadlineMustBeGreaterThanZero',
  '0xde720534': 'TooManyHooks',
  '0x49b38860': 'DuplicateHookAddress',
  '0xaa5be784': 'InvalidHookAddress',
  '0xbc47aba9': 'HookCheckFundRejected',
  // Errors declared by contract revisions not yet deployed (rev016 escrow liability,
  // rev017 escrow/hook security). Mapped ahead of the upgrade on purpose: an unmapped
  // revert resolves to "unknown revert", which classifyRelayFailure treats as transient,
  // so the relayer hands the intent back and re-sends a call that can only revert again --
  // ADR-0047's unbounded loop, re-entered through a missing map entry. An entry for an
  // error the deployed Diamond cannot yet throw is inert, so it is safe to land first.
  '0xe6ac7a63': 'TaskAlreadyRefunded',
  '0x9a3bfd2b': 'NoRewardChange',
  '0x565a2ce0': 'EvaluatorCannotBeRequester',
  '0x1c8df436': 'DisputeResolverCannotBeRequester',
  '0x0c9b2c20': 'AppealWindowTooShort',
  '0x1a53131e': 'InvalidMinAppealWindow',
  // TaskMarketForwarder errors -- these come from relay() itself, before the call
  // ever reaches the Diamond, so they're exactly as reachable on any relayed call as
  // the Diamond-side errors above. FORWARDER_ABI (below) declares only the relay()
  // function, no error types, so viem can't decode these from that ABI either --
  // same "signature only, no errorName" situation this map exists to work around.
  '0x0b17c5d4': 'ReceiptAlreadyConsumed',
  '0x34d2712a': 'ReceiptExpired',
  '0x118a0502': 'ReceiptNotYetValid',
  '0xdb6a42ee': 'RelayFailed',
  '0x3c20627b': 'UnauthorizedRelayer',
  '0xe6c4247b': 'InvalidAddress',
  '0x6c87eb66': 'NoActiveForwardedCall',
  '0x21bbd70f': 'CalldataTooShort',
  // EvaluatorFacet -- evaluate/appeal/resolveDispute/evaluatorTimeout/rate.
  '0xd4ce3f2d': 'EvaluatorAlreadyAssigned',
  '0x46500a43': 'InvalidEvaluator',
  // Reachable from createTask as well as assignEvaluator since rev016, because the creation
  // path applies the same evaluator validation rather than a weaker copy of it.
  '0x663885fb': 'FeeBpsTooHigh',
  '0x83e2a1e8': 'WrongStatusForEvaluation',
  '0x7401943d': 'AppealWindowClosed',
  '0x06395591': 'AppealWindowStillOpen',
  '0xb285a583': 'NoVerdictIssued',
  '0x7a64de64': 'EvaluationWindowNotExpired',
  '0x0171222f': 'DisputeResolutionMustAwardWorkers',
  '0xcd217144': 'AwardsRequired',
  '0x82f5f0a4': 'NotInAppealingState',
  '0xcadc127f': 'NotInDisputedState',
  '0x62d7af0e': 'NotInReviewState',
  '0xed5ad759': 'NotDisputeResolver',
  '0x1740689d': 'UseEvaluate',
  '0x2095265c': 'HookCheckEvaluateRejected',
  '0x0e53e04d': 'InvalidAwardRecipient',
  '0x0371a99e': 'DuplicateAwardWorker',
  '0xccb51b2d': 'ZeroPayoutPerPair',
  '0x3728feb3': 'NoWinners',
  '0xca7a0355': 'WorkerAlreadyRated',
  '0xbdf7e3aa': 'RatingMustBe0To100',
  '0xc91959ac': 'NotEvaluator',
  // AuctionFacet -- bid/auctionAccept/selectLowestBidder.
  '0x5bf27b90': 'NotAnAuctionTask',
  '0x13f1714a': 'NotABidAuction',
  '0x32c10a01': 'NotAClockPriceAuction',
  '0xeaf4d9ee': 'BidExceedsMaxPrice',
  '0x208f4eee': 'BidLimitReached',
  '0x008c2864': 'PriceExceedsMaxPrice',
  '0x3583314c': 'ExpiryMustBeInFuture',
  '0xf38b1d59': 'BidDeadlineMustBeInFuture',
  '0x80b38ec9': 'PitchDeadlineMustBeInFuture',
  // Mode/state-check errors reachable across several CoreFacet functions.
  '0xc7512fa5': 'NotAClaimTask',
  '0x2f775ae6': 'NotAPitchTask',
  '0x71bcf3b2': 'NotABenchmarkTask',
  '0x8ffc2f7b': 'MultiSubmissionOnlyForBountyBenchmark',
  '0xc89c9972': 'EmptyPitchHash',
  '0xd2fee4b1': 'EmptyProofHash',
  '0xaea4a319': 'WorkerNotSelected',
  '0x5378dda1': 'WorkerRequired',
  '0xefd1521e': 'TaskNotYetExpired',
  // A refund that has already happened, and an update that changes nothing (ADR-0054). Both are
  // permanently true once true, so they must decode: an unmapped Diamond revert resolves to
  // 'unknown revert', which classifyRelayFailure treats as transient and therefore retries for
  // ever. Adding a custom error to a facet is not finished until it appears here.
  '0x128dbd39': 'HookCheckSelectWorkerRejected',
  // ADR-0054's two replay guards. These are the reverts a *rebroadcast* of tasks.refundExpired
  // or tasks.update lands on once the first attempt has already applied, so they are what makes
  // giving those two operations a broadcaster safe -- and they only work as guards if they are
  // decodable. An undecoded revert reaches classifyRelayFailure as "unknown revert", which it
  // deliberately reads as transient, so the worker would hand the intent straight back and
  // re-send a call that can only ever revert again -- ADR-0047's unbounded loop, re-entered
  // through a missing map entry. Decoded, the same revert is deterministic and terminal on the
  // first attempt.
  // Settlement/payout invariant failures -- internal transfer failures during
  // acceptance, cancellation, dispute resolution, or expiry refund.
  '0x56886241': 'WorkerPaymentFailed',
  '0x4033e4e3': 'FeeTransferFailed',
  '0xec0440fd': 'StakeReturnFailed',
  '0x55dce6a3': 'AuctionRefundFailed',
  '0xf0c49d44': 'RefundFailed',
  '0x00f094e5': 'ForfeitTransferFailed',
  '0x48c7b0bc': 'StakeTransferFailed',
  '0x25e2e459': 'EvaluatorPaymentFailed',
  '0x6db755e6': 'RequesterRefundFailed',
  '0x9c4f94bc': 'USDCRefundFailed',
  '0x6fd8d492': 'ExcessRefundFailed',
  '0xb40fbcfc': 'RewardIncreaseNotFunded',
  // Reward-hook errors (EpochBudget/RewardVault/TaskTokenRewardHook) -- only
  // reachable when a reward hook is actually configured on a task (DREAMS_HOOK_ADDRESS
  // et al.), but a relayed create/accept/etc. call routes through the hook check just
  // like any other Diamond-side validation, so these are just as undecodable against
  // FORWARDER_ABI as the rest of this map.
  '0x5a91834f': 'OnlyHook',
  '0x5ab718b9': 'EpochDurationZero',
  '0x41df58ee': 'CapExceedsUint192',
  '0xa15c414d': 'GlobalCapExceeded',
  '0x75eadc75': 'WorkerCapExceeded',
  '0x7f9315f7': 'RequesterCapExceeded',
  '0xef7b6850': 'TaskCapExceeded',
  '0xfffd3438': 'InsufficientAvailable',
  '0xe05df49f': 'InsufficientReserve',
  '0xd92e233d': 'ZeroAddress',
  '0x299dcf9a': 'ZeroRate',
  '0xd8a77c33': 'RewardAlreadyPaid',
  '0x24e2c082': 'RewardNotReserved',
  // Distinct from the no-arg WorkerMismatch() above -- same name, different args,
  // different selector (TaskTokenRewardHook's own mismatch check, not CoreFacet's).
  '0x1ba63587': 'WorkerMismatch',
  '0xf1c52981': 'NoWorkerFound',
  '0x36eab548': 'CallerNotDiamond',
  '0xa31c3dd0': 'NotBackend',
  '0x969bf728': 'NothingToClaim',
  '0xc6cc5d7f': 'InvalidBps',
  '0xb548366f': 'InvalidRamp',
  '0xdafb1235': 'InsufficientSweepable',
  // Deliberately NOT included: LibDiamond/Diamond admin errors (NotContractOwner,
  // FunctionNotFound, IncorrectFacetCutAction, etc.) and ITMPCore's constructor/init-only
  // validation (InvalidFeeRecipient, InvalidUSDCToken, InvalidForwarderAddress, ...) --
  // these only fire for an owner calling diamondCut/initialize directly, never through
  // relay(), so decodeRelayRevert (used only for relayed calls) can never see them.
};

/**
 * The revert reason this failure names, or `null` when none could be decoded.
 *
 * `null` rather than the old `'unknown revert'` string. That string was read by two different
 * audiences with two different meanings -- a caller saw it as the contract's stated reason, and
 * `classifyRelayFailure` saw it as the token meaning "no verdict, retry" -- and a value that
 * means both cannot be right for either. Here the absence of a reason is an absence, and each
 * caller says in its own words what it does about it.
 */
function decodeRelayRevert(err: unknown): string | null {
  if (err instanceof BaseError) {
    const revertError = err.walk((e) => e instanceof ContractFunctionRevertedError);
    if (revertError instanceof ContractFunctionRevertedError) {
      // Every relayed call is simulated/decoded against FORWARDER_ABI (the relay()
      // function), never MARKET_ABI -- but the actual revert data always originates
      // from the Diamond side (EnforcedPause, TaskNotOpen, etc.), which FORWARDER_ABI
      // has no knowledge of. viem can never decode that against the ABI it was given,
      // so it sets `.signature` to the raw undecoded 4-byte selector instead of
      // `.data.errorName` -- prefer looking that selector up in KNOWN_ERRORS before
      // falling back to `.reason`/`.message` (viem's own verbose "unable to decode
      // signature" text). Without this, KNOWN_ERRORS was silently never consulted
      // for this -- the overwhelmingly common -- case: `.message` is always truthy,
      // so the `if (name) return name` below always won first, and the raw-data
      // fallback further down was dead code no relayed-call error could ever reach.
      const signature = revertError.signature?.toLowerCase();
      if (signature && KNOWN_ERRORS[signature]) return KNOWN_ERRORS[signature];

      const name = revertError.data?.errorName ?? revertError.reason ?? revertError.message;
      if (name) return name;
    }
    // fallback: try raw data selector
    const raw = (err as BaseError & { data?: string }).data;
    if (typeof raw === 'string' && raw.length >= 10) {
      const sel = raw.slice(0, 10).toLowerCase();
      if (KNOWN_ERRORS[sel]) return KNOWN_ERRORS[sel];
    }
  }
  return null;
}

/** The message a decoded revert reaches a caller and `classifyRelayFailure` under. */
function relayRevertMessage(reason: string): string {
  return `Contract call rejected: ${reason}`;
}

/** How an undecodable failure describes itself, without asserting a rejection nobody saw. */
function undeterminedRelayMessage(detail: string): string {
  return (
    'Contract call did not reach a decodable outcome and may still be landing; ' +
    `poll the intent rather than resubmitting (${detail}).`
  );
}

/** The detail half of the message above, for a failure that is an error rather than a receipt. */
function relayFailureDetail(err: unknown): string {
  if (err === undefined) return 'every attempt failed without an answer from the node';
  return `last attempt: ${err instanceof Error ? err.message : String(err)}`;
}

const ERC20_ABI = parseAbi([
  'function approve(address,uint256) returns (bool)',
  'function allowance(address,address) view returns (uint256)',
  'function balanceOf(address) view returns (uint256)',
  'function transfer(address,uint256) returns (bool)',
  'function transferWithAuthorization(address from, address to, uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce, uint8 v, bytes32 r, bytes32 s)',
  // OpenZeppelin v5 reverts with custom errors rather than string reasons. Without these in
  // the ABI viem cannot decode the selector, so an ordinary "you don't have enough USDC"
  // rejection surfaces to the caller as an opaque 500 reading "Unable to decode signature
  // 0xe450d38c" -- no indication of what actually went wrong. Declaring them turns the same
  // revert into a named, readable error for API callers and for anything matching on it.
  'error ERC20InsufficientBalance(address sender, uint256 balance, uint256 needed)',
  'error ERC20InvalidSender(address sender)',
  'error ERC20InvalidReceiver(address receiver)',
  'error ERC20InsufficientAllowance(address spender, uint256 allowance, uint256 needed)',
  'error ERC20InvalidApprover(address approver)',
  'error ERC20InvalidSpender(address spender)',
]);
const MARKET_ABI = parseAbi([
  // The trailing tuple is TaskEvaluatorConfig (evaluator, stake, feeBps, evaluationWindow,
  // appealWindow, disputeResolver), added at rev016 so a task with an evaluator is one
  // transaction. Adding the parameter changed the selector, and rev016 removes the old one from
  // the diamond, so this string and the deployed contract must move together.
  // Five calldata structs, not ten loose arguments (rev018). The six former scalars --
  // reward, duration, mode, pitchDeadline, bidDeadline, auctionSubtype -- are the same fields
  // in the same order, wrapped one level deeper in TaskConfig. Selector 0xa810726c; the
  // pre-rev018 form 0xa595d889 survives as a deprecated shim until rev019 removes it, so this
  // must not be encoded against the old shape once the facet is cut in.
  'function createTask((uint256,uint256,bytes4,uint256,uint256,bytes4),(bool,uint16),(address[],bytes),(bytes32,string,bytes32[]),(address,uint256,uint16,uint32,uint32,address)) returns (bytes32)',
  'function claimTask(bytes32,uint256)',
  'function selectWorker(bytes32,address)',
  'function acceptSubmission(bytes32,address,bytes32,uint256)',
  'function acceptSubmissions(bytes32,address[],uint16[],bytes32[],uint256)',
  'function rateTask(bytes32,address,uint8,uint256,uint256,string,bytes32)',
  'function submitWork(bytes32,bytes32)',
  'function submitBid(bytes32,uint256)',
  'function selectLowestBidder(bytes32)',
  'function acceptAuction(bytes32,uint256)',
  'function submitPitch(bytes32,bytes32)',
  'function submitProof(bytes32,bytes32,bytes32,uint256)',
  'function rejectSubmission(bytes32,address)',
  'function cancelTask(bytes32,uint256)',
  'function refundExpired(bytes32,uint256)',
  'function updateTask(bytes32,uint256,uint256,uint256,uint256)',
  'function forfeitAndReopen(bytes32)',
  'function addForwarder(address)',
  'function removeForwarder(address)',
  'function isTrustedForwarder(address) view returns (bool)',
  'function requesterNonce(address) view returns (uint256)',
  'function assignEvaluator(bytes32,address,uint256,uint16,uint32,uint32,address)',
  'function evaluate(bytes32,uint8,uint16,uint16,bytes32,(address,uint256,uint16)[])',
  'function appeal(bytes32)',
  'function finalizeVerdict(bytes32)',
  'function resolveDispute(bytes32,uint8,(address,uint256,uint16)[])',
  'function evaluatorTimeout(bytes32)',
]);

// ERC-8194 PGTR forwarder ABI — TaskMarketForwarder.relay()
const FORWARDER_ABI = parseAbi([
  'function relay(address pgtrSenderAddr, uint256 paymentAmount, uint256 validBefore, bytes32 receiptNonce, bytes calldata data)',
]);
const IDENTITY_REGISTRY_ABI = parseAbi(['function register() external returns (uint256)']);
const HOOK_ABI = parseAbi([
  'function withdrawFor(address worker, address destination) external',
  'function claimable(address wallet) external view returns (uint256)',
  'function dreamsPerUsdc() external view returns (uint256)',
  'function workerSplitBps() external view returns (uint16)',
  'function bonusBps() external view returns (uint16)',
]);
const REGISTRY_READ_ABI = parseAbi([
  'function getTaskHooks(bytes32 taskId) view returns (address[])',
]);
const REGISTERED_EVENT = parseAbiItem(
  'event Registered(uint256 indexed agentId, string agentURI, address indexed owner)'
);

/**
 * Compute the bytes4 mode selector for a TMP mode name.
 * Mirrors the Solidity: bytes4(keccak256("TMP.mode.<name>"))
 */
function tmpModeBytes4(modeName: string): `0x${string}` {
  const hex = ('0x' + Buffer.from(modeName, 'utf8').toString('hex')) as `0x${string}`;
  const hash = keccak256(hex);
  return hash.slice(0, 10) as `0x${string}`; // '0x' + 8 hex chars = 4 bytes
}

/** Canonical bytes4 mode selectors matching on-chain constants */
export const MODE_MAP: Record<string, `0x${string}`> = {
  bounty: tmpModeBytes4('TMP.mode.bounty'),
  claim: tmpModeBytes4('TMP.mode.claim'),
  pitch: tmpModeBytes4('TMP.mode.pitch'),
  benchmark: tmpModeBytes4('TMP.mode.benchmark'),
  auction: tmpModeBytes4('TMP.mode.auction'),
};

/** Canonical bytes4 auction subtype selectors matching on-chain constants */
export const AUCTION_SUBTYPE_MAP: Record<string, `0x${string}`> = {
  dutch: tmpModeBytes4('TMP.auction.dutch'),
  english: tmpModeBytes4('TMP.auction.english'),
  reverse_dutch: tmpModeBytes4('TMP.auction.reverse_dutch'),
  reverse_english: tmpModeBytes4('TMP.auction.reverse_english'),
};

const TX_RECEIPT_TIMEOUT = 60_000; // 1 minute
// Bounded on purpose. A broadcast nonce still has to be mined or replaced before later work
// can proceed (issue #54), but that is the reconciler's job, not the request's -- see
// lib/server-transaction-reconciler.ts. When this budget elapses the dispatcher raises
// ServerTransactionPendingError and the transaction stays live in the outbox, so no request
// waits indefinitely and no database or RPC resource is pinned while it waits.
const SERVER_TX_RECEIPT_TIMEOUT = 60_000;
const GAS_MULTIPLIER = 2n;
// Receipt validity window for relay calls (5 minutes)
// Retry config for relay failures (ADR-0075).
//
// The window exists for RPC read-after-write lag: a node that has confirmed a receipt but whose
// simulation still reads pre-transaction state, so a call that will succeed reverts for a reason
// that is true only right now.
//
// The sizing note this comment used to carry said "~12s block time" and was wrong -- that is
// Ethereum L1. Base is OP Stack at ~2s blocks (and the sandbox's Anvil runs at --block-time 1),
// so one 6s gap is about three block boundaries and the full budget below is about fifteen.
// Lag that outlives fifteen blocks is a broken node, not lag.
const RELAY_MAX_RETRIES = 6;
// A decoded revert is the chain answering on its own terms, so a later attempt can only differ if
// the answer itself was a product of lag. One gap (~3 blocks) covers that; more only spends
// nonces and wall-clock reaching a verdict already in hand (ADR-0075). Not 1: that would be no
// retry at all, which removes the recovery this loop exists for.
const RELAY_DETERMINISTIC_MAX_RETRIES = 2;
const RELAY_RETRY_DELAY_MS = 6000;

function resolveForwarderAddress(): `0x${string}` {
  const addr = getServerConfig().FORWARDER_ADDRESS;
  if (!addr)
    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'FORWARDER_ADDRESS is not configured',
    });
  return addr as `0x${string}`;
}

/**
 * Retry a flaky RPC read with exponential backoff. Base Sepolia's provider
 * intermittently times out on eth_getBlockByNumber (both estimateFeesPerGas
 * and direct getBlock calls depend on it), so a single transient blip
 * shouldn't fail an otherwise-successful on-chain operation.
 */
async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  attempts: number,
  baseDelayMs: number
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await runWithRpcApplicationAttempt(attempt + 1, fn);
    } catch (error) {
      lastError = error;
      if (attempt < attempts - 1) {
        await new Promise((resolve) => setTimeout(resolve, baseDelayMs * 2 ** attempt));
      }
    }
  }
  throw lastError;
}

async function getGasParams(publicClient: ReturnType<typeof getPublicClient>) {
  const fees = await retryWithBackoff(() => publicClient.estimateFeesPerGas(), 3, 500);
  return {
    maxFeePerGas: fees.maxFeePerGas * GAS_MULTIPLIER,
    maxPriorityFeePerGas: (fees.maxPriorityFeePerGas ?? 1_000_000n) * GAS_MULTIPLIER,
  };
}

function assertSuccess(receipt: { status: string }, label: string) {
  if (receipt.status !== 'success') {
    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: `On-chain tx reverted: ${label}`,
    });
  }
}

type RelayResult = {
  txHash: `0x${string}`;
  blockNumber: bigint;
  logs: readonly Log[];
};

/**
 * Rebuild a RelayResult from nothing but a confirmed transaction hash.
 *
 * A relayed intent's completion handler may run in a process that never made the call --
 * hours later, from the reconciler (ADR-0045) -- so anything the original request read off
 * the receipt has to be re-derivable from the hash alone. The receipt is the durable copy
 * of that information; the request's in-memory one is not.
 */
export async function relayResultFromTxHash(txHash: `0x${string}`): Promise<RelayResult> {
  const receipt = await retryWithBackoff(
    () => getPublicClient().getTransactionReceipt({ hash: txHash }),
    5,
    500
  );
  return { blockNumber: receipt.blockNumber, logs: receipt.logs, txHash };
}

/** Block timestamp of a confirmed transaction, in seconds. */
export async function blockTimestampForTx(txHash: `0x${string}`): Promise<number> {
  const { blockNumber } = await relayResultFromTxHash(txHash);
  // Same load-balanced-RPC-lag concern as contractEvaluate's getBlock call: the transaction
  // is already confirmed, so a read served by a lagging node is worth retrying, not failing.
  const block = await retryWithBackoff(() => getPublicClient().getBlock({ blockNumber }), 5, 500);
  return Number(block.timestamp);
}

/** Block number of a confirmed transaction. */
export async function blockNumberForTx(txHash: `0x${string}`): Promise<number> {
  return Number((await relayResultFromTxHash(txHash)).blockNumber);
}

/**
 * Decode TaskCompleted logs out of a transaction receipt. The contract only
 * emits one per award with amount > 0 (EvaluatorFacet._distributeEvalAwards),
 * so an all-zero-award verdict legitimately decodes to zero logs here.
 *
 * Filters to logs emitted by the TaskMarket contract itself before decoding.
 * finalizeVerdict/resolveDispute dispatch requester-controlled hook contracts
 * (LibTaskMarket._dispatchCheckHooks, a raw `.call()`, not staticcall) before
 * the real TaskCompleted events are emitted -- an untrusted hook can execute
 * arbitrary code, including emitting a byte-identical forged TaskCompleted
 * log. Without this filter that forged log would decode successfully and get
 * merged into the legitimate settlement, crediting fake task_awards/earnings
 * to an attacker-chosen address. The async indexer is unaffected by this
 * because it fetches logs via `getLogs({ address: contractAddress })`, which
 * already filters at the RPC layer.
 */
function decodeTaskCompletedLogs(logs: readonly Log[]): EventLog[] {
  const config = getServerConfig();
  const contractAddress = (config.CONTRACT_ADDRESS as string).toLowerCase();
  return logs.flatMap((log) => {
    if (log.address.toLowerCase() !== contractAddress) return [];
    try {
      const decoded = decodeEventLog({
        abi: [TASK_COMPLETED_EVENT],
        data: log.data,
        topics: log.topics,
      });
      if (decoded.eventName !== 'TaskCompleted') return [];
      return [
        {
          args: decoded.args as unknown as Record<string, unknown>,
          eventName: decoded.eventName,
          blockNumber: log.blockNumber,
          logIndex: log.logIndex,
          transactionHash: log.transactionHash,
        },
      ];
    } catch {
      return [];
    }
  });
}

/**
 * Route a TaskMarket call through the PGTR forwarder (ERC-8194).
 * Approves forwarder to spend USDC if paymentAmount > 0, then calls relay().
 *
 * @param pgtrSenderAddr  The authenticated actor (requester or worker wallet).
 * @param paymentAmount   USDC to transfer from server to TaskMarket escrow (0 for no payment).
 * @param data            ABI-encoded calldata for the TaskMarket function.
 */
async function relayThroughForwarderResult(
  pgtrSenderAddr: `0x${string}`,
  paymentAmount: bigint,
  data: `0x${string}`
): Promise<RelayResult> {
  const config = getServerConfig();
  const { client, account } = createServerWallet();
  const publicClient = getPublicClient();
  const forwarderAddr = resolveForwarderAddress();
  const gas = await getGasParams(publicClient);

  if (paymentAmount > 0n) {
    const allowance = (await publicClient.readContract({
      address: config.USDC_TOKEN_ADDRESS as `0x${string}`,
      abi: ERC20_ABI,
      functionName: 'allowance',
      args: [account.address, forwarderAddr],
    })) as bigint;
    if (allowance < paymentAmount) {
      const approveArgs = {
        address: config.USDC_TOKEN_ADDRESS as `0x${string}`,
        abi: ERC20_ABI,
        functionName: 'approve' as const,
        args: [
          forwarderAddr,
          BigInt('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'),
        ] as const,
      };
      const { receipt } = await dispatchServerWalletTransaction({
        // Recorded on the outbox row so a replacement escalates from this fee (ADR-0051).
        fees: gas,
        simulate: () => publicClient.simulateContract({ ...approveArgs, account: account.address }),
        send: (nonce) => client.writeContract({ ...approveArgs, ...gas, nonce }),
        confirm: (hash) =>
          publicClient.waitForTransactionReceipt({
            hash,
            timeout: SERVER_TX_RECEIPT_TIMEOUT,
          }),
        // A reverted receipt is not a confirmation; the outbox row must say so (ADR-0073).
        succeeded: (receipt) => receipt.status === 'success',
      });
      assertSuccess(receipt, 'approve');
    }
  }

  // The envelope is resolved once, outside the retry loop, and every attempt sends the same
  // deadline and the same receipt nonce. It used to be regenerated per attempt, which meant
  // the deadline could never actually arrive -- each try bought another five minutes. When a
  // relayed intent binds an envelope (relay-envelope.ts) that stored value is used instead, so
  // a rebroadcast hours later still carries the deadline the original submission fixed, and
  // TaskMarketForwarder.relay's ReceiptExpired is what ends it rather than a tuned counter.
  const { receiptNonce, validBefore } = currentRelayEnvelope() ?? newRelayEnvelope();

  // Read once, here, and applied only to the relay dispatch below. The approve above is the
  // server wallet's own housekeeping and belongs to no intent; linking its outbox row to one
  // would name the wrong transaction as the intent's (ADR-0069). Undefined outside the intent
  // mechanism, where there is nothing durable to link to.
  const outboxLink = currentRelayOutboxLink();

  // Computed here, once, for the same reason the envelope is resolved here: this is the only
  // place all seven of the forwarder's receipt inputs exist together. It is constant across the
  // retry loop below, because every one of its inputs is -- the calldata, the payment and the
  // envelope are all fixed before the first attempt, which is exactly why the resulting bit
  // identifies the *intent* rather than one attempt at it (ADR-0071).
  const receiptHash = computeRelayReceiptHash({
    chainId: publicClient.chain?.id ?? config.CHAIN_ID,
    data,
    paymentAmount,
    pgtrSender: pgtrSenderAddr,
    receiptNonce,
    taskMarket: config.CONTRACT_ADDRESS as `0x${string}`,
    validBefore,
  });

  // Retry loop to handle RPC read-after-write lag: the node may confirm a receipt
  // but simulation for the next call still sees the pre-tx state. Retrying after a
  // short delay allows the node's state to catch up.
  let lastError: unknown;
  for (let attempt = 0; attempt < RELAY_MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, RELAY_RETRY_DELAY_MS));
    }

    const callArgs = {
      address: forwarderAddr,
      abi: FORWARDER_ABI,
      functionName: 'relay' as const,
      args: [pgtrSenderAddr, paymentAmount, validBefore, receiptNonce, data] as const,
    };

    let hash: `0x${string}`;
    let receipt: Awaited<ReturnType<typeof publicClient.waitForTransactionReceipt>>;
    try {
      const result = await dispatchServerWalletTransaction({
        // Recorded on the outbox row so a replacement escalates from this fee (ADR-0051).
        fees: gas,
        // The receipt hash rides the allocation hook rather than being written separately:
        // both must be durable before `send` is called, and a hash written after it would be
        // missing on exactly the branch it exists for (ADR-0071).
        onNonceAllocated: outboxLink
          ? (transactionId: string) => outboxLink.onAllocated(transactionId, receiptHash)
          : undefined,
        onNonceReleased: outboxLink?.onReleased,
        simulate: () =>
          runWithRpcApplicationAttempt(attempt + 1, () =>
            publicClient.simulateContract({ ...callArgs, account: account.address })
          ),
        send: (nonce) =>
          runWithRpcApplicationAttempt(attempt + 1, () =>
            client.writeContract({ ...callArgs, ...gas, nonce })
          ),
        confirm: (transactionHash) =>
          runWithRpcApplicationAttempt(attempt + 1, () =>
            publicClient.waitForTransactionReceipt({
              hash: transactionHash,
              timeout: SERVER_TX_RECEIPT_TIMEOUT,
            })
          ),
        // A reverted receipt is not a confirmation; the outbox row must say so (ADR-0073).
        succeeded: (receipt) => receipt.status === 'success',
      });
      hash = result.hash;
      receipt = result.receipt;
    } catch (err) {
      // A pending transaction is not a failed one. This loop retries RPC read-after-write lag,
      // where nothing was broadcast and another simulation costs only time. A receipt timeout is
      // the opposite: `send` returned, the hash exists, the transaction is in the mempool and the
      // outbox row is 'broadcast'. Retrying it spends a second nonce on work already live, and
      // swallowing it denies the hash to the only two callers written to persist it
      // (relayed-intent-request.ts, relayed-intent-registry.ts) -- so the intent stays 'recorded'
      // with a NULL hash, every sweep reads that as never-sent, and the payment is refunded for
      // work that lands on chain anyway (ADR-0045, ADR-0048).
      if (err instanceof ServerTransactionPendingError) throw err;
      lastError = err;
      // How many attempts this failure is worth, decided from the failure itself (ADR-0075).
      //
      // Read from the most recent attempt rather than fixed for the call: a first failure that
      // was a timeout and a second that is a decoded revert are different evidence, and the
      // later one is the relevant one. A decoded revert is the chain answering on its own
      // terms, so the only way a further attempt differs is if that answer was itself a product
      // of read-after-write lag -- which one gap covers.
      const budget =
        classifyRelayFailure(err) === 'deterministic'
          ? RELAY_DETERMINISTIC_MAX_RETRIES
          : RELAY_MAX_RETRIES;
      if (attempt + 1 >= budget) break;
      continue;
    }

    if (receipt.status !== 'success') {
      // Replay via eth_call to decode the actual revert reason (e.g. SubmissionNotFound),
      // so callers that catch specific revert names see the same message format as pre-send failures.
      let revertReason: string | null = null;
      try {
        // Replay the transaction that actually failed, argument for argument -- the same
        // `validBefore` and the same `receiptNonce` the send used, not fresh ones.
        //
        // These used to be regenerated here, on the reasoning that a diagnostic should not trip
        // over an expired deadline or a spent nonce on its way to the "real" revert. That reads
        // backwards: an expired deadline and a spent nonce ARE real reverts, and they are the two
        // this replay is least able to afford losing. A relay that failed ReceiptExpired or
        // ReceiptAlreadyUsed cannot reproduce under a fresh envelope -- the replay succeeds and
        // no revert is decoded, which used to leave `revertReason` at a literal 'unknown revert'
        // that classifyRelayFailure read as transient, so a permanent failure arriving by this
        // path was indistinguishable from a retryable one and got retried until it aged out.
        // Replaying the original envelope is what makes the two separable, and it is still the
        // only thing that does.
        //
        // This remains a read-only eth_call. simulateContract never signs and never broadcasts,
        // so reusing the original nonce cannot spend it or re-send anything; the node evaluates
        // the call against current state and discards it.
        await runWithRpcApplicationAttempt(attempt + 1, () =>
          publicClient.simulateContract({
            address: forwarderAddr,
            abi: FORWARDER_ABI,
            functionName: 'relay',
            args: [pgtrSenderAddr, paymentAmount, validBefore, receiptNonce, data],
            account: account.address,
          })
        );
      } catch (simErr) {
        revertReason = decodeRelayRevert(simErr);
      }
      // A decoded reason is the contract's own verdict, and it is the case this replay exists
      // for: callers match on `SubmissionNotFound` and the rest, and classifyRelayFailure reads
      // the prefix as deterministic. Unchanged.
      if (revertReason !== null) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: relayRevertMessage(revertReason) });
      }

      // No reason came back, so the replay reproduced nothing and this code has established
      // nothing. Saying "Contract call rejected" here asserted a fact it did not have -- and
      // asserted it, twice on one sandbox run, about a write that went on to complete with a
      // successful receipt thirty seconds later. That is ADR-0049's third state, not a failure:
      // the transaction is live under `hash`, settlement owns its outcome, and the caller is
      // owed the handle and an instruction to poll rather than a 400 telling them the chain
      // refused them (ADR-0070). `relayed-intent-request.ts` turns this into the same
      // `intent_in_flight` envelope a receipt timeout produces.
      throw new UndeterminedRelayError(
        undeterminedRelayMessage(
          `transaction ${hash} returned a failed receipt that a replay of the same envelope did not reproduce`
        ),
        hash
      );
    }
    return { txHash: hash, blockNumber: receipt.blockNumber, logs: receipt.logs };
  }
  // The loop is exhausted. Six attempts at RELAY_RETRY_DELAY_MS apart is a fixed wall-clock cost,
  // which is why this throw arrived at the same thirty-second mark on every observed run -- the
  // one detail that identified it as the loop timing out rather than anything about the write.
  const exhaustedReason = decodeRelayRevert(lastError);
  if (exhaustedReason !== null) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: relayRevertMessage(exhaustedReason) });
  }

  // Same rule as the replay above: nothing decoded, so nothing is established. No hash is passed
  // because none was ever returned here -- and that is not evidence one does not exist, only
  // that this code never saw it (ADR-0069).
  throw new UndeterminedRelayError(undeterminedRelayMessage(relayFailureDetail(lastError)));
}

async function relayThroughForwarder(
  pgtrSenderAddr: `0x${string}`,
  paymentAmount: bigint,
  data: `0x${string}`
): Promise<`0x${string}`> {
  return (await relayThroughForwarderResult(pgtrSenderAddr, paymentAmount, data)).txHash;
}

/**
 * The two shapes `TaskCreated` has had. Both are tried for the same reason the indexer keeps
 * both (services/indexer.ts): rev014 appended non-indexed fields, which changes topic0, so a
 * single ABI silently matches nothing on the other side of that line. `taskId` is the first
 * indexed parameter in both, which is all this needs.
 */
const TASK_CREATED_EVENTS = [
  parseAbiItem(
    'event TaskCreated(bytes32 indexed taskId, address indexed requester, uint256 reward, bytes4 indexed mode, uint256 expiryTime, bool stakeRequired, uint16 stakeBps)'
  ),
  parseAbiItem(
    'event TaskCreated(bytes32 indexed taskId, address indexed requester, uint256 reward, bytes4 indexed mode, uint256 expiryTime)'
  ),
] as const;

/**
 * The id the chain assigned to a task, read out of that transaction's own `TaskCreated` log.
 *
 * This is the replacement for predicting the id from `requesterNonce` before the call. The
 * formula was right and the nonce was not: `createTask` increments
 * `s.requesterNonce[requester]` as it derives the id (CoreFacet), so anything else by the same
 * requester landing between the read and the mine shifts the real id off the prediction. Two
 * concurrent creates from one requester both read nonce N and both predict id(N) while the
 * chain assigns N and N+1 -- the second request then persists the *first* task's id, and its
 * completion's upsert overwrites that task's description, reward, tags and deadlines.
 *
 * A prediction is a guess about state another transaction can change. The log is the chain
 * stating what it did, and it is re-derivable from the hash alone -- so a reconciler pass
 * completing this intent hours later reads exactly what the original request would have
 * (ADR-0045, the same reason `acceptance.rate` re-reads its block number from the receipt).
 *
 * Filtered to logs from the TaskMarket contract itself, for the same reason
 * `decodeTaskCompletedLogs` filters: a requester-controlled hook can emit a byte-identical
 * forged log, and a forged id here would hang an entire creation off a task of the attacker's
 * choosing.
 */
export async function taskIdForTx(txHash: `0x${string}`): Promise<`0x${string}`> {
  const { logs } = await relayResultFromTxHash(txHash);
  const contractAddress = (getServerConfig().CONTRACT_ADDRESS as string).toLowerCase();

  for (const log of logs) {
    if (log.address.toLowerCase() !== contractAddress) continue;
    for (const event of TASK_CREATED_EVENTS) {
      try {
        const decoded = decodeEventLog({ abi: [event], data: log.data, topics: log.topics });
        if (decoded.eventName !== 'TaskCreated') continue;
        return (decoded.args as unknown as { taskId: `0x${string}` }).taskId;
      } catch {
        // Some other event, or the other revision's shape. Both are ordinary here.
      }
    }
  }

  // A confirmed transaction that created no task. There is no honest id to return and no safe
  // one to invent, so this fails and the intent is retried rather than writing a task row
  // under a made-up id.
  throw new TRPCError({
    code: 'INTERNAL_SERVER_ERROR',
    message: `No TaskCreated log found in transaction ${txHash}`,
  });
}

/** The address the contract reads as "unset" for hooks, evaluators and dispute resolvers. */
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as const;

export async function contractCreateTask(
  requester: `0x${string}`,
  reward: bigint,
  durationSecs: bigint,
  mode: `0x${string}`,
  pitchDeadlineSecs: bigint = 0n,
  bidDeadlineSecs: bigint = 0n,
  auctionSubtype: `0x${string}` = '0x00000000',
  stakeRequired: boolean = false,
  stakeBps: number = 0,
  hookContract: `0x${string}` = '0x0000000000000000000000000000000000000000',
  tags: readonly `0x${string}`[] = [],
  hookData: `0x${string}` = '0x',
  paymentTxHash?: `0x${string}`,
  /**
   * Evaluator terms, applied in the same transaction as the task itself.
   *
   * Omit for a task with no evaluator. This is not a convenience: assigning an evaluator in a
   * following transaction races every worker agent watching for new tasks, because the task is
   * claimable the instant this one mines and `assignEvaluator` reverts `TaskNotOpen` once a
   * worker has claimed. Passing the terms here is the only way to configure an evaluator that
   * cannot lose that race (ADR-0047 named this gap; rev016 closes it).
   */
  evaluatorConfig?: {
    appealWindowSecs: number;
    disputeResolver: `0x${string}`;
    evaluationWindowSecs: number;
    evaluator: `0x${string}`;
    evaluatorFeeBps: number;
  }
): Promise<`0x${string}`> {
  const publicClient = getPublicClient();

  if (paymentTxHash) {
    await publicClient.waitForTransactionReceipt({
      hash: paymentTxHash,
      timeout: TX_RECEIPT_TIMEOUT,
    });
  }

  const hookContracts: `0x${string}`[] =
    hookContract === '0x0000000000000000000000000000000000000000' ? [] : [hookContract];

  const data = encodeFunctionData({
    abi: MARKET_ABI,
    functionName: 'createTask',
    args: [
      [
        reward,
        durationSecs,
        mode as `0x${string}`,
        pitchDeadlineSecs,
        bidDeadlineSecs,
        auctionSubtype,
      ] as const,
      [stakeRequired, stakeBps] as const,
      [hookContracts, hookData] as const,
      [
        '0x0000000000000000000000000000000000000000000000000000000000000000' as `0x${string}`,
        '',
        tags,
      ] as const,
      // A zero evaluator address means "no evaluator". The contract rejects a config that
      // carries terms but no evaluator rather than dropping them silently, so the absent case
      // must be all-zero, not merely evaluator-less.
      [
        (evaluatorConfig?.evaluator ?? ZERO_ADDRESS) as `0x${string}`,
        // The backend has never staked an evaluator; the field exists because the on-chain
        // config does, and a caller that wants a stake goes through assignEvaluator.
        0n,
        evaluatorConfig?.evaluatorFeeBps ?? 0,
        evaluatorConfig?.evaluationWindowSecs ?? 0,
        evaluatorConfig?.appealWindowSecs ?? 0,
        (evaluatorConfig?.disputeResolver ?? ZERO_ADDRESS) as `0x${string}`,
      ] as const,
    ],
  });
  return relayThroughForwarder(requester, reward, data);
}

export async function contractAssignEvaluator(
  taskId: `0x${string}`,
  requester: `0x${string}`,
  evaluator: `0x${string}`,
  stakeAmount: bigint,
  feeBps: number,
  evaluationWindowSecs: number,
  appealWindowSecs: number,
  disputeResolver: `0x${string}`
): Promise<`0x${string}`> {
  const data = encodeFunctionData({
    abi: MARKET_ABI,
    functionName: 'assignEvaluator',
    args: [
      taskId,
      evaluator,
      stakeAmount,
      feeBps,
      evaluationWindowSecs,
      appealWindowSecs,
      disputeResolver,
    ],
  });
  // stakeAmount is pulled from the requester via USDC transferFrom inside assignEvaluator; requester pays 0 gas here
  return relayThroughForwarder(requester, 0n, data);
}

export async function contractEvaluate(
  taskId: `0x${string}`,
  evaluator: `0x${string}`,
  verdictType: number,
  score: number,
  confidence: number,
  evidenceHash: `0x${string}`,
  awards: readonly { worker: `0x${string}`; amount: bigint; rank: number }[]
): Promise<{ txHash: `0x${string}`; evaluatedAt: number }> {
  const awardTuples = awards.map((a) => [a.worker, a.amount, a.rank] as const);
  const data = encodeFunctionData({
    abi: MARKET_ABI,
    functionName: 'evaluate',
    args: [taskId, verdictType, score, confidence, evidenceHash, awardTuples],
  });
  const result = await relayThroughForwarderResult(evaluator, 0n, data);
  // A load-balanced RPC provider can serve this getBlock call from a node that
  // hasn't yet indexed the block the receipt just confirmed on a different node.
  // The transaction already succeeded on-chain, so retry the read rather than
  // fail the whole mutation over a transient consistency lag.
  try {
    const block = await retryWithBackoff(
      () => getPublicClient().getBlock({ blockNumber: result.blockNumber }),
      5,
      500
    );
    return { txHash: result.txHash, evaluatedAt: Number(block.timestamp) };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: `Evaluation confirmed onchain (${result.txHash}) but block timestamp lookup failed: ${reason}`,
    });
  }
}

export async function contractAppeal(
  taskId: `0x${string}`,
  worker: `0x${string}`
): Promise<`0x${string}`> {
  const data = encodeFunctionData({
    abi: MARKET_ABI,
    functionName: 'appeal',
    args: [taskId],
  });
  return relayThroughForwarder(worker, 0n, data);
}

export type ResolvedSettlementResult = {
  txHash: `0x${string}`;
  settlement: ProjectedSettlement | null;
  settledAt: number | null;
};

/**
 * Decode any TaskCompleted logs out of a relay receipt and project them into
 * a settlement, so the caller can record task_awards synchronously instead of
 * waiting on the indexer's next poll. `settlement`/`settledAt` are null when
 * the verdict awarded nobody a nonzero amount (a valid, existing edge case —
 * the contract simply emits no TaskCompleted logs in that case).
 */
async function projectSettlementFromReceipt(
  taskId: `0x${string}`,
  result: RelayResult
): Promise<{ settlement: ProjectedSettlement | null; settledAt: number | null }> {
  const completionLogs = toSettlementCompletionLogs(decodeTaskCompletedLogs(result.logs));
  if (completionLogs.length === 0) {
    return { settlement: null, settledAt: null };
  }

  const chainState = await contractGetSettlementChainState(taskId);
  const [settlement] = projectSettlementLogs(completionLogs, new Map([[taskId, chainState]]));

  // Same load-balanced-RPC-lag concern as contractEvaluate's getBlock call above.
  try {
    const block = await retryWithBackoff(
      () => getPublicClient().getBlock({ blockNumber: result.blockNumber }),
      5,
      500
    );
    return { settlement, settledAt: Number(block.timestamp) };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: `Settlement confirmed onchain (${result.txHash}) but block timestamp lookup failed: ${reason}`,
    });
  }
}

/**
 * Project a settlement from a confirmed transaction hash rather than from a receipt held in
 * memory. The form a relayed intent's completion handler needs (ADR-0045).
 */
export async function contractProjectSettlementForTx(
  taskId: `0x${string}`,
  txHash: `0x${string}`
): Promise<{ settlement: ProjectedSettlement | null; settledAt: number | null }> {
  return projectSettlementFromReceipt(taskId, await relayResultFromTxHash(txHash));
}

/**
 * Broadcast finalizeVerdict and return only its hash.
 *
 * The form a relayed intent needs (ADR-0045): the settlement this transaction produces is
 * projected by the completion handler from the hash, because that handler may run in a process
 * that never made this call and has no receipt in hand.
 */
export async function contractFinalizeVerdictTx(taskId: `0x${string}`): Promise<`0x${string}`> {
  // Anyone can call finalizeVerdict — use server wallet as the acting principal
  const { address } = createServerWallet();
  const data = encodeFunctionData({
    abi: MARKET_ABI,
    functionName: 'finalizeVerdict',
    args: [taskId],
  });
  return relayThroughForwarder(address, 0n, data);
}

export async function contractFinalizeVerdict(
  taskId: `0x${string}`
): Promise<ResolvedSettlementResult> {
  // Anyone can call finalizeVerdict — use server wallet as the acting principal
  const { address } = createServerWallet();
  const data = encodeFunctionData({
    abi: MARKET_ABI,
    functionName: 'finalizeVerdict',
    args: [taskId],
  });
  const result = await relayThroughForwarderResult(address, 0n, data);
  const { settlement, settledAt } = await projectSettlementFromReceipt(taskId, result);
  return { txHash: result.txHash, settlement, settledAt };
}

export async function contractResolveDispute(
  taskId: `0x${string}`,
  resolver: `0x${string}`,
  verdictType: number,
  awards: readonly { worker: `0x${string}`; amount: bigint; rank: number }[]
): Promise<ResolvedSettlementResult> {
  const awardTuples = awards.map((a) => [a.worker, a.amount, a.rank] as const);
  const data = encodeFunctionData({
    abi: MARKET_ABI,
    functionName: 'resolveDispute',
    args: [taskId, verdictType, awardTuples],
  });
  const result = await relayThroughForwarderResult(resolver, 0n, data);
  const { settlement, settledAt } = await projectSettlementFromReceipt(taskId, result);
  return { txHash: result.txHash, settlement, settledAt };
}

export async function contractEvaluatorTimeout(
  taskId: `0x${string}`,
  requester: `0x${string}`
): Promise<`0x${string}`> {
  const data = encodeFunctionData({
    abi: MARKET_ABI,
    functionName: 'evaluatorTimeout',
    args: [taskId],
  });
  return relayThroughForwarder(requester, 0n, data);
}

export async function contractSubmitBid(
  taskId: `0x${string}`,
  worker: `0x${string}`,
  price: bigint,
  _contractAddress?: string | null
): Promise<`0x${string}`> {
  const data = encodeFunctionData({
    abi: MARKET_ABI,
    functionName: 'submitBid',
    args: [taskId, price],
  });
  return relayThroughForwarder(worker, 0n, data);
}

export async function contractSubmitPitch(
  taskId: `0x${string}`,
  worker: `0x${string}`,
  pitchHash: `0x${string}`,
  _contractAddress?: string | null
): Promise<`0x${string}`> {
  const data = encodeFunctionData({
    abi: MARKET_ABI,
    functionName: 'submitPitch',
    args: [taskId, pitchHash],
  });
  return relayThroughForwarder(worker, 0n, data);
}

export async function contractSubmitProof(
  taskId: `0x${string}`,
  worker: `0x${string}`,
  proofHash: `0x${string}`,
  proofType: `0x${string}`,
  metricValue: bigint,
  _contractAddress?: string | null
): Promise<`0x${string}`> {
  const data = encodeFunctionData({
    abi: MARKET_ABI,
    functionName: 'submitProof',
    args: [taskId, proofHash, proofType, metricValue],
  });
  return relayThroughForwarder(worker, 0n, data);
}

export async function contractSelectLowestBidder(
  taskId: `0x${string}`,
  _contractAddress?: string | null
): Promise<`0x${string}`> {
  const { address } = createServerWallet();
  const data = encodeFunctionData({
    abi: MARKET_ABI,
    functionName: 'selectLowestBidder',
    args: [taskId],
  });
  // selectLowestBidder has no user principal — server address is the acting pgtrSender
  return relayThroughForwarder(address, 0n, data);
}

export async function contractAcceptAuction(
  taskId: `0x${string}`,
  worker: `0x${string}`,
  price: bigint,
  _contractAddress?: string | null
): Promise<`0x${string}`> {
  const data = encodeFunctionData({
    abi: MARKET_ABI,
    functionName: 'acceptAuction',
    args: [taskId, price],
  });
  return relayThroughForwarder(worker, 0n, data);
}

export async function contractClaimTask(
  taskId: `0x${string}`,
  worker: `0x${string}`,
  stakeAmount: bigint,
  _contractAddress?: string | null
): Promise<`0x${string}`> {
  const data = encodeFunctionData({
    abi: MARKET_ABI,
    functionName: 'claimTask',
    args: [taskId, stakeAmount],
  });
  return relayThroughForwarder(worker, stakeAmount, data);
}

export async function contractSelectWorker(
  taskId: `0x${string}`,
  requester: `0x${string}`,
  worker: `0x${string}`,
  _contractAddress?: string | null
): Promise<`0x${string}`> {
  const data = encodeFunctionData({
    abi: MARKET_ABI,
    functionName: 'selectWorker',
    args: [taskId, worker],
  });
  return relayThroughForwarder(requester, 0n, data);
}

export async function contractAcceptSubmission(
  taskId: `0x${string}`,
  requester: `0x${string}`,
  worker: `0x${string}`,
  deliverable: `0x${string}`,
  requesterAgentId: bigint = 0n,
  _contractAddress?: string | null
): Promise<`0x${string}`> {
  const data = encodeFunctionData({
    abi: MARKET_ABI,
    functionName: 'acceptSubmission',
    args: [taskId, worker, deliverable, requesterAgentId],
  });
  return relayThroughForwarder(requester, 0n, data);
}

export async function contractAcceptSubmissions(
  taskId: `0x${string}`,
  requester: `0x${string}`,
  workers: readonly `0x${string}`[],
  shares: readonly number[],
  deliverables: readonly `0x${string}`[],
  requesterAgentId: bigint = 0n,
  _contractAddress?: string | null
): Promise<`0x${string}`> {
  const data = encodeFunctionData({
    abi: MARKET_ABI,
    functionName: 'acceptSubmissions',
    args: [taskId, workers, shares, deliverables, requesterAgentId],
  });
  return relayThroughForwarder(requester, 0n, data);
}

export async function contractRateTask(
  taskId: `0x${string}`,
  requester: `0x${string}`,
  worker: `0x${string}`,
  rating: number,
  workerAgentId: bigint,
  raterAgentId: bigint,
  feedbackURI: string,
  feedbackHash: `0x${string}`,
  _contractAddress?: string | null
): Promise<{ hash: `0x${string}`; blockNumber: number }> {
  const publicClient = getPublicClient();
  const data = encodeFunctionData({
    abi: MARKET_ABI,
    functionName: 'rateTask',
    args: [taskId, worker, rating, workerAgentId, raterAgentId, feedbackURI, feedbackHash],
  });
  const hash = await relayThroughForwarder(requester, 0n, data);
  const receipt = await publicClient.waitForTransactionReceipt({
    hash,
    timeout: TX_RECEIPT_TIMEOUT,
  });
  return { hash, blockNumber: Number(receipt.blockNumber) };
}

export async function contractTransferWithAuthorization(
  from: `0x${string}`,
  to: `0x${string}`,
  value: bigint,
  validAfter: bigint,
  validBefore: bigint,
  nonce: `0x${string}`,
  signature: string
): Promise<`0x${string}`> {
  const config = getServerConfig();
  const { client, account } = createServerWallet();
  const publicClient = getPublicClient();
  const gas = await getGasParams(publicClient);

  // Split 65-byte hex signature into v, r, s
  const sig = signature.startsWith('0x') ? signature.slice(2) : signature;
  const r = `0x${sig.slice(0, 64)}` as `0x${string}`;
  const s = `0x${sig.slice(64, 128)}` as `0x${string}`;
  const v = parseInt(sig.slice(128, 130), 16);

  const callArgs = {
    address: config.USDC_TOKEN_ADDRESS as `0x${string}`,
    abi: ERC20_ABI,
    functionName: 'transferWithAuthorization' as const,
    args: [from, to, value, validAfter, validBefore, nonce, v, r, s] as const,
  };
  const { hash, receipt } = await dispatchServerWalletTransaction({
    // Recorded on the outbox row so a replacement escalates from this fee (ADR-0051).
    fees: gas,
    simulate: () => publicClient.simulateContract({ ...callArgs, account: account.address }),
    send: (transactionNonce) =>
      client.writeContract({ ...callArgs, ...gas, nonce: transactionNonce }),
    confirm: (transactionHash) =>
      publicClient.waitForTransactionReceipt({
        hash: transactionHash,
        timeout: SERVER_TX_RECEIPT_TIMEOUT,
      }),
    // A reverted receipt is not a confirmation; the outbox row must say so (ADR-0073).
    succeeded: (receipt) => receipt.status === 'success',
  });
  assertSuccess(receipt, 'transferWithAuthorization');
  return hash;
}

/**
 * Send USDC straight back to a payer from the server wallet -- used when an x402
 * payment already settled (payer -> server wallet) but the on-chain action it was
 * paying for then reverted, so the funds never made it into escrow. This is a plain
 * wallet-to-wallet ERC20 transfer, not a relayed TaskMarket call: the server wallet
 * already holds the USDC at this point, so no forwarder/approval step is needed.
 * See services/orphaned-payments.ts for the caller and the ledger it writes.
 */
export async function contractRefundOrphanedPayment(
  payer: `0x${string}`,
  amount: bigint
): Promise<`0x${string}`> {
  const config = getServerConfig();
  const { client, account } = createServerWallet();
  const publicClient = getPublicClient();
  const gas = await getGasParams(publicClient);

  const callArgs = {
    address: config.USDC_TOKEN_ADDRESS as `0x${string}`,
    abi: ERC20_ABI,
    functionName: 'transfer' as const,
    args: [payer, amount] as const,
  };
  const { hash, receipt } = await dispatchServerWalletTransaction({
    // Recorded on the outbox row so a replacement escalates from this fee (ADR-0051).
    fees: gas,
    simulate: () => publicClient.simulateContract({ ...callArgs, account: account.address }),
    send: (nonce) => client.writeContract({ ...callArgs, ...gas, nonce }),
    confirm: (transactionHash) =>
      publicClient.waitForTransactionReceipt({
        hash: transactionHash,
        timeout: SERVER_TX_RECEIPT_TIMEOUT,
      }),
    // A reverted receipt is not a confirmation; the outbox row must say so (ADR-0073).
    succeeded: (receipt) => receipt.status === 'success',
  });
  assertSuccess(receipt, 'refund transfer');
  return hash;
}

export async function contractSubmitWork(
  taskId: `0x${string}`,
  worker: `0x${string}`,
  deliverable: `0x${string}`,
  _contractAddress?: string | null
): Promise<`0x${string}`> {
  const data = encodeFunctionData({
    abi: MARKET_ABI,
    functionName: 'submitWork',
    args: [taskId, deliverable],
  });
  return relayThroughForwarder(worker, 0n, data);
}

export async function contractForfeitAndReopen(
  taskId: `0x${string}`,
  requester: `0x${string}`,
  _contractAddress?: string | null
): Promise<`0x${string}`> {
  const data = encodeFunctionData({
    abi: MARKET_ABI,
    functionName: 'forfeitAndReopen',
    args: [taskId],
  });
  return relayThroughForwarder(requester, 0n, data);
}

export async function contractRejectSubmission(
  taskId: `0x${string}`,
  worker: `0x${string}`,
  payer: `0x${string}`
): Promise<`0x${string}`> {
  const data = encodeFunctionData({
    abi: MARKET_ABI,
    functionName: 'rejectSubmission',
    args: [taskId, worker],
  });
  return relayThroughForwarder(payer, 0n, data);
}

export async function contractCancelTask(
  taskId: `0x${string}`,
  requester: `0x${string}`,
  requesterAgentId: bigint = 0n,
  _contractAddress?: string | null
): Promise<`0x${string}`> {
  const data = encodeFunctionData({
    abi: MARKET_ABI,
    functionName: 'cancelTask',
    args: [taskId, requesterAgentId],
  });
  return relayThroughForwarder(requester, 0n, data);
}

export async function contractRefundExpired(
  taskId: `0x${string}`,
  caller: `0x${string}`,
  requesterAgentId: bigint = 0n
): Promise<`0x${string}`> {
  const data = encodeFunctionData({
    abi: MARKET_ABI,
    functionName: 'refundExpired',
    args: [taskId, requesterAgentId],
  });
  return relayThroughForwarder(caller, 0n, data);
}

export async function contractUpdateTask(
  taskId: `0x${string}`,
  requester: `0x${string}`,
  newReward: bigint,
  newExpiryTime: bigint,
  newBidDeadline: bigint,
  newPitchDeadline: bigint,
  currentReward: bigint = 0n,
  _contractAddress?: string | null
): Promise<`0x${string}`> {
  const data = encodeFunctionData({
    abi: MARKET_ABI,
    functionName: 'updateTask',
    args: [taskId, newReward, newExpiryTime, newBidDeadline, newPitchDeadline],
  });
  // Additional payment = reward increase (forwarder transfers the delta to TaskMarket escrow)
  const additionalPayment = newReward > currentReward ? newReward - currentReward : 0n;
  return relayThroughForwarder(requester, additionalPayment, data);
}

/**
 * Broadcast the registry mint and return only its hash.
 *
 * Split out from contractRegisterIdentity so a relayed intent can record the transaction and
 * resolve the minted agentId separately (ADR-0045): the intent's completion handler may run
 * in a process that never made this call, and can only work from the hash.
 */
export async function contractRegisterIdentityTx(): Promise<`0x${string}`> {
  const config = getServerConfig();
  const { client, account } = createServerWallet();
  const publicClient = getPublicClient();

  const gas = await getGasParams(publicClient);

  const callArgs = {
    address: config.ERC8004_IDENTITY_REGISTRY as `0x${string}`,
    abi: IDENTITY_REGISTRY_ABI,
    functionName: 'register' as const,
    args: [] as const,
  };
  const { hash, receipt } = await dispatchServerWalletTransaction({
    // Recorded on the outbox row so a replacement escalates from this fee (ADR-0051).
    fees: gas,
    simulate: () => publicClient.simulateContract({ ...callArgs, account: account.address }),
    send: (nonce) => client.writeContract({ ...callArgs, ...gas, nonce }),
    confirm: (transactionHash) =>
      publicClient.waitForTransactionReceipt({
        hash: transactionHash,
        timeout: SERVER_TX_RECEIPT_TIMEOUT,
      }),
    // A reverted receipt is not a confirmation; the outbox row must say so (ADR-0073).
    succeeded: (receipt) => receipt.status === 'success',
  });
  assertSuccess(receipt, 'registerIdentity');
  return hash;
}

/** The agentId minted by a confirmed registerIdentity transaction. */
export async function resolveRegisteredAgentId(hash: `0x${string}`): Promise<bigint> {
  const config = getServerConfig();
  const publicClient = getPublicClient();
  const receipt = await retryWithBackoff(
    () => publicClient.getTransactionReceipt({ hash }),
    5,
    500
  );

  // Parse agentId from Registered(uint256 indexed agentId, ...) event.
  // Retry up to 5 times in case RPC logs lag behind the confirmed receipt.
  const registryAddress = (config.ERC8004_IDENTITY_REGISTRY as string).toLowerCase();

  function extractAgentId(logs: typeof receipt.logs): bigint | null {
    for (const log of logs) {
      if (log.address.toLowerCase() !== registryAddress) continue;
      try {
        const decoded = decodeEventLog({
          abi: [REGISTERED_EVENT],
          data: log.data,
          topics: log.topics,
        });
        if (decoded.eventName === 'Registered') {
          return (decoded.args as { agentId: bigint }).agentId;
        }
      } catch {
        // not this event
      }
    }
    return null;
  }

  const fromReceipt = extractAgentId(receipt.logs);
  if (fromReceipt !== null) return fromReceipt;

  // Logs missing from receipt — RPC lag. Re-fetch via getLogs for the specific block, then
  // filter down to this transaction's own logs before scanning. Without the transactionHash
  // filter, a concurrent registerIdentity() call landing in the same block would return every
  // Registered event in the block, and extractAgentId would happily return the FIRST one it
  // finds -- which can belong to a different caller's transaction, silently handing back the
  // wrong agentId.
  for (let attempt = 0; attempt < 5; attempt++) {
    await new Promise<void>((resolve) => setTimeout(resolve, RELAY_RETRY_DELAY_MS));
    const logs = await runWithRpcApplicationAttempt(attempt + 1, () =>
      publicClient.getLogs({
        address: config.ERC8004_IDENTITY_REGISTRY as `0x${string}`,
        fromBlock: receipt.blockNumber,
        toBlock: receipt.blockNumber,
      })
    );
    const ownLogs = logs.filter((log) => log.transactionHash === hash);
    const found = extractAgentId(ownLogs);
    if (found !== null) return found;
  }

  throw new TRPCError({
    code: 'INTERNAL_SERVER_ERROR',
    message: 'Registered event not found in registerIdentity receipt',
  });
}

export async function contractRegisterIdentity(): Promise<bigint> {
  return resolveRegisteredAgentId(await contractRegisterIdentityTx());
}

export async function contractWithdrawDreamsRewards(
  worker: `0x${string}`,
  destination: `0x${string}`
): Promise<`0x${string}`> {
  const config = getServerConfig();
  if (!config.DREAMS_HOOK_ADDRESS) {
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message: 'DREAMS_HOOK_ADDRESS is not configured',
    });
  }
  const { client, account } = createServerWallet();
  const publicClient = getPublicClient();
  const gas = await getGasParams(publicClient);

  const callArgs = {
    address: config.DREAMS_HOOK_ADDRESS as `0x${string}`,
    abi: HOOK_ABI,
    functionName: 'withdrawFor' as const,
    args: [worker, destination] as const,
  };
  const { hash, receipt } = await dispatchServerWalletTransaction({
    // Recorded on the outbox row so a replacement escalates from this fee (ADR-0051).
    fees: gas,
    simulate: () => publicClient.simulateContract({ ...callArgs, account: account.address }),
    send: (nonce) => client.writeContract({ ...callArgs, ...gas, nonce }),
    confirm: (transactionHash) =>
      publicClient.waitForTransactionReceipt({
        hash: transactionHash,
        timeout: SERVER_TX_RECEIPT_TIMEOUT,
      }),
    // A reverted receipt is not a confirmation; the outbox row must say so (ADR-0073).
    succeeded: (receipt) => receipt.status === 'success',
  });
  assertSuccess(receipt, 'withdrawFor');
  return hash;
}

export async function contractGetTaskHooks(
  taskId: `0x${string}`,
  contractAddress?: string | null
): Promise<readonly `0x${string}`[]> {
  const config = getServerConfig();
  const publicClient = getPublicClient();
  const addr = (contractAddress ?? config.CONTRACT_ADDRESS) as `0x${string}`;
  return publicClient.readContract({
    address: addr,
    abi: REGISTRY_READ_ABI,
    functionName: 'getTaskHooks',
    args: [taskId],
  });
}

export async function contractGetSettlementChainState(
  taskId: `0x${string}`,
  contractAddress?: string | null
): Promise<SettlementChainState> {
  const config = getServerConfig();
  const publicClient = getPublicClient();
  const address = (contractAddress ?? config.CONTRACT_ADDRESS) as `0x${string}`;
  const [task, verdict] = await Promise.all([
    publicClient.readContract({
      address,
      abi: SETTLEMENT_READ_ABI,
      functionName: 'getTask',
      args: [taskId],
    }),
    publicClient.readContract({
      address,
      abi: SETTLEMENT_READ_ABI,
      functionName: 'getTaskVerdict',
      args: [taskId],
    }),
  ]);

  return {
    primaryWorker: task.worker,
    verdictAwards: verdict.awards.map((award) => ({
      amount: award.amount,
      rank: Number(award.rank),
      worker: award.worker,
    })),
    verdictIssued: verdict.issued,
  };
}

export async function contractGetDreamsClaimable(wallet: `0x${string}`): Promise<bigint> {
  const config = getServerConfig();
  if (!config.DREAMS_HOOK_ADDRESS) return 0n;
  const publicClient = getPublicClient();
  return publicClient.readContract({
    address: config.DREAMS_HOOK_ADDRESS as `0x${string}`,
    abi: HOOK_ABI,
    functionName: 'claimable',
    args: [wallet],
  });
}

export async function contractGetDreamsPerUsdc(): Promise<bigint> {
  const config = getServerConfig();
  if (!config.DREAMS_HOOK_ADDRESS) return 0n;
  const publicClient = getPublicClient();
  return publicClient.readContract({
    address: config.DREAMS_HOOK_ADDRESS as `0x${string}`,
    abi: HOOK_ABI,
    functionName: 'dreamsPerUsdc',
  });
}

export async function contractGetDreamsWorkerSplitBps(): Promise<number> {
  const config = getServerConfig();
  if (!config.DREAMS_HOOK_ADDRESS) return 0;
  const publicClient = getPublicClient();
  return publicClient.readContract({
    address: config.DREAMS_HOOK_ADDRESS as `0x${string}`,
    abi: HOOK_ABI,
    functionName: 'workerSplitBps',
  });
}

export async function contractGetDreamsBonusBps(): Promise<number> {
  const config = getServerConfig();
  if (!config.DREAMS_HOOK_ADDRESS) return 0;
  const publicClient = getPublicClient();
  return publicClient.readContract({
    address: config.DREAMS_HOOK_ADDRESS as `0x${string}`,
    abi: HOOK_ABI,
    functionName: 'bonusBps',
  });
}

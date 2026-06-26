import { randomBytes } from 'crypto';
import {
  createPublicClient,
  http,
  parseAbi,
  parseAbiItem,
  decodeEventLog,
  keccak256,
  encodeAbiParameters,
  encodeFunctionData,
  ContractFunctionRevertedError,
  BaseError,
} from 'viem';
import { base, baseSepolia } from 'viem/chains';
import { TRPCError } from '@trpc/server';
import { createServerWallet } from '../lib/wallet';
import { getServerConfig } from '../config/env';

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
};

function decodeRelayRevert(err: unknown): string {
  if (err instanceof BaseError) {
    const revertError = err.walk((e) => e instanceof ContractFunctionRevertedError);
    if (revertError instanceof ContractFunctionRevertedError) {
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
  return 'unknown revert';
}

const ERC20_ABI = parseAbi([
  'function approve(address,uint256) returns (bool)',
  'function allowance(address,address) view returns (uint256)',
  'function balanceOf(address) view returns (uint256)',
  'function transferWithAuthorization(address from, address to, uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce, uint8 v, bytes32 r, bytes32 s)',
]);
const MARKET_ABI = parseAbi([
  'function createTask(uint256,uint256,bytes4,uint256,uint256,bytes32,string,bytes4,address,bytes32[],bytes) returns (bytes32)',
  'function claimTask(bytes32,uint256)',
  'function selectWorker(bytes32,address)',
  'function acceptSubmission(bytes32,address,bytes32)',
  'function acceptSubmissions(bytes32,address[],uint16[],bytes32[])',
  'function rateTask(bytes32,address,uint8,uint256,uint256,string,bytes32)',
  'function submitWork(bytes32,bytes32)',
  'function submitBid(bytes32,uint256)',
  'function selectLowestBidder(bytes32)',
  'function acceptAuction(bytes32,uint256)',
  'function submitPitch(bytes32,bytes32)',
  'function submitProof(bytes32,bytes32,bytes32,uint256)',
  'function rejectSubmission(bytes32,address)',
  'function cancelTask(bytes32)',
  'function refundExpired(bytes32)',
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
const GAS_MULTIPLIER = 2n;
// Receipt validity window for relay calls (5 minutes)
const RELAY_VALID_WINDOW_SECS = 300;
// Retry config for relay simulation failures (RPC read-after-write lag)
const RELAY_MAX_RETRIES = 6;
const RELAY_RETRY_DELAY_MS = 2000;

function resolveForwarderAddress(): `0x${string}` {
  const addr = getServerConfig().FORWARDER_ADDRESS;
  if (!addr)
    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'FORWARDER_ADDRESS is not configured',
    });
  return addr as `0x${string}`;
}

function getPublicClient() {
  const config = getServerConfig();
  const chain = config.CHAIN_ID === 84532 ? baseSepolia : base;
  return createPublicClient({ chain, transport: http(config.BASE_RPC_URL) });
}

async function getGasParams(publicClient: ReturnType<typeof getPublicClient>) {
  const fees = await publicClient.estimateFeesPerGas();
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

/**
 * Route a TaskMarket call through the PGTR forwarder (ERC-8194).
 * Approves forwarder to spend USDC if paymentAmount > 0, then calls relay().
 *
 * @param pgtrSenderAddr  The authenticated actor (requester or worker wallet).
 * @param paymentAmount   USDC to transfer from server to TaskMarket escrow (0 for no payment).
 * @param data            ABI-encoded calldata for the TaskMarket function.
 */
async function relayThroughForwarder(
  pgtrSenderAddr: `0x${string}`,
  paymentAmount: bigint,
  data: `0x${string}`
): Promise<`0x${string}`> {
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
      const approveTx = await client.writeContract({
        address: config.USDC_TOKEN_ADDRESS as `0x${string}`,
        abi: ERC20_ABI,
        functionName: 'approve',
        args: [
          forwarderAddr,
          BigInt('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'),
        ],
        ...gas,
      });
      assertSuccess(
        await publicClient.waitForTransactionReceipt({
          hash: approveTx,
          timeout: TX_RECEIPT_TIMEOUT,
        }),
        'approve'
      );
    }
  }

  // Retry loop to handle RPC read-after-write lag: the node may confirm a receipt
  // but simulation for the next call still sees the pre-tx state. Retrying after a
  // short delay allows the node's state to catch up.
  let lastError: unknown;
  for (let attempt = 0; attempt < RELAY_MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, RELAY_RETRY_DELAY_MS));
    }

    const validBefore = BigInt(Math.floor(Date.now() / 1000) + RELAY_VALID_WINDOW_SECS);
    const receiptNonce = `0x${randomBytes(32).toString('hex')}` as `0x${string}`;

    let hash: `0x${string}`;
    try {
      hash = await client.writeContract({
        address: forwarderAddr,
        abi: FORWARDER_ABI,
        functionName: 'relay',
        args: [pgtrSenderAddr, paymentAmount, validBefore, receiptNonce, data],
        ...gas,
      });
    } catch (err) {
      // writeContract threw before sending — simulation failed. Retry on transient
      // errors; on the final attempt, decode and surface the revert reason.
      lastError = err;
      continue;
    }

    // Transaction was sent — wait for receipt. On-chain reverts are real errors.
    assertSuccess(
      await publicClient.waitForTransactionReceipt({ hash, timeout: TX_RECEIPT_TIMEOUT }),
      'relay'
    );
    return hash;
  }
  throw new TRPCError({
    code: 'BAD_REQUEST',
    message: `Contract call rejected: ${decodeRelayRevert(lastError)}`,
  });
}

/**
 * Pre-compute the contract-generated task ID using the current requester nonce.
 * The contract generates: keccak256(abi.encode(chainId, contractAddress, requester, nonce))
 * Call this BEFORE contractCreateTask to know the ID before it's on-chain.
 */
export async function precomputeTaskId(
  requester: `0x${string}`,
  contractAddress?: string | null
): Promise<`0x${string}`> {
  const config = getServerConfig();
  const publicClient = getPublicClient();
  const addr = (contractAddress ?? config.CONTRACT_ADDRESS) as `0x${string}`;

  const nonce = (await publicClient.readContract({
    address: addr,
    abi: MARKET_ABI,
    functionName: 'requesterNonce',
    args: [requester],
  })) as bigint;

  return keccak256(
    encodeAbiParameters(
      [{ type: 'uint256' }, { type: 'address' }, { type: 'address' }, { type: 'uint256' }],
      [BigInt(config.CHAIN_ID), addr, requester, nonce]
    )
  ) as `0x${string}`;
}

export async function contractCreateTask(
  requester: `0x${string}`,
  reward: bigint,
  durationSecs: bigint,
  mode: `0x${string}`,
  pitchDeadlineSecs: bigint = 0n,
  bidDeadlineSecs: bigint = 0n,
  auctionSubtype: `0x${string}` = '0x00000000',
  hookContract: `0x${string}` = '0x0000000000000000000000000000000000000000',
  tags: readonly `0x${string}`[] = [],
  hookData: `0x${string}` = '0x',
  paymentTxHash?: `0x${string}`
): Promise<`0x${string}`> {
  const publicClient = getPublicClient();

  if (paymentTxHash) {
    await publicClient.waitForTransactionReceipt({
      hash: paymentTxHash,
      timeout: TX_RECEIPT_TIMEOUT,
    });
  }

  const data = encodeFunctionData({
    abi: MARKET_ABI,
    functionName: 'createTask',
    args: [
      reward,
      durationSecs,
      mode as `0x${string}`,
      pitchDeadlineSecs,
      bidDeadlineSecs,
      '0x0000000000000000000000000000000000000000000000000000000000000000' as `0x${string}`,
      '',
      auctionSubtype,
      hookContract,
      tags,
      hookData,
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
): Promise<`0x${string}`> {
  const awardTuples = awards.map((a) => [a.worker, a.amount, a.rank] as const);
  const data = encodeFunctionData({
    abi: MARKET_ABI,
    functionName: 'evaluate',
    args: [taskId, verdictType, score, confidence, evidenceHash, awardTuples],
  });
  return relayThroughForwarder(evaluator, 0n, data);
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

export async function contractFinalizeVerdict(taskId: `0x${string}`): Promise<`0x${string}`> {
  // Anyone can call finalizeVerdict — use server wallet as the acting principal
  const { address } = createServerWallet();
  const data = encodeFunctionData({
    abi: MARKET_ABI,
    functionName: 'finalizeVerdict',
    args: [taskId],
  });
  return relayThroughForwarder(address, 0n, data);
}

export async function contractResolveDispute(
  taskId: `0x${string}`,
  resolver: `0x${string}`,
  verdictType: number,
  awards: readonly { worker: `0x${string}`; amount: bigint; rank: number }[]
): Promise<`0x${string}`> {
  const awardTuples = awards.map((a) => [a.worker, a.amount, a.rank] as const);
  const data = encodeFunctionData({
    abi: MARKET_ABI,
    functionName: 'resolveDispute',
    args: [taskId, verdictType, awardTuples],
  });
  return relayThroughForwarder(resolver, 0n, data);
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
  _contractAddress?: string | null
): Promise<`0x${string}`> {
  const data = encodeFunctionData({
    abi: MARKET_ABI,
    functionName: 'acceptSubmission',
    args: [taskId, worker, deliverable],
  });
  return relayThroughForwarder(requester, 0n, data);
}

export async function contractAcceptSubmissions(
  taskId: `0x${string}`,
  requester: `0x${string}`,
  workers: readonly `0x${string}`[],
  shares: readonly number[],
  deliverables: readonly `0x${string}`[],
  _contractAddress?: string | null
): Promise<`0x${string}`> {
  const data = encodeFunctionData({
    abi: MARKET_ABI,
    functionName: 'acceptSubmissions',
    args: [taskId, workers, shares, deliverables],
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
  const { client } = createServerWallet();
  const publicClient = getPublicClient();
  const gas = await getGasParams(publicClient);

  // Split 65-byte hex signature into v, r, s
  const sig = signature.startsWith('0x') ? signature.slice(2) : signature;
  const r = `0x${sig.slice(0, 64)}` as `0x${string}`;
  const s = `0x${sig.slice(64, 128)}` as `0x${string}`;
  const v = parseInt(sig.slice(128, 130), 16);

  const hash = await client.writeContract({
    address: config.USDC_TOKEN_ADDRESS as `0x${string}`,
    abi: ERC20_ABI,
    functionName: 'transferWithAuthorization',
    args: [from, to, value, validAfter, validBefore, nonce, v, r, s],
    ...gas,
  });
  assertSuccess(
    await publicClient.waitForTransactionReceipt({ hash, timeout: TX_RECEIPT_TIMEOUT }),
    'transferWithAuthorization'
  );
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
  _contractAddress?: string | null
): Promise<`0x${string}`> {
  const data = encodeFunctionData({
    abi: MARKET_ABI,
    functionName: 'cancelTask',
    args: [taskId],
  });
  return relayThroughForwarder(requester, 0n, data);
}

export async function contractRefundExpired(
  taskId: `0x${string}`,
  caller: `0x${string}`
): Promise<`0x${string}`> {
  const data = encodeFunctionData({
    abi: MARKET_ABI,
    functionName: 'refundExpired',
    args: [taskId],
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

export async function contractRegisterIdentity(): Promise<bigint> {
  const config = getServerConfig();
  const { client } = createServerWallet();
  const publicClient = getPublicClient();

  const gas = await getGasParams(publicClient);

  const hash = await client.writeContract({
    address: config.ERC8004_IDENTITY_REGISTRY as `0x${string}`,
    abi: IDENTITY_REGISTRY_ABI,
    functionName: 'register',
    args: [],
    ...gas,
  });

  const receipt = await publicClient.waitForTransactionReceipt({
    hash,
    timeout: TX_RECEIPT_TIMEOUT,
  });
  assertSuccess(receipt, 'registerIdentity');

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

  // Logs missing from receipt — RPC lag. Re-fetch via getLogs for the specific block.
  for (let attempt = 0; attempt < 5; attempt++) {
    await new Promise<void>((resolve) => setTimeout(resolve, RELAY_RETRY_DELAY_MS));
    const logs = await publicClient.getLogs({
      address: config.ERC8004_IDENTITY_REGISTRY as `0x${string}`,
      fromBlock: receipt.blockNumber,
      toBlock: receipt.blockNumber,
    });
    const found = extractAgentId(logs);
    if (found !== null) return found;
  }

  throw new TRPCError({
    code: 'INTERNAL_SERVER_ERROR',
    message: 'Registered event not found in registerIdentity receipt',
  });
}

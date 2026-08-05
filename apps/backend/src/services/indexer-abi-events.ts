import { parseAbiItem, type AbiEvent } from 'viem';
import {
  EpochBudgetABI,
  RewardVaultABI,
  TaskMarketABI,
  TaskTokenRewardHookABI,
} from '@taskmarket/contracts/abi';

/**
 * Single source of truth for every on-chain event the indexer subscribes to.
 *
 * The event definitions are read from the generated ABI artifacts under
 * packages/contracts/abi/ (produced by `make build contracts`, kept current by CI's
 * `make contract abi-check`) rather than hand-transcribed here. That removes the
 * whole class of drift where the contracts gain or change an event and the indexer
 * silently keeps filtering the old set -- viem's getLogs filters by topic0, so an
 * event that is not listed is never fetched, never decoded, and never reaches any
 * default branch. It fails with no error and no log at all.
 *
 * Two lists exist per contract:
 *   - INDEXED: names the indexer filters for and handles.
 *   - UNINDEXED: names deliberately not projected, each with the reason.
 * Together they must account for every event in the generated ABI --
 * test/unit/config/indexer-abi-drift.test.ts fails the build otherwise, so a newly
 * added contract event forces an explicit decision instead of being dropped.
 */

type AbiLike = readonly unknown[];

function eventsByName(abi: AbiLike, label: string): Map<string, AbiEvent> {
  const map = new Map<string, AbiEvent>();
  for (const entry of abi as readonly AbiEvent[]) {
    if (entry?.type !== 'event') continue;
    map.set(entry.name, entry);
  }
  if (map.size === 0) {
    throw new Error(`[indexer-abi] generated ABI for ${label} contains no events`);
  }
  return map;
}

const TASK_MARKET_EVENTS = eventsByName(TaskMarketABI as AbiLike, 'TaskMarket');
const REWARD_HOOK_EVENTS = eventsByName(TaskTokenRewardHookABI as AbiLike, 'TaskTokenRewardHook');
const REWARD_VAULT_EVENTS = eventsByName(RewardVaultABI as AbiLike, 'RewardVault');
const EPOCH_BUDGET_EVENTS = eventsByName(EpochBudgetABI as AbiLike, 'EpochBudget');

function resolve(
  source: Map<string, AbiEvent>,
  label: string,
  names: readonly string[]
): AbiEvent[] {
  return names.map((name) => {
    const event = source.get(name);
    if (!event) {
      throw new Error(
        `[indexer-abi] ${label} has no event '${name}' in its generated ABI. ` +
          `Regenerate with 'make build contracts', or remove it from the indexed list.`
      );
    }
    return event;
  });
}

// -- Diamond (CONTRACT_ADDRESS) ---------------------------------------------

export const MAIN_INDEXED_EVENT_NAMES = [
  'TaskCreated',
  'TaskClaimed',
  'TaskWorkerSelected',
  'TaskCompleted',
  'TaskRated',
  'TaskSubmitted',
  'BidSubmitted',
  'TaskExpired',
  'StakeForfeited',
  'StakeReturned',
  'TaskReopened',
  'TaskCancelled',
  'TaskUpdated',
  'PitchSubmitted',
  'ProofSubmitted',
  'AuctionAccepted',
  'FeesUpdated',
  'FeeRecipientUpdated',
  'ForwarderUpdated',
  'ReputationRegistryUpdated',
  'DefaultHooksSet',
  'DiamondCut',
  'HookRegistered',
  'HookCallFailed',
  'ReputationFeedbackFailed',
  'EvaluatorAssigned',
  'TaskEvaluated',
  'TaskAppealed',
  'TaskDisputed',
  'EvaluatorTimedOut',
  'SubmissionRejected',
  'SelfAward',
  'RequesterReputation',
  'Paused',
  'Unpaused',
  'OwnershipTransferStarted',
  'OwnershipTransferred',
] as const;

/**
 * Diamond events that exist on-chain but are deliberately not indexed. Anything
 * added to the contracts and not added to MAIN_INDEXED_EVENT_NAMES must be listed
 * here with a reason, or the drift test fails.
 */
export const MAIN_UNINDEXED_EVENTS: Record<string, string> = {
  // OpenZeppelin Initializable's marker, emitted once per facet initialisation
  // during deploy/upgrade. Carries no protocol meaning beyond what DiamondCut
  // already records.
  Initialized: 'proxy initialisation artifact; DiamondCut already records upgrades',
};

/**
 * Superseded signatures the Diamond has emitted over its lifetime. The proxy address
 * never changes across upgrades, so a full reseed from CONTRACT_DEPLOY_BLOCK replays
 * logs whose topic0 is the OLD signature -- these must stay registered in the getLogs
 * filter or the replay silently skips them. They cannot come from the generated ABI,
 * which only ever describes the current contracts. The drift test asserts each of
 * these is genuinely superseded (same name, different topic0 from the current ABI).
 */
export const HISTORICAL_MAIN_EVENTS: Record<string, AbiEvent> = {
  // rev014 (ADR-0029) appended stakeRequired/stakeBps, changing topic0.
  TaskCreated: parseAbiItem(
    'event TaskCreated(bytes32 indexed taskId, address indexed requester, uint256 reward, bytes4 indexed mode, uint256 expiryTime)'
  ) as AbiEvent,
};

/**
 * Events declared in contract revisions not yet merged into this branch's sources.
 * Registering them early is harmless (no log carries their topic0 yet) and means the
 * indexer observes them from the first block after the upgrade lands. The drift test
 * asserts that once the name does appear in the generated ABI, this literal matches
 * it exactly -- at which point it should move to MAIN_INDEXED_EVENT_NAMES.
 */
export const PENDING_MAIN_EVENTS: Record<string, AbiEvent> = {
  // AdminFacet.setMinAppealWindow, arriving with rev017.
  MinAppealWindowUpdated: parseAbiItem(
    'event MinAppealWindowUpdated(uint32 newMinAppealWindow)'
  ) as AbiEvent,
};

export const MAIN_CONTRACT_EVENTS: AbiEvent[] = [
  ...resolve(TASK_MARKET_EVENTS, 'TaskMarket', MAIN_INDEXED_EVENT_NAMES),
  ...Object.values(HISTORICAL_MAIN_EVENTS),
  ...Object.values(PENDING_MAIN_EVENTS),
];

// -- TaskTokenRewardHook (DREAMS_HOOK_ADDRESS) ------------------------------

export const REWARD_HOOK_INDEXED_EVENT_NAMES = [
  'RewardConfigured',
  'RewardReserved',
  'RewardPaid',
  'RewardReserveReleased',
  'RewardsWithdrawn',
  'PriceUpdated',
  'BonusBpsUpdated',
] as const;

export const REWARD_HOOK_UNINDEXED_EVENTS: Record<string, string> = {
  // Hook ownership is an operator concern tracked on the Diamond, whose own
  // OwnershipTransferred/OwnershipTransferStarted pair is indexed.
  OwnershipTransferred: 'hook ownership changes are operational, not protocol state',
};

export const REWARD_HOOK_EVENT_ITEMS: AbiEvent[] = resolve(
  REWARD_HOOK_EVENTS,
  'TaskTokenRewardHook',
  REWARD_HOOK_INDEXED_EVENT_NAMES
);

// -- RewardVault (REWARD_VAULT_ADDRESS) -------------------------------------

export const REWARD_VAULT_INDEXED_EVENT_NAMES = [
  'Reserved',
  'Released',
  'Paid',
  'Withdrawn',
  'EmergencyWithdrawn',
  'HookSet',
] as const;

export const REWARD_VAULT_UNINDEXED_EVENTS: Record<string, string> = {
  OwnershipTransferred: 'vault ownership changes are operational, not protocol state',
};

export const REWARD_VAULT_EVENT_ITEMS: AbiEvent[] = resolve(
  REWARD_VAULT_EVENTS,
  'RewardVault',
  REWARD_VAULT_INDEXED_EVENT_NAMES
);

// -- EpochBudget (EPOCH_BUDGET_ADDRESS) -------------------------------------

export const EPOCH_BUDGET_INDEXED_EVENT_NAMES = [
  'Consumed',
  'Released',
  'EpochRolled',
  'HookSet',
] as const;

export const EPOCH_BUDGET_UNINDEXED_EVENTS: Record<string, string> = {
  OwnershipTransferred: 'budget ownership changes are operational, not protocol state',
};

export const EPOCH_BUDGET_EVENT_ITEMS: AbiEvent[] = resolve(
  EPOCH_BUDGET_EVENTS,
  'EpochBudget',
  EPOCH_BUDGET_INDEXED_EVENT_NAMES
);

/** Every generated-ABI event name, per contract, for the drift test. */
export const GENERATED_EVENT_NAMES = {
  TaskMarket: [...TASK_MARKET_EVENTS.keys()],
  TaskTokenRewardHook: [...REWARD_HOOK_EVENTS.keys()],
  RewardVault: [...REWARD_VAULT_EVENTS.keys()],
  EpochBudget: [...EPOCH_BUDGET_EVENTS.keys()],
} as const;

export const GENERATED_EVENT_ITEMS = {
  TaskMarket: TASK_MARKET_EVENTS,
} as const;

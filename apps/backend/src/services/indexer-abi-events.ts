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
 *
 * Those lists are also checked at compile time. The generated ABIs are `as const`
 * literals, so every event name and parameter type survives into the type system, and
 * the name unions below are derived from them. An event renamed or removed in the
 * contracts stops being assignable and `tsc` rejects this file -- the drift test never
 * has to run, and neither does the indexer. That is the typed-bindings half of
 * ADR-0065. The drift test remains for the half types cannot answer here: whether an
 * event exists that nothing handles at all, which no exhaustiveness check can decide
 * while the indexer deliberately watches a subset.
 */

type AbiLike = readonly unknown[];

/**
 * The event names an `as const` ABI declares, as a union of string literals. A JSON
 * import cannot produce this -- there `name` is `string`, and every constraint below
 * would degenerate into a tautology that accepts anything.
 */
type EventNamesOf<abi extends AbiLike> = Extract<
  abi[number],
  { readonly type: 'event'; readonly name: string }
>['name'];

/** The parameter names a specific generated event declares. */
type EventArgNamesOf<abi extends AbiLike, name extends EventNamesOf<abi>> = Extract<
  abi[number],
  { readonly type: 'event'; readonly name: name; readonly inputs: readonly { name: string }[] }
>['inputs'][number]['name'];

export type TaskMarketEventName = EventNamesOf<typeof TaskMarketABI>;
export type RewardHookEventName = EventNamesOf<typeof TaskTokenRewardHookABI>;
export type RewardVaultEventName = EventNamesOf<typeof RewardVaultABI>;
export type EpochBudgetEventName = EventNamesOf<typeof EpochBudgetABI>;

/**
 * Parameter names of a Diamond event, for consumers that destructure a decoded log.
 * `MainEventArgName<'TaskCompleted'>` changes the moment that event's parameters
 * change on-chain, so a consumer that pins its expectations against it fails to
 * compile rather than silently reading `undefined`.
 */
export type MainEventArgName<name extends TaskMarketEventName> = EventArgNamesOf<
  typeof TaskMarketABI,
  name
>;

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

const TASK_MARKET_EVENTS = eventsByName(TaskMarketABI, 'TaskMarket');
const REWARD_HOOK_EVENTS = eventsByName(TaskTokenRewardHookABI, 'TaskTokenRewardHook');
const REWARD_VAULT_EVENTS = eventsByName(RewardVaultABI, 'RewardVault');
const EPOCH_BUDGET_EVENTS = eventsByName(EpochBudgetABI, 'EpochBudget');

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
  'MinAppealWindowUpdated',
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
] as const satisfies readonly TaskMarketEventName[];

/**
 * Diamond events that exist on-chain but are deliberately not indexed. Anything
 * added to the contracts and not added to MAIN_INDEXED_EVENT_NAMES must be listed
 * here with a reason, or the drift test fails.
 */
export const MAIN_UNINDEXED_EVENTS: Partial<Record<TaskMarketEventName, string>> = {
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
  // Empty: rev017 has landed, so MinAppealWindowUpdated now comes from the generated ABI and
  // has moved to MAIN_INDEXED_EVENT_NAMES, which is the transition this map exists to stage.
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
] as const satisfies readonly RewardHookEventName[];

export const REWARD_HOOK_UNINDEXED_EVENTS: Partial<Record<RewardHookEventName, string>> = {
  // Hook ownership is an operator concern tracked on the Diamond, whose own
  // OwnershipTransferred/OwnershipTransferStarted pair is indexed.
  OwnershipTransferred: 'hook ownership changes are operational, not protocol state',
};

export const REWARD_HOOK_EVENT_ITEMS: AbiEvent[] = resolve(
  REWARD_HOOK_EVENTS,
  'TaskTokenRewardHook',
  REWARD_HOOK_INDEXED_EVENT_NAMES
);

// -- RewardVault (DREAMS_VAULT_ADDRESS) -------------------------------------

export const REWARD_VAULT_INDEXED_EVENT_NAMES = [
  'Reserved',
  'Released',
  'Paid',
  'Withdrawn',
  'EmergencyWithdrawn',
  'HookSet',
] as const satisfies readonly RewardVaultEventName[];

export const REWARD_VAULT_UNINDEXED_EVENTS: Partial<Record<RewardVaultEventName, string>> = {
  OwnershipTransferred: 'vault ownership changes are operational, not protocol state',
};

export const REWARD_VAULT_EVENT_ITEMS: AbiEvent[] = resolve(
  REWARD_VAULT_EVENTS,
  'RewardVault',
  REWARD_VAULT_INDEXED_EVENT_NAMES
);

// -- EpochBudget (DREAMS_EPOCH_BUDGET_ADDRESS) -------------------------------------

export const EPOCH_BUDGET_INDEXED_EVENT_NAMES = [
  'Consumed',
  'Released',
  'EpochRolled',
  'HookSet',
] as const satisfies readonly EpochBudgetEventName[];

export const EPOCH_BUDGET_UNINDEXED_EVENTS: Partial<Record<EpochBudgetEventName, string>> = {
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

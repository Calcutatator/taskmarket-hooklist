import { randomUUID } from 'crypto';
import { keccak256, parseAbiItem, slice, toBytes, zeroAddress } from 'viem';
import { normalizeAddress } from '@taskmarket/shared';
import { db } from '../db/client';
// Allows the status-guarded handlers below to run against an injected test
// database (see test/integration/services/indexer-status-guards.test.ts)
// while every production call site keeps using the module singleton.
type Database = typeof db;
import {
  tasks,
  claims,
  agents,
  bids,
  feedbacks,
  indexerState,
  indexedEvents,
  proofs,
  proposals,
  protocolEvents,
  submissions,
} from '../db/schema';
import { and, eq, inArray, notInArray, sql } from 'drizzle-orm';
import { getServerConfig } from '../config/env';
import { createServerWallet } from '../lib/wallet';
import { getPublicClient, runWithRpcOperation } from '../lib/rpc-gateway';
import { shouldStartEvaluatorReview } from './task-evaluator';
import {
  projectSettlementLogs,
  toSettlementCompletionLogs,
  type EventLog,
  type ProjectedSettlement,
  type SettlementChainState,
  type SettlementCompletionLog,
} from './settlement-projector';
import {
  EPOCH_BUDGET_EVENT_ITEMS,
  MAIN_CONTRACT_EVENTS,
  REWARD_HOOK_EVENT_ITEMS,
  REWARD_VAULT_EVENT_ITEMS,
} from './indexer-abi-events';
import { runCheckpointedRange } from './indexer-checkpoint';
import { contractGetSettlementChainState, contractGetTaskWorker } from './contract';
import { projectSettlementRating } from './settlement-rating';
import { recordTaskSettlement } from './settlement-recorder';
import { processIndexedEvent } from './indexer-event';
import { createSerializedPoll } from './serialized-poll';
import { recordRequesterReputationEvent } from './requester-reputation-recorder';

const config = getServerConfig();

const publicClient = getPublicClient();

const POLL_INTERVAL = 12000;
const MAX_BLOCK_RANGE = 10_000n;

const IDENTITY_REGISTRY_ADDRESS = config.ERC8004_IDENTITY_REGISTRY as `0x${string}`;
const ERC8004_SEED_BLOCK = config.ERC8004_SEED_BLOCK;

// This server's own relayer address -- every on-chain identity registration is
// signed by this wallet (see contractRegisterIdentity()), so the registry's
// agentWallet metadata always defaults to it, never the real end user's
// address. See the usage in processIdentityEvents() below (issue #208).
const serverAddress = normalizeAddress(createServerWallet().address);

const DREAMS_HOOK_ADDRESS = config.DREAMS_HOOK_ADDRESS as `0x${string}` | undefined;
const DREAMS_HOOK_SEED_BLOCK = config.DREAMS_HOOK_SEED_BLOCK;

// RewardVault and EpochBudget are deployed alongside the reward hook at their own
// addresses, so each needs its own poll. Both are optional -- a deployment without
// them simply has no stream, exactly as with DREAMS_HOOK_ADDRESS.
const DREAMS_VAULT_ADDRESS = config.DREAMS_VAULT_ADDRESS as `0x${string}` | undefined;
const DREAMS_VAULT_SEED_BLOCK = config.DREAMS_VAULT_SEED_BLOCK;
const DREAMS_EPOCH_BUDGET_ADDRESS = config.DREAMS_EPOCH_BUDGET_ADDRESS as `0x${string}` | undefined;
const DREAMS_EPOCH_BUDGET_SEED_BLOCK = config.DREAMS_EPOCH_BUDGET_SEED_BLOCK;

// The ERC-8004 identity registry is a third-party contract with no artifact in this
// repo, so this one signature stays a literal. Every Taskmarket-owned event comes
// from the generated ABI via ./indexer-abi-events.
const METADATA_SET_EVENT = parseAbiItem(
  'event MetadataSet(uint256 indexed agentId, string indexed indexedMetadataKey, string metadataKey, bytes metadataValue)'
);

// Mode is emitted as bytes4(keccak256("TMP.mode.<name>")) — see ITMPMode.sol.
// Compute the selectors once at module load so the indexer can reverse the lookup.
function modeSelector(name: string): `0x${string}` {
  return slice(keccak256(toBytes(name)), 0, 4);
}

const MODE_BY_SELECTOR: Record<string, string> = {
  [modeSelector('TMP.mode.bounty').toLowerCase()]: 'bounty',
  [modeSelector('TMP.mode.claim').toLowerCase()]: 'claim',
  [modeSelector('TMP.mode.pitch').toLowerCase()]: 'pitch',
  [modeSelector('TMP.mode.benchmark').toLowerCase()]: 'benchmark',
  [modeSelector('TMP.mode.auction').toLowerCase()]: 'auction',
};

async function getLastBlock(id: string, defaultBlock: number): Promise<bigint> {
  const result = await db.select().from(indexerState).where(eq(indexerState.id, id)).limit(1);

  if (result.length === 0) {
    await db.insert(indexerState).values({
      id,
      lastBlock: defaultBlock,
    });
    return BigInt(defaultBlock);
  }

  return BigInt(result[0].lastBlock);
}

async function setLastBlock(id: string, block: bigint): Promise<void> {
  await db
    .update(indexerState)
    .set({ lastBlock: Number(block), updatedAt: new Date() })
    .where(eq(indexerState.id, id));
}

/**
 * Idempotency guard. Returns true if the event at (chainId, blockNumber, logIndex)
 * has already been processed. Callers should short-circuit when true.
 */
async function isAlreadyProcessed(log: EventLog): Promise<boolean> {
  if (log.blockNumber == null || log.logIndex == null) return false;
  const existing = await db
    .select({ chainId: indexedEvents.chainId })
    .from(indexedEvents)
    .where(
      and(
        eq(indexedEvents.chainId, config.CHAIN_ID),
        eq(indexedEvents.blockNumber, log.blockNumber),
        eq(indexedEvents.logIndex, log.logIndex)
      )
    )
    .limit(1);
  return existing.length > 0;
}

/**
 * Records that this event has been processed. Idempotent on
 * (chainId, blockNumber, logIndex) — concurrent inserts are deduped by the PK.
 */
async function markProcessed(log: EventLog): Promise<void> {
  if (log.blockNumber == null || log.logIndex == null) return;
  await db
    .insert(indexedEvents)
    .values({
      chainId: config.CHAIN_ID,
      blockNumber: log.blockNumber,
      logIndex: log.logIndex,
      eventName: log.eventName,
      txHash: log.transactionHash ?? '0x',
    })
    .onConflictDoNothing();
}

// Implements: ADR-0029 (chain-recover stakeRequired/stakeBps on reconcile)
export async function processTaskCreatedEvent(
  log: EventLog,
  database: Database = db
): Promise<void> {
  const { taskId, requester, reward, expiryTime, mode, stakeRequired, stakeBps } = log.args;
  const modeKey = (mode as `0x${string}`).toLowerCase();
  const modeString = MODE_BY_SELECTOR[modeKey] || 'bounty';

  await database
    .insert(tasks)
    .values({
      id: taskId as string,
      requester: requester as string,
      requesterPubkey: '',
      description: '',
      reward: (reward as bigint).toString(),
      escrowTxHash: log.transactionHash!,
      expiryTime: new Date(Number(expiryTime as bigint) * 1000),
      status: 'open',
      tags: [],
      mode: modeString,
      // Recovered directly from the TaskCreated event (rev014, ADR-0029) -- unlike
      // Task.stakeAmount (only set later by the worker's claimTask call), the requester's
      // stakeRequired/stakeBps choice is now emitted on-chain at creation time. Pre-rev014
      // logs (HISTORICAL_MAIN_EVENTS.TaskCreated) have neither field in `args`; default both
      // rather than inserting undefined, since those tasks predate stake config existing.
      stakeRequired: stakeRequired ? 1 : 0,
      stakeBps: (stakeBps as number | undefined) ?? 0,
      platformFeeBps: config.DEFAULT_PLATFORM_FEE_BPS,
      // task_awards backfill only scans the currently-configured contract; an
      // unset contract_address makes a task's settlement unrecoverable (ADR-0008).
      chainId: config.CHAIN_ID,
      contractAddress: config.CONTRACT_ADDRESS,
    })
    .onConflictDoNothing();

  // Ensure the requester has an agent row so they appear in the directory
  await database
    .insert(agents)
    .values({ address: normalizeAddress(requester as string) })
    .onConflictDoNothing();

  console.log(`TaskCreated event: ${taskId} by ${requester}, mode: ${modeString}`);
}

// Implements: ADR-0007 (indexer status transitions guarded by prior state)
// Every tasks.status-writing handler below conditions its UPDATE on the task's current
// status being one of the valid prior states its corresponding router mutation itself
// requires -- see each handler's own inline "(see ADR-0007)" note for its specific guard.
export async function processTaskClaimedEvent(
  log: EventLog,
  database: Database = db
): Promise<void> {
  const { taskId, worker, stakeAmount } = log.args;

  // Guarded to only apply from 'open' (the only state claim() accepts from --
  // see claims.router.ts) so a late-processed event can't regress a task that
  // has since advanced further (see ADR-0007).
  const updated = await database
    .update(tasks)
    .set({
      status: 'claimed',
      claimedBy: worker as string,
      claimedAt: new Date(),
    })
    .where(and(eq(tasks.id, taskId as string), eq(tasks.status, 'open')))
    .returning({ id: tasks.id });

  await database
    .update(claims)
    .set({ stakeAmount: stakeAmount!.toString() })
    .where(eq(claims.taskId, taskId as string));

  if (updated.length === 0) {
    console.log(`TaskClaimed event: ${taskId} skipped -- task status has already advanced`);
    return;
  }
  console.log(`TaskClaimed event: ${taskId} by ${worker}, stake: ${stakeAmount}`);
}

export async function processTaskWorkerSelectedEvent(
  log: EventLog,
  database: Database = db
): Promise<void> {
  const { taskId, worker } = log.args;

  // TaskWorkerSelected fires from two different contract functions:
  // CoreFacet.selectWorker (pitch mode, on-chain status -> WorkerSelected)
  // and AuctionFacet.selectLowestBidder (auction english/reverse_english
  // mode, on-chain status -> Claimed, per bids.router.ts's selectWinner).
  // The event itself carries no mode info, so look up the task's mode to
  // apply the status this on-chain function actually set, mirroring each
  // router mutation's own write exactly.
  const taskRow = await database
    .select({ mode: tasks.mode })
    .from(tasks)
    .where(eq(tasks.id, taskId as string))
    .limit(1);
  const mode = taskRow[0]?.mode;
  const status = mode === 'auction' ? 'claimed' : 'worker_selected';

  // Guarded to only apply from 'open' (the only state both selectWorker and
  // selectLowestBidder accept from) so a late-processed event can't regress
  // a task that has since advanced further (see ADR-0007).
  const updated = await database
    .update(tasks)
    .set({
      status,
      claimedBy: worker as string,
    })
    .where(and(eq(tasks.id, taskId as string), eq(tasks.status, 'open')))
    .returning({ id: tasks.id });

  if (updated.length === 0) {
    console.log(`TaskWorkerSelected event: ${taskId} skipped -- task status has already advanced`);
    return;
  }
  console.log(`TaskWorkerSelected event: ${taskId} - ${worker} (status=${status})`);
}

async function readSettlementChainStates(
  logs: SettlementCompletionLog[]
): Promise<Map<string, SettlementChainState>> {
  const contractAddress = config.CONTRACT_ADDRESS as `0x${string}`;
  const taskIds = [...new Set(logs.map((log) => log.args.taskId))];
  const entries = await Promise.all(
    taskIds.map(async (taskId) => {
      return [
        taskId,
        await contractGetSettlementChainState(taskId as `0x${string}`, contractAddress),
      ] as const;
    })
  );

  return new Map(entries);
}

async function readSettlementTimes(logs: SettlementCompletionLog[]): Promise<Map<bigint, Date>> {
  const blockNumbers = [...new Set(logs.map((log) => log.blockNumber))];
  const entries = await Promise.all(
    blockNumbers.map(async (blockNumber) => {
      const block = await publicClient.getBlock({ blockNumber });
      return [blockNumber, new Date(Number(block.timestamp) * 1000)] as const;
    })
  );
  return new Map(entries);
}

function projectedSettlementKey(settlement: ProjectedSettlement): string {
  return `${settlement.transactionHash.toLowerCase()}:${settlement.taskId.toLowerCase()}`;
}

function completionEventKey(log: EventLog): string {
  return `${String(log.transactionHash).toLowerCase()}:${String(log.args.taskId).toLowerCase()}`;
}

async function processTaskCompletedSettlement(
  settlement: ProjectedSettlement,
  settledAt: Date
): Promise<void> {
  await recordTaskSettlement(db, {
    chainId: config.CHAIN_ID,
    settledAt,
    settlement,
  });

  console.log(
    `TaskCompleted settlement: ${settlement.taskId} - ${settlement.awards.length} award(s)`
  );
}

async function processTaskRatedEvent(log: EventLog): Promise<void> {
  const { taskId, worker, rating, raterAgentId } = log.args;

  await projectSettlementRating(db, {
    rating: Number(rating),
    taskId: taskId as string,
    workerAddress: worker as string,
  });

  // Backfill the rater agent id onto any feedback row that the rate route already
  // inserted but didn't populate (e.g. requester wasn't registered at the time of
  // the rate call). Idempotent: setting the same value is a no-op.
  if (raterAgentId !== undefined && raterAgentId !== null) {
    const agentIdStr = (raterAgentId as bigint).toString();
    if (agentIdStr !== '0') {
      await db
        .update(feedbacks)
        .set({ requesterAgentId: agentIdStr })
        .where(
          and(
            eq(feedbacks.taskId, taskId as string),
            sql`lower(${feedbacks.workerAddress}) = lower(${worker as string})`
          )
        );
    }
  }

  console.log(`TaskRated event: ${taskId} - ${rating} stars (raterAgentId=${raterAgentId})`);
}

type BlockTimestampReader = {
  getBlock: (args: { blockNumber: bigint }) => Promise<{ timestamp: bigint }>;
};

export async function processTaskSubmittedEvent(
  log: EventLog,
  database: Database = db,
  client: BlockTimestampReader = publicClient
): Promise<void> {
  const { taskId, worker, deliverable } = log.args;

  await database
    .update(submissions)
    .set({ deliverableHash: deliverable as string })
    .where(
      and(eq(submissions.taskId, taskId as string), eq(submissions.workerAddress, worker as string))
    );

  // When an evaluator is assigned, acceptSubmission transitions the task to Review
  // and starts the evaluation clock. Set review status and deadline from the DB-stored
  // evaluationWindow (set at task creation or assignEvaluator time).
  const taskRow = await database
    .select({
      evaluator: tasks.evaluator,
      evaluationWindow: tasks.evaluationWindow,
      mode: tasks.mode,
    })
    .from(tasks)
    .where(eq(tasks.id, taskId as string))
    .limit(1);
  const task = taskRow[0];
  if (shouldStartEvaluatorReview(task) && log.blockNumber != null) {
    const block = await client.getBlock({ blockNumber: log.blockNumber });
    const submittedAt = Number(block.timestamp);
    // Guarded to the pre-review states submitWork is callable from (see
    // submissions.router.ts's `submittable` check), plus 'pending_approval'
    // -- for claim/pitch/auction modes (the only modes this branch applies
    // to, since shouldStartEvaluatorReview excludes bounty/benchmark), the
    // same router mutation already flips status to 'pending_approval'
    // synchronously on submit, before this event is processed, so that is
    // the state this handler normally finds. So a late-processed event can't
    // regress a task that has since advanced further (see ADR-0007).
    await database
      .update(tasks)
      .set({
        status: 'review',
        evaluatorDeadline: new Date((submittedAt + task.evaluationWindow) * 1000),
      })
      .where(
        and(
          eq(tasks.id, taskId as string),
          inArray(tasks.status, ['open', 'claimed', 'worker_selected', 'pending_approval'])
        )
      );
  }

  console.log(`TaskSubmitted event: ${taskId} by ${worker}, deliverable: ${deliverable}`);
}

async function processSubmissionRejectedEvent(log: EventLog): Promise<void> {
  const { taskId, worker } = log.args;
  await db
    .update(submissions)
    .set({ rejectedAt: new Date() })
    .where(
      and(eq(submissions.taskId, taskId as string), eq(submissions.workerAddress, worker as string))
    );
  console.log(`SubmissionRejected event: task=${taskId} worker=${worker}`);
}

export async function processBidSubmittedEvent(
  log: EventLog,
  database: Database = db
): Promise<void> {
  const { taskId, worker, price } = log.args;

  // The bids router writes the canonical row at submission time via
  // contractSubmitBid, keyed on (taskId, worker) per the bids_task_worker_unique
  // constraint -- a re-bid updates that same row's price rather than adding a new
  // one. This handler is reconciliation only, for a bid placed on-chain without
  // going through the router: if no row exists yet for (taskId, worker), insert
  // one so the DB and chain are eventually consistent. Generates a random id (not
  // log.transactionHash) so a bids.id is always UUID-shaped regardless of which
  // side's insert actually lands -- the router's own insert also uses randomUUID,
  // and letting the two diverge by format was avoidable, not load-bearing (nothing
  // reads bids.id as a tx hash; the event's own tx hash is recorded in indexedEvents,
  // keyed by (chainId, blockNumber, logIndex) rather than joinable to this bid row
  // directly, not protocolEvents, which only covers admin/config events). onConflictDoNothing
  // (rather than a separate existence check first) makes this atomic against the router's
  // own write racing in between -- the router's insert is itself an upsert on the
  // same (taskId, worker) key, so whichever side lands second here just no-ops
  // instead of hitting the unique constraint.
  if (!log.transactionHash) return;

  await database
    .insert(bids)
    .values({
      id: randomUUID(),
      taskId: taskId as string,
      workerAddress: worker as string,
      price: (price as bigint).toString(),
    })
    .onConflictDoNothing();

  console.log(`BidSubmitted event: ${taskId} by ${worker}, price: ${price}`);
}

async function processStakeForfeitedEvent(log: EventLog): Promise<void> {
  const { taskId, worker, stakeAmount } = log.args;

  await db
    .update(claims)
    .set({ status: 'forfeited' })
    .where(and(eq(claims.taskId, taskId as string), eq(claims.workerAddress, worker as string)));

  console.log(`StakeForfeited event: ${taskId} from ${worker}, amount: ${stakeAmount}`);
}

async function processStakeReturnedEvent(log: EventLog): Promise<void> {
  const { taskId, worker, stakeAmount } = log.args;

  await db
    .update(claims)
    .set({ status: 'returned' })
    .where(and(eq(claims.taskId, taskId as string), eq(claims.workerAddress, worker as string)));

  console.log(`StakeReturned event: ${taskId} to ${worker}, amount: ${stakeAmount}`);
}

export async function processTaskExpiredEvent(
  log: EventLog,
  database: Database = db
): Promise<void> {
  const { taskId } = log.args;

  // Guarded against the terminal states refundExpired() itself already
  // rejects (see tasks.router.ts) so a late-processed event can't regress a
  // task that has since reached one of them (see ADR-0007).
  const updated = await database
    .update(tasks)
    .set({ status: 'expired' })
    .where(
      and(
        eq(tasks.id, taskId as string),
        notInArray(tasks.status, ['expired', 'completed', 'cancelled'])
      )
    )
    .returning({ id: tasks.id });

  if (updated.length === 0) {
    console.log(`TaskExpired event: ${taskId} skipped -- task status has already advanced`);
    return;
  }
  console.log(`TaskExpired event: ${taskId}`);
}

export async function processTaskCancelledEvent(
  log: EventLog,
  database: Database = db
): Promise<void> {
  const { taskId } = log.args;

  // Guarded to only apply from 'open' (the only state cancel() accepts from
  // -- see tasks.router.ts) so a late-processed event can't regress a task
  // that has since advanced further (see ADR-0007).
  const updated = await database
    .update(tasks)
    .set({ status: 'cancelled', cancelledAt: new Date() })
    .where(and(eq(tasks.id, taskId as string), eq(tasks.status, 'open')))
    .returning({ id: tasks.id });

  if (updated.length === 0) {
    console.log(`TaskCancelled event: ${taskId} skipped -- task status has already advanced`);
    return;
  }
  console.log(`TaskCancelled event: ${taskId}`);
}

async function processTaskUpdatedEvent(log: EventLog): Promise<void> {
  const { taskId, newReward, newExpiryTime } = log.args;

  await db
    .update(tasks)
    .set({
      reward: (newReward as bigint).toString(),
      expiryTime: new Date(Number(newExpiryTime as bigint) * 1000),
    })
    .where(eq(tasks.id, taskId as string));

  console.log(`TaskUpdated event: ${taskId}`);
}

async function processPitchSubmittedEvent(log: EventLog): Promise<void> {
  const { taskId, worker, pitchHash } = log.args;
  if (!log.transactionHash) return;

  // The pitches router writes the canonical row at submission time with the
  // same pitchHash and submitTxHash. Reconciliation only — if the row exists
  // but the hash/txHash were never persisted (e.g. server crashed between
  // contract call and DB insert), patch them in here.
  await db
    .update(proposals)
    .set({ pitchHash: pitchHash as string, submitTxHash: log.transactionHash })
    .where(
      and(eq(proposals.taskId, taskId as string), eq(proposals.workerAddress, worker as string))
    );

  console.log(`PitchSubmitted event: ${taskId} by ${worker}, hash: ${pitchHash}`);
}

async function processProofSubmittedEvent(log: EventLog): Promise<void> {
  const { taskId, worker, proofHash } = log.args;
  if (!log.transactionHash) return;

  await db
    .update(proofs)
    .set({ proofHash: proofHash as string, submitTxHash: log.transactionHash })
    .where(and(eq(proofs.taskId, taskId as string), eq(proofs.workerAddress, worker as string)));

  console.log(`ProofSubmitted event: ${taskId} by ${worker}, hash: ${proofHash}`);
}

export async function processAuctionAcceptedEvent(
  log: EventLog,
  database: Database = db
): Promise<void> {
  const { taskId, worker, acceptedPrice } = log.args;

  // Idempotent reconciliation: the acceptAuction router already moved the task
  // to status=claimed with this worker; this handler is the on-chain witness.
  // Mostly a no-op DB-wise (state already reflected), but it does ensure the
  // task row is consistent with the chain in cases where the router-side write
  // failed after the contract call landed. Guarded to only apply from 'open'
  // (the only state auction-accept/select-winner accept from -- see
  // bids.router.ts) so a late-processed event can't regress a task that has
  // since advanced further (see ADR-0007).
  const updated = await database
    .update(tasks)
    .set({ status: 'claimed', claimedBy: worker as string })
    .where(and(eq(tasks.id, taskId as string), eq(tasks.status, 'open')))
    .returning({ id: tasks.id });

  if (updated.length === 0) {
    console.log(`AuctionAccepted event: ${taskId} skipped -- task status has already advanced`);
    return;
  }
  console.log(`AuctionAccepted event: ${taskId} by ${worker}, price: ${acceptedPrice}`);
}

/**
 * BigInts have no JSON representation, so they are stringified before the jsonb
 * insert. Recurses through arrays and structs -- DiamondCut's FacetCut[] argument is
 * nested, and a top-level-only conversion would throw on any future event carrying a
 * bigint inside a tuple.
 */
function serialiseArg(value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return value.map(serialiseArg);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, serialiseArg(v)])
    );
  }
  return value;
}

/**
 * Generic handler for the four admin/config events. Writes the raw event args
 * to the protocol_events audit log so we have a queryable history of every
 * protocol-level change with full provenance. BigInts are serialised as
 * strings so JSON.stringify doesn't throw.
 */
async function processProtocolEvent(log: EventLog): Promise<void> {
  if (log.blockNumber == null || log.logIndex == null || !log.transactionHash) return;

  const serialisedArgs: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(log.args)) {
    serialisedArgs[k] = serialiseArg(v);
  }

  await db
    .insert(protocolEvents)
    .values({
      eventName: log.eventName,
      chainId: config.CHAIN_ID,
      blockNumber: log.blockNumber,
      logIndex: log.logIndex,
      txHash: log.transactionHash,
      args: serialisedArgs,
    })
    .onConflictDoNothing();

  console.log(`${log.eventName} event:`, serialisedArgs);
}

export async function processTaskReopenedEvent(
  log: EventLog,
  database: Database = db
): Promise<void> {
  const { taskId } = log.args;

  // Guarded to only apply from 'claimed' (the only state forfeitAndReopen()
  // accepts from -- see claims.router.ts) so a late-processed event can't
  // regress a task that has since advanced further (see ADR-0007).
  const updated = await database
    .update(tasks)
    .set({
      status: 'open',
      claimedBy: null,
      claimedAt: null,
    })
    .where(and(eq(tasks.id, taskId as string), eq(tasks.status, 'claimed')))
    .returning({ id: tasks.id });

  if (updated.length === 0) {
    console.log(`TaskReopened event: ${taskId} skipped -- task status has already advanced`);
    return;
  }
  console.log(`TaskReopened event: ${taskId}`);
}

async function processHookRegisteredEvent(log: EventLog): Promise<void> {
  const { taskId, hookContract } = log.args;
  await db
    .update(tasks)
    .set({ hookContract: hookContract as string })
    .where(eq(tasks.id, taskId as string));
  console.log(`HookRegistered event: task=${taskId} hook=${hookContract}`);
}

async function processEvaluatorAssignedEvent(log: EventLog): Promise<void> {
  const { taskId, evaluator, stakeAmount } = log.args;
  await db
    .update(tasks)
    .set({
      evaluator: evaluator as string,
      evaluatorStake: (stakeAmount as bigint).toString(),
    })
    .where(eq(tasks.id, taskId as string));
  console.log(`EvaluatorAssigned event: task=${taskId} evaluator=${evaluator}`);
}

export async function processTaskEvaluatedEvent(
  log: EventLog,
  database: Database = db,
  readTaskWorker: typeof contractGetTaskWorker = contractGetTaskWorker,
  client: BlockTimestampReader = publicClient
): Promise<void> {
  const { taskId, verdictType, score } = log.args;
  const VERDICT_TYPES = ['APPROVE', 'REJECT', 'PARTIAL'];
  const verdictStr = VERDICT_TYPES[Number(verdictType)] ?? 'APPROVE';
  const taskRows = await database
    .select({
      contractAddress: tasks.contractAddress,
      appealWindow: tasks.appealWindow,
      expiryTime: tasks.expiryTime,
      mode: tasks.mode,
      status: tasks.status,
    })
    .from(tasks)
    .where(eq(tasks.id, taskId as string))
    .limit(1);
  const task = taskRows[0];
  const canApply =
    task !== undefined && ['open', 'pending_approval', 'review'].includes(task.status);
  const isContest = task?.mode === 'bounty' || task?.mode === 'benchmark';
  let canonicalWorker: string | null | undefined;
  let recoveredAppealDeadline: Date | undefined;
  let recoveredExpiryTime: Date | undefined;

  if (canApply) {
    if (task.appealWindow == null || log.blockNumber == null) {
      throw new Error(`TaskEvaluated event: task=${taskId} is missing appeal timing context`);
    }

    const [block, worker] = await Promise.all([
      client.getBlock({ blockNumber: log.blockNumber }),
      isContest
        ? readTaskWorker(taskId as `0x${string}`, task.contractAddress)
        : Promise.resolve(null),
    ]);
    recoveredAppealDeadline = new Date((Number(block.timestamp) + task.appealWindow) * 1000);
    recoveredExpiryTime =
      recoveredAppealDeadline > task.expiryTime ? recoveredAppealDeadline : task.expiryTime;

    if (worker !== null) {
      canonicalWorker = worker.toLowerCase() === zeroAddress ? null : normalizeAddress(worker);
    }
  }
  // Guarded to the states evaluate() is callable from (see
  // evaluations.router.ts's isOpenModeEval/isReviewModeEval checks) so a
  // late-processed event can't regress a task that a synchronous write --
  // e.g. finalizeVerdict's all-zero-award completion -- has since moved past
  // (see ADR-0007; this was observed live: the settlement race fixed in
  // finalizeVerdict/resolveDispute exposed exactly this handler regressing
  // 'completed' back to 'appealing').
  const updated = await database
    .update(tasks)
    .set({
      status: 'appealing',
      verdictType: verdictStr,
      verdictScore: Number(score),
      ...(canonicalWorker !== undefined ? { claimedBy: canonicalWorker } : {}),
      ...(recoveredAppealDeadline !== undefined
        ? {
            appealDeadline: recoveredAppealDeadline,
            expiryTime: recoveredExpiryTime,
          }
        : {}),
    })
    .where(
      and(
        eq(tasks.id, taskId as string),
        inArray(tasks.status, ['open', 'pending_approval', 'review'])
      )
    )
    .returning({ id: tasks.id });
  if (updated.length === 0) {
    console.log(`TaskEvaluated event: task=${taskId} skipped -- task status has already advanced`);
    return;
  }
  console.log(`TaskEvaluated event: task=${taskId} verdict=${verdictStr}`);
}

export async function processTaskAppealedEvent(
  log: EventLog,
  database: Database = db
): Promise<void> {
  const { taskId } = log.args;
  // Guarded to only apply from 'appealing' (the only state appeal() accepts
  // from -- see evaluations.router.ts) so a late-processed event can't
  // regress a task that has since advanced further (see ADR-0007).
  const updated = await database
    .update(tasks)
    .set({ status: 'disputed' })
    .where(and(eq(tasks.id, taskId as string), eq(tasks.status, 'appealing')))
    .returning({ id: tasks.id });
  if (updated.length === 0) {
    console.log(`TaskAppealed event: task=${taskId} skipped -- task status has already advanced`);
    return;
  }
  console.log(`TaskAppealed event: task=${taskId}`);
}

export async function processEvaluatorTimedOutEvent(
  log: EventLog,
  database: Database = db
): Promise<void> {
  const { taskId } = log.args;
  // Guarded to only apply from 'review' (the only state evaluatorTimeout()
  // accepts from -- see evaluations.router.ts) so a late-processed event
  // can't regress a task that has since advanced further (see ADR-0007).
  const updated = await database
    .update(tasks)
    .set({
      status: 'pending_approval',
      evaluator: null,
      evaluatorStake: '0',
      evaluatorDeadline: null,
    })
    .where(and(eq(tasks.id, taskId as string), eq(tasks.status, 'review')))
    .returning({ id: tasks.id });
  if (updated.length === 0) {
    console.log(
      `EvaluatorTimedOut event: task=${taskId} skipped -- task status has already advanced`
    );
    return;
  }
  console.log(`EvaluatorTimedOut event: task=${taskId}`);
}

async function processSelfAwardEvent(log: EventLog): Promise<void> {
  const { taskId } = log.args;
  await db
    .update(tasks)
    .set({ selfAward: true })
    .where(eq(tasks.id, taskId as string));
  console.log(`SelfAward event: task=${taskId}`);
}

// Map on-chain keccak256("event_type") hashes to readable strings for DB storage.
const EVENT_TYPE_MAP: Record<string, string> = {
  [keccak256(toBytes('completed'))]: 'completed',
  [keccak256(toBytes('cancelled_after_submissions'))]: 'cancelled_after_submissions',
  [keccak256(toBytes('expired_no_action'))]: 'expired_no_action',
  [keccak256(toBytes('expired_after_rejections'))]: 'expired_after_rejections',
};

async function processRequesterReputationEvent(log: EventLog): Promise<void> {
  const { taskId, requester, event_, reward, submissionCount, selfAward } = log.args;

  const eventType = EVENT_TYPE_MAP[(event_ as string).toLowerCase()] ?? (event_ as string);

  // Count unique workers who submitted to this task (excluding rejected-only submissions).
  const uniqueWorkersResult = await db
    .select({ count: sql<number>`count(distinct ${submissions.workerAddress})` })
    .from(submissions)
    .where(and(eq(submissions.taskId, taskId as string), sql`${submissions.rejectedAt} IS NULL`));
  const uniqueWorkers = Number(uniqueWorkersResult[0]?.count ?? 0);

  await recordRequesterReputationEvent(db, {
    taskId: taskId as string,
    requester: (requester as string).toLowerCase(),
    eventType,
    reward: (reward as bigint).toString(),
    submissionCount: Number(submissionCount),
    uniqueWorkers,
    selfAward: selfAward as boolean,
  });

  console.log(`RequesterReputation event: task=${taskId} requester=${requester} type=${eventType}`);
}

function processAdminAuditEvent(log: EventLog): void {
  switch (log.eventName) {
    case 'Paused':
      console.log(`[audit] Contract paused by account=${log.args.account}`);
      break;
    case 'Unpaused':
      console.log(`[audit] Contract unpaused by account=${log.args.account}`);
      break;
    case 'OwnershipTransferStarted':
      console.log(
        `[audit] Ownership transfer started: previousOwner=${log.args.previousOwner} newOwner=${log.args.newOwner}`
      );
      break;
    case 'OwnershipTransferred':
      console.log(
        `[audit] Ownership transferred: previousOwner=${log.args.previousOwner} newOwner=${log.args.newOwner}`
      );
      break;
  }
}

async function dispatchMainEvent(log: EventLog): Promise<boolean> {
  switch (log.eventName) {
    case 'TaskCreated':
      await processTaskCreatedEvent(log);
      break;
    case 'TaskClaimed':
      await processTaskClaimedEvent(log);
      break;
    case 'TaskWorkerSelected':
      await processTaskWorkerSelectedEvent(log);
      break;
    case 'TaskRated':
      await processTaskRatedEvent(log);
      break;
    case 'TaskSubmitted':
      await processTaskSubmittedEvent(log);
      break;
    case 'BidSubmitted':
      await processBidSubmittedEvent(log);
      break;
    case 'TaskExpired':
      await processTaskExpiredEvent(log);
      break;
    case 'StakeForfeited':
      await processStakeForfeitedEvent(log);
      break;
    case 'StakeReturned':
      await processStakeReturnedEvent(log);
      break;
    case 'TaskReopened':
      await processTaskReopenedEvent(log);
      break;
    case 'TaskCancelled':
      await processTaskCancelledEvent(log);
      break;
    case 'TaskUpdated':
      await processTaskUpdatedEvent(log);
      break;
    case 'PitchSubmitted':
      await processPitchSubmittedEvent(log);
      break;
    case 'ProofSubmitted':
      await processProofSubmittedEvent(log);
      break;
    case 'AuctionAccepted':
      await processAuctionAcceptedEvent(log);
      break;
    case 'FeesUpdated':
    case 'FeeRecipientUpdated':
    case 'ForwarderUpdated':
    case 'ReputationRegistryUpdated':
    case 'MinAppealWindowUpdated':
    case 'DefaultHooksSet':
    case 'DiamondCut':
      await processProtocolEvent(log);
      break;
    // Both record an on-chain call that failed without reverting the surrounding
    // transaction, so nothing else in the system can observe them. They are written
    // to the protocol audit log and surfaced at warn level rather than projected --
    // there is no per-task state to update, only an operational signal that a hook
    // or the reputation registry is misbehaving.
    case 'HookCallFailed':
      console.warn(`[indexer] HookCallFailed: hook=${log.args.hook} tx=${log.transactionHash}`);
      await processProtocolEvent(log);
      break;
    case 'ReputationFeedbackFailed':
      console.warn(
        `[indexer] ReputationFeedbackFailed: task=${log.args.taskId} agentId=${log.args.agentId} tx=${log.transactionHash}`
      );
      await processProtocolEvent(log);
      break;
    case 'HookRegistered':
      await processHookRegisteredEvent(log);
      break;
    case 'EvaluatorAssigned':
      await processEvaluatorAssignedEvent(log);
      break;
    case 'TaskEvaluated':
      await processTaskEvaluatedEvent(log);
      break;
    case 'TaskAppealed':
      await processTaskAppealedEvent(log);
      break;
    case 'TaskDisputed':
      // TaskDisputed fires alongside TaskAppealed; no additional DB update is needed.
      break;
    case 'EvaluatorTimedOut':
      await processEvaluatorTimedOutEvent(log);
      break;
    case 'SubmissionRejected':
      await processSubmissionRejectedEvent(log);
      break;
    case 'SelfAward':
      await processSelfAwardEvent(log);
      break;
    case 'RequesterReputation':
      await processRequesterReputationEvent(log);
      break;
    case 'Paused':
    case 'Unpaused':
    case 'OwnershipTransferStarted':
    case 'OwnershipTransferred':
      processAdminAuditEvent(log);
      break;
    default:
      return false;
  }

  return true;
}

// Implements: ADR-0005 (main stream blocks on a failed event instead of skipping)
async function processEvents(fromBlock: bigint, toBlock: bigint): Promise<void> {
  const contractAddress = config.CONTRACT_ADDRESS as `0x${string}`;

  const logs = (await publicClient.getLogs({
    address: contractAddress,
    fromBlock,
    toBlock,
    events: MAIN_CONTRACT_EVENTS as any,
  })) as unknown as EventLog[];

  const completionLogs = toSettlementCompletionLogs(logs);
  const projectedSettlements =
    completionLogs.length > 0
      ? projectSettlementLogs(completionLogs, await readSettlementChainStates(completionLogs))
      : [];
  const settlementByKey = new Map(
    projectedSettlements.map((settlement) => [projectedSettlementKey(settlement), settlement])
  );
  const settlementTimes =
    completionLogs.length > 0 ? await readSettlementTimes(completionLogs) : new Map<bigint, Date>();
  const processedSettlementKeys = new Set<string>();

  for (const log of logs) {
    try {
      if (log.eventName === 'TaskCompleted') {
        const key = completionEventKey(log);
        if (processedSettlementKeys.has(key)) continue;
        const settlement = settlementByKey.get(key);
        if (!settlement) {
          throw new Error(`Missing settlement projection for TaskCompleted group ${key}`);
        }
        const settledAt = settlementTimes.get(settlement.blockNumber);
        if (!settledAt) {
          throw new Error(`Missing block timestamp for settlement ${key}`);
        }

        // Process every payout event in the transaction as one unit. Any failure
        // escapes processEvents so the range checkpoint is not advanced.
        await processTaskCompletedSettlement(settlement, settledAt);
        processedSettlementKeys.add(key);
        continue;
      }

      await processIndexedEvent(log, {
        isAlreadyProcessed,
        markProcessed,
        processEvent: dispatchMainEvent,
      });
    } catch (error) {
      // Main-stream events must apply in order, so a failure here has to block
      // the range checkpoint rather than skip ahead -- the next poll retries the
      // same range. Logged with full event context (and re-thrown, not
      // swallowed) so a stall is diagnosable from logs instead of silent.
      console.error('[indexer] main stream stalled on event', {
        eventName: log.eventName,
        taskId: typeof log.args.taskId === 'string' ? log.args.taskId : undefined,
        blockNumber: log.blockNumber?.toString(),
        logIndex: log.logIndex,
        transactionHash: log.transactionHash,
        error,
      });
      throw error;
    }
  }
}

async function processIdentityEvents(fromBlock: bigint, toBlock: bigint): Promise<void> {
  const logs = (await publicClient.getLogs({
    address: IDENTITY_REGISTRY_ADDRESS,
    event: METADATA_SET_EVENT,
    fromBlock,
    toBlock,
  })) as unknown as EventLog[];

  for (const log of logs) {
    try {
      const { agentId, metadataKey, metadataValue } = log.args;
      if (metadataKey !== 'agentWallet') continue;

      const agentIdStr = (agentId as bigint).toString();

      if (!metadataValue || metadataValue === '0x') {
        // Cleared: unsetAgentWallet or token transfer — null out agentId for this row
        await db
          .update(agents)
          .set({ agentId: null, updatedAt: new Date() })
          .where(eq(agents.agentId, agentIdStr));
      } else {
        // abi.encodePacked(address) = 20 raw bytes; first 40 hex chars after '0x'
        const wallet = normalizeAddress(
          '0x' + (metadataValue as string).slice(2, 42)
        ) as `0x${string}`;

        // identity.router.ts's register() calls the registry's register() with no
        // arguments, signed by this server's own relayer wallet (createServerWallet())
        // -- so the registry defaults agentWallet metadata to msg.sender, which is
        // ALWAYS this server's own address, never the real end user's. The real
        // requester/worker <-> agentId association is tracked purely off-chain, by
        // identity.router.ts's own insert/update using the actual payer address.
        // Treating this MetadataSet event as authoritative for the server's own
        // address would create a bogus agents row that then permanently squats on
        // whichever agentId happened to be minted first -- colliding with the real
        // owner's row the moment that same agentId gets legitimately assigned
        // through identity.router.ts (see issue #208).
        if (wallet === serverAddress) continue;

        // onConflictDoNothing: a wallet can own multiple agentIds (ERC-721 allows it).
        // We keep the FIRST agentId associated with each wallet address.
        await db
          .insert(agents)
          .values({
            address: wallet,
            agentId: agentIdStr,
            identityRegistryAddress: IDENTITY_REGISTRY_ADDRESS.toLowerCase(),
            chainId: config.CHAIN_ID,
          })
          .onConflictDoNothing();
      }
    } catch (error) {
      console.error('Error processing MetadataSet event:', error);
    }
  }
}

/**
 * DREAMS reward hook events (RewardConfigured, RewardReserved, RewardPaid,
 * RewardReserveReleased, RewardsWithdrawn, PriceUpdated, BonusBpsUpdated) are
 * all polled from a separate contract address (DREAMS_HOOK_ADDRESS) and routed
 * through the generic protocol_events audit log — same pattern as the main
 * contract's admin/config events (FeesUpdated, FeeRecipientUpdated, etc). All
 * reward-hook data is otherwise read on-demand via readContract, so this is
 * the only historical record of past payouts and rate/bonus changes.
 */
async function processRewardHookEvents(fromBlock: bigint, toBlock: bigint): Promise<void> {
  if (!DREAMS_HOOK_ADDRESS) return;

  const logs = (await publicClient.getLogs({
    address: DREAMS_HOOK_ADDRESS,
    fromBlock,
    toBlock,
    events: REWARD_HOOK_EVENT_ITEMS as any,
  })) as unknown as EventLog[];

  for (const log of logs) {
    try {
      if (await isAlreadyProcessed(log)) continue;
      await processProtocolEvent(log);
      await markProcessed(log);
    } catch (error) {
      console.error(`Error processing reward hook event ${log.eventName}:`, error);
    }
  }
}

/**
 * RewardVault and EpochBudget events. Both are routed through the same generic
 * protocol_events audit log as the reward hook's -- no new tables, no schema change,
 * and every arg is preserved verbatim in the jsonb column.
 *
 * Event names are qualified with the emitting contract before they are stored.
 * RewardVault and EpochBudget BOTH declare an event called `Released` with different
 * parameters (a task-scoped release versus a requester/worker budget release); they
 * are distinguished by emitting address, not by name, so storing the bare name would
 * conflate two unrelated events in protocol_events.event_name.
 */
async function processQualifiedHookEvents(
  address: `0x${string}`,
  contractName: string,
  events: readonly unknown[],
  fromBlock: bigint,
  toBlock: bigint
): Promise<void> {
  const logs = (await publicClient.getLogs({
    address,
    fromBlock,
    toBlock,
    events: events as any,
  })) as unknown as EventLog[];

  for (const log of logs) {
    try {
      if (await isAlreadyProcessed(log)) continue;
      await processProtocolEvent({ ...log, eventName: `${contractName}.${log.eventName}` });
      await markProcessed(log);
    } catch (error) {
      console.error(`Error processing ${contractName} event ${log.eventName}:`, error);
    }
  }
}

async function processRewardVaultEvents(fromBlock: bigint, toBlock: bigint): Promise<void> {
  if (!DREAMS_VAULT_ADDRESS) return;
  await processQualifiedHookEvents(
    DREAMS_VAULT_ADDRESS,
    'RewardVault',
    REWARD_VAULT_EVENT_ITEMS,
    fromBlock,
    toBlock
  );
}

async function processEpochBudgetEvents(fromBlock: bigint, toBlock: bigint): Promise<void> {
  if (!DREAMS_EPOCH_BUDGET_ADDRESS) return;
  await processQualifiedHookEvents(
    DREAMS_EPOCH_BUDGET_ADDRESS,
    'EpochBudget',
    EPOCH_BUDGET_EVENT_ITEMS,
    fromBlock,
    toBlock
  );
}

async function processInChunks(
  fromBlock: bigint,
  toBlock: bigint,
  fn: (from: bigint, to: bigint) => Promise<void>
): Promise<void> {
  let from = fromBlock;
  while (from <= toBlock) {
    const to = from + MAX_BLOCK_RANGE - 1n < toBlock ? from + MAX_BLOCK_RANGE - 1n : toBlock;
    await fn(from, to);
    from = to + 1n;
  }
}

async function pollIndexerOnce(): Promise<void> {
  const lastBlock = await getLastBlock('main', config.CONTRACT_DEPLOY_BLOCK);
  const latestBlock = await publicClient.getBlockNumber();

  if (latestBlock > lastBlock) {
    console.log(`Indexing blocks ${lastBlock + 1n} to ${latestBlock}`);
    await runCheckpointedRange(
      lastBlock + 1n,
      latestBlock,
      (fromBlock, toBlock) => processInChunks(fromBlock, toBlock, processEvents),
      (blockNumber) => setLastBlock('main', blockNumber)
    );
  }

  const erc8004LastBlock = await getLastBlock('erc8004', ERC8004_SEED_BLOCK);
  if (latestBlock > erc8004LastBlock) {
    await processInChunks(erc8004LastBlock + 1n, latestBlock, processIdentityEvents);
    await setLastBlock('erc8004', latestBlock);
  }

  if (DREAMS_HOOK_ADDRESS) {
    const rewardHookLastBlock = await getLastBlock('dreams_hook', DREAMS_HOOK_SEED_BLOCK);
    if (latestBlock > rewardHookLastBlock) {
      await processInChunks(rewardHookLastBlock + 1n, latestBlock, processRewardHookEvents);
      await setLastBlock('dreams_hook', latestBlock);
    }
  }

  if (DREAMS_VAULT_ADDRESS) {
    const vaultLastBlock = await getLastBlock('reward_vault', DREAMS_VAULT_SEED_BLOCK);
    if (latestBlock > vaultLastBlock) {
      await processInChunks(vaultLastBlock + 1n, latestBlock, processRewardVaultEvents);
      await setLastBlock('reward_vault', latestBlock);
    }
  }

  if (DREAMS_EPOCH_BUDGET_ADDRESS) {
    const budgetLastBlock = await getLastBlock('epoch_budget', DREAMS_EPOCH_BUDGET_SEED_BLOCK);
    if (latestBlock > budgetLastBlock) {
      await processInChunks(budgetLastBlock + 1n, latestBlock, processEpochBudgetEvents);
      await setLastBlock('epoch_budget', latestBlock);
    }
  }
}

const pollIndexer = createSerializedPoll(() =>
  runWithRpcOperation({ kind: 'background', name: 'indexer' }, pollIndexerOnce)
);
let pollingStarted = false;

/** Catch up every configured indexer and reject if any range remains incomplete. */
export async function catchUpIndexer(): Promise<void> {
  await pollIndexer();
}

/** Begin periodic polling after strict startup reconciliation has succeeded. */
export function startIndexerPolling(): void {
  if (pollingStarted) return;
  pollingStarted = true;
  setInterval(() => {
    void pollIndexer().catch((error) => console.error('Indexer error:', error));
  }, POLL_INTERVAL);
  console.log(`Event indexer started (polling every ${POLL_INTERVAL}ms)`);
}

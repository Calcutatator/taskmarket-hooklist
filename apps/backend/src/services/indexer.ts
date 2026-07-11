import { createPublicClient, http, keccak256, parseAbiItem, slice, toBytes } from 'viem';
import { base, baseSepolia } from 'viem/chains';
import { db } from '../db/client';
import {
  tasks,
  claims,
  agents,
  bids,
  feedbacks,
  indexerState,
  indexedEvents,
  platformFees,
  proofs,
  proposals,
  protocolEvents,
  submissions,
  requesterReputationEvents,
} from '../db/schema';
import { and, eq, sql } from 'drizzle-orm';
import { getServerConfig } from '../config/env';
import { shouldStartEvaluatorReview } from './task-evaluator';

type EventLog = {
  args: Record<string, unknown>;
  eventName: string;
  blockNumber?: bigint | null;
  logIndex?: number | null;
  transactionHash?: `0x${string}` | null;
};

const config = getServerConfig();

const publicClient = createPublicClient({
  chain: config.CHAIN_ID === 84532 ? baseSepolia : base,
  transport: http(config.BASE_RPC_URL),
});

const POLL_INTERVAL = 12000;
const MAX_BLOCK_RANGE = 10_000n;

const IDENTITY_REGISTRY_ADDRESS = config.ERC8004_IDENTITY_REGISTRY as `0x${string}`;
const ERC8004_SEED_BLOCK = config.ERC8004_SEED_BLOCK;

const DREAMS_HOOK_ADDRESS = config.DREAMS_HOOK_ADDRESS as `0x${string}` | undefined;
const DREAMS_HOOK_SEED_BLOCK = config.DREAMS_HOOK_SEED_BLOCK;

const TASK_CREATED_EVENT = parseAbiItem(
  'event TaskCreated(bytes32 indexed taskId, address indexed requester, uint256 reward, bytes4 indexed mode, uint256 expiryTime)'
);
const TASK_CLAIMED_EVENT = parseAbiItem(
  'event TaskClaimed(bytes32 indexed taskId, address indexed worker, uint256 stakeAmount)'
);
const TASK_WORKER_SELECTED_EVENT = parseAbiItem(
  'event TaskWorkerSelected(bytes32 indexed taskId, address indexed worker)'
);
const TASK_COMPLETED_EVENT = parseAbiItem(
  'event TaskCompleted(bytes32 indexed taskId, address indexed requester, address indexed worker, uint256 workerPayment, uint256 platformFee)'
);
const TASK_RATED_EVENT = parseAbiItem(
  'event TaskRated(bytes32 indexed taskId, address indexed worker, uint8 rating, uint256 raterAgentId)'
);
const TASK_SUBMITTED_EVENT = parseAbiItem(
  'event TaskSubmitted(bytes32 indexed taskId, address indexed worker, bytes32 deliverable)'
);
const BID_SUBMITTED_EVENT = parseAbiItem(
  'event BidSubmitted(bytes32 indexed taskId, address indexed worker, uint256 price)'
);
const TASK_EXPIRED_EVENT = parseAbiItem(
  'event TaskExpired(bytes32 indexed taskId, address indexed requester, uint256 refundAmount)'
);
const STAKE_FORFEITED_EVENT = parseAbiItem(
  'event StakeForfeited(bytes32 indexed taskId, address indexed worker, uint256 stakeAmount)'
);
const STAKE_RETURNED_EVENT = parseAbiItem(
  'event StakeReturned(bytes32 indexed taskId, address indexed worker, uint256 stakeAmount)'
);
const TASK_REOPENED_EVENT = parseAbiItem('event TaskReopened(bytes32 indexed taskId)');
const TASK_CANCELLED_EVENT = parseAbiItem(
  'event TaskCancelled(bytes32 indexed taskId, address indexed requester, uint256 refundAmount)'
);
const TASK_UPDATED_EVENT = parseAbiItem(
  'event TaskUpdated(bytes32 indexed taskId, uint256 newReward, uint256 newExpiryTime)'
);
const PITCH_SUBMITTED_EVENT = parseAbiItem(
  'event PitchSubmitted(bytes32 indexed taskId, address indexed worker, bytes32 pitchHash)'
);
const PROOF_SUBMITTED_EVENT = parseAbiItem(
  'event ProofSubmitted(bytes32 indexed taskId, address indexed worker, bytes32 proofHash, bytes32 proofType, uint256 metricValue)'
);
const AUCTION_ACCEPTED_EVENT = parseAbiItem(
  'event AuctionAccepted(bytes32 indexed taskId, address indexed worker, uint256 acceptedPrice)'
);
const FEES_UPDATED_EVENT = parseAbiItem('event FeesUpdated(uint16 newFeeBps)');
const FEE_RECIPIENT_UPDATED_EVENT = parseAbiItem('event FeeRecipientUpdated(address newRecipient)');
const FORWARDER_UPDATED_EVENT = parseAbiItem(
  'event ForwarderUpdated(address indexed forwarder, bool trusted)'
);
const REPUTATION_REGISTRY_UPDATED_EVENT = parseAbiItem(
  'event ReputationRegistryUpdated(address indexed newRegistry)'
);

const REWARD_CONFIGURED_EVENT = parseAbiItem(
  'event RewardConfigured(bytes32 indexed taskId, uint256 rewardUsd)'
);
const REWARD_RESERVED_EVENT = parseAbiItem(
  'event RewardReserved(bytes32 indexed taskId, address indexed worker, uint256 startPrice, uint256 reservedAmount)'
);
const REWARD_PAID_EVENT = parseAbiItem(
  'event RewardPaid(bytes32 indexed taskId, address indexed worker, uint256 rewardUsd, uint256 usdBonusValue, uint256 price, uint256 tokenAmount)'
);
const REWARD_RESERVE_RELEASED_EVENT = parseAbiItem(
  'event RewardReserveReleased(bytes32 indexed taskId, uint256 releasedAmount)'
);
const REWARDS_WITHDRAWN_EVENT = parseAbiItem(
  'event RewardsWithdrawn(address indexed wallet, address indexed destination, uint256 amount)'
);
const PRICE_UPDATED_EVENT = parseAbiItem('event PriceUpdated(uint256 dreamsPerUsdc)');
const BONUS_BPS_UPDATED_EVENT = parseAbiItem('event BonusBpsUpdated(uint16 bonusBps)');

const METADATA_SET_EVENT = parseAbiItem(
  'event MetadataSet(uint256 indexed agentId, string indexed indexedMetadataKey, string metadataKey, bytes metadataValue)'
);
const HOOK_REGISTERED_EVENT = parseAbiItem(
  'event HookRegistered(bytes32 indexed taskId, address hookContract)'
);
const EVALUATOR_ASSIGNED_EVENT = parseAbiItem(
  'event EvaluatorAssigned(bytes32 indexed taskId, address indexed evaluator, uint256 stakeAmount)'
);
const TASK_EVALUATED_EVENT = parseAbiItem(
  'event TaskEvaluated(bytes32 indexed taskId, address indexed evaluator, uint8 verdictType, uint16 score)'
);
const TASK_APPEALED_EVENT = parseAbiItem(
  'event TaskAppealed(bytes32 indexed taskId, address indexed appellant)'
);
const TASK_DISPUTED_EVENT = parseAbiItem(
  'event TaskDisputed(bytes32 indexed taskId, address indexed disputeResolver)'
);
const EVALUATOR_TIMED_OUT_EVENT = parseAbiItem(
  'event EvaluatorTimedOut(bytes32 indexed taskId, address indexed evaluator, uint256 forfeitedStake)'
);
const SUBMISSION_REJECTED_EVENT = parseAbiItem(
  'event SubmissionRejected(bytes32 indexed taskId, address indexed worker)'
);
const SELF_AWARD_EVENT = parseAbiItem(
  'event SelfAward(bytes32 indexed taskId, address indexed requester, address indexed worker)'
);
const REQUESTER_REPUTATION_EVENT = parseAbiItem(
  'event RequesterReputation(bytes32 indexed taskId, address indexed requester, bytes32 event_, uint256 reward, uint32 submissionCount, bool selfAward)'
);
const PAUSED_EVENT = parseAbiItem('event Paused(address account)');
const UNPAUSED_EVENT = parseAbiItem('event Unpaused(address account)');
const OWNERSHIP_TRANSFER_STARTED_EVENT = parseAbiItem(
  'event OwnershipTransferStarted(address indexed previousOwner, address indexed newOwner)'
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

async function processTaskCreatedEvent(log: EventLog): Promise<void> {
  const { taskId, requester, reward, expiryTime, mode } = log.args;
  const modeKey = (mode as `0x${string}`).toLowerCase();
  const modeString = MODE_BY_SELECTOR[modeKey] || 'bounty';

  await db
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
      stakeRequired: 0,
      stakeBps: 0,
      platformFeeBps: 500,
    })
    .onConflictDoNothing();

  // Ensure the requester has an agent row so they appear in the directory
  await db
    .insert(agents)
    .values({ address: requester as string })
    .onConflictDoNothing();

  console.log(`TaskCreated event: ${taskId} by ${requester}, mode: ${modeString}`);
}

async function processTaskClaimedEvent(log: EventLog): Promise<void> {
  const { taskId, worker, stakeAmount } = log.args;

  await db
    .update(tasks)
    .set({
      status: 'claimed',
      claimedBy: worker as string,
      claimedAt: new Date(),
    })
    .where(eq(tasks.id, taskId as string));

  await db
    .update(claims)
    .set({ stakeAmount: stakeAmount!.toString() })
    .where(eq(claims.taskId, taskId as string));

  console.log(`TaskClaimed event: ${taskId} by ${worker}, stake: ${stakeAmount}`);
}

async function processTaskWorkerSelectedEvent(log: EventLog): Promise<void> {
  const { taskId, worker } = log.args;

  await db
    .update(tasks)
    .set({
      status: 'worker_selected',
      worker: worker as string,
    })
    .where(eq(tasks.id, taskId as string));

  console.log(`TaskWorkerSelected event: ${taskId} - ${worker}`);
}

async function processTaskAcceptedEvent(log: EventLog): Promise<void> {
  const { taskId, worker, workerPayment, platformFee } = log.args;

  await db
    .update(tasks)
    .set({
      status: 'completed',
      worker: worker as string,
    })
    .where(eq(tasks.id, taskId as string));

  if (Number(platformFee) > 0 && log.transactionHash) {
    await db
      .insert(platformFees)
      .values({
        taskId: taskId as string,
        amount: (platformFee as bigint).toString(),
        txHash: log.transactionHash,
      })
      .onConflictDoNothing();
  }

  const taskRow = await db
    .select({ tags: tasks.tags })
    .from(tasks)
    .where(eq(tasks.id, taskId as string))
    .limit(1);
  const tags = taskRow[0]?.tags ?? [];

  if (Number(workerPayment) > 0) {
    // The cumulative `agents.totalEarnings` and `agents.completedTasks` updates
    // below use SQL `+` aggregation, which would double-count if the indexer
    // re-processed this event. The idempotency guard at the top of processEvents
    // prevents that: the event row exists in indexed_events before this handler
    // runs again, so we never re-enter this branch for the same log.
    const skillsExpr =
      tags.length === 0
        ? sql`ARRAY[]::text[]`
        : sql`ARRAY(SELECT DISTINCT unnest(ARRAY[${sql.join(
            tags.map((t) => sql`${t}`),
            sql`, `
          )}]))`;
    await db
      .insert(agents)
      .values({
        address: worker as string,
        totalEarnings: (workerPayment as bigint).toString(),
        completedTasks: 1,
        ratedTasks: 0,
        totalStars: 0,
        skills: tags,
      })
      .onConflictDoUpdate({
        target: agents.address,
        set: {
          totalEarnings: sql`${agents.totalEarnings} + ${(workerPayment as bigint).toString()}`,
          completedTasks: sql`${agents.completedTasks} + 1`,
          skills: sql`ARRAY(SELECT DISTINCT unnest(${agents.skills} || ${skillsExpr}))`,
          updatedAt: new Date(),
        },
      });
  }

  console.log(`TaskCompleted event: ${taskId} - ${worker}, payment: ${workerPayment}`);
}

async function processTaskRatedEvent(log: EventLog): Promise<void> {
  const { taskId, worker, rating, raterAgentId } = log.args;

  await db
    .update(tasks)
    .set({ rating: Number(rating) })
    .where(eq(tasks.id, taskId as string));

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
          and(eq(feedbacks.taskId, taskId as string), eq(feedbacks.workerAddress, worker as string))
        );
    }
  }

  console.log(`TaskRated event: ${taskId} - ${rating} stars (raterAgentId=${raterAgentId})`);
}

async function processTaskSubmittedEvent(log: EventLog): Promise<void> {
  const { taskId, worker, deliverable } = log.args;

  await db
    .update(submissions)
    .set({ deliverableHash: deliverable as string })
    .where(
      and(eq(submissions.taskId, taskId as string), eq(submissions.workerAddress, worker as string))
    );

  // When an evaluator is assigned, acceptSubmission transitions the task to Review
  // and starts the evaluation clock. Set review status and deadline from the DB-stored
  // evaluationWindow (set at task creation or assignEvaluator time).
  const taskRow = await db
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
    const block = await publicClient.getBlock({ blockNumber: log.blockNumber });
    const submittedAt = Number(block.timestamp);
    await db
      .update(tasks)
      .set({
        status: 'review',
        evaluatorDeadline: new Date((submittedAt + task.evaluationWindow) * 1000),
      })
      .where(eq(tasks.id, taskId as string));
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

async function processBidSubmittedEvent(log: EventLog): Promise<void> {
  const { taskId, worker, price } = log.args;

  // The bids router writes the canonical row at submission time via
  // contractSubmitBid. This handler is reconciliation only: if no matching row
  // exists yet for (taskId, worker, price), insert one keyed on tx hash so the
  // DB and chain are eventually consistent.
  if (!log.transactionHash) return;

  const existing = await db
    .select({ id: bids.id })
    .from(bids)
    .where(
      and(
        eq(bids.taskId, taskId as string),
        eq(bids.workerAddress, worker as string),
        eq(bids.price, (price as bigint).toString())
      )
    )
    .limit(1);

  if (existing.length === 0) {
    await db.insert(bids).values({
      id: log.transactionHash,
      taskId: taskId as string,
      workerAddress: worker as string,
      price: (price as bigint).toString(),
    });
  }

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

async function processTaskExpiredEvent(log: EventLog): Promise<void> {
  const { taskId } = log.args;

  await db
    .update(tasks)
    .set({ status: 'expired' })
    .where(eq(tasks.id, taskId as string));

  console.log(`TaskExpired event: ${taskId}`);
}

async function processTaskCancelledEvent(log: EventLog): Promise<void> {
  const { taskId } = log.args;

  await db
    .update(tasks)
    .set({ status: 'cancelled', cancelledAt: new Date() })
    .where(eq(tasks.id, taskId as string));

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

async function processAuctionAcceptedEvent(log: EventLog): Promise<void> {
  const { taskId, worker, acceptedPrice } = log.args;

  // Idempotent reconciliation: the acceptAuction router already moved the task
  // to status=claimed with this worker; this handler is the on-chain witness.
  // Mostly a no-op DB-wise (state already reflected), but it does ensure the
  // task row is consistent with the chain in cases where the router-side write
  // failed after the contract call landed.
  await db
    .update(tasks)
    .set({ status: 'claimed', worker: worker as string })
    .where(eq(tasks.id, taskId as string));

  console.log(`AuctionAccepted event: ${taskId} by ${worker}, price: ${acceptedPrice}`);
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
    serialisedArgs[k] = typeof v === 'bigint' ? v.toString() : v;
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

async function processTaskReopenedEvent(log: EventLog): Promise<void> {
  const { taskId } = log.args;

  await db
    .update(tasks)
    .set({
      status: 'open',
      claimedBy: null,
      claimedAt: null,
    })
    .where(eq(tasks.id, taskId as string));

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

async function processTaskEvaluatedEvent(log: EventLog): Promise<void> {
  const { taskId, verdictType, score } = log.args;
  const VERDICT_TYPES = ['APPROVE', 'REJECT', 'PARTIAL'];
  const verdictStr = VERDICT_TYPES[Number(verdictType)] ?? 'APPROVE';
  await db
    .update(tasks)
    .set({
      status: 'appealing',
      verdictType: verdictStr,
      verdictScore: Number(score),
    })
    .where(eq(tasks.id, taskId as string));
  console.log(`TaskEvaluated event: task=${taskId} verdict=${verdictStr}`);
}

async function processTaskAppealedEvent(log: EventLog): Promise<void> {
  const { taskId } = log.args;
  await db
    .update(tasks)
    .set({ status: 'disputed' })
    .where(eq(tasks.id, taskId as string));
  console.log(`TaskAppealed event: task=${taskId}`);
}

async function processEvaluatorTimedOutEvent(log: EventLog): Promise<void> {
  const { taskId } = log.args;
  await db
    .update(tasks)
    .set({
      status: 'pending_approval',
      evaluator: null,
      evaluatorStake: '0',
      evaluatorDeadline: null,
    })
    .where(eq(tasks.id, taskId as string));
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

  await db.insert(requesterReputationEvents).values({
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
  }
}

async function processEvents(fromBlock: bigint, toBlock: bigint): Promise<void> {
  const contractAddress = config.CONTRACT_ADDRESS as `0x${string}`;

  const logs = (await publicClient.getLogs({
    address: contractAddress,
    fromBlock,
    toBlock,
    events: [
      TASK_CREATED_EVENT,
      TASK_CLAIMED_EVENT,
      TASK_WORKER_SELECTED_EVENT,
      TASK_COMPLETED_EVENT,
      TASK_RATED_EVENT,
      TASK_SUBMITTED_EVENT,
      BID_SUBMITTED_EVENT,
      TASK_EXPIRED_EVENT,
      STAKE_FORFEITED_EVENT,
      STAKE_RETURNED_EVENT,
      TASK_REOPENED_EVENT,
      TASK_CANCELLED_EVENT,
      TASK_UPDATED_EVENT,
      PITCH_SUBMITTED_EVENT,
      PROOF_SUBMITTED_EVENT,
      AUCTION_ACCEPTED_EVENT,
      FEES_UPDATED_EVENT,
      FEE_RECIPIENT_UPDATED_EVENT,
      FORWARDER_UPDATED_EVENT,
      REPUTATION_REGISTRY_UPDATED_EVENT,
      HOOK_REGISTERED_EVENT,
      EVALUATOR_ASSIGNED_EVENT,
      TASK_EVALUATED_EVENT,
      TASK_APPEALED_EVENT,
      TASK_DISPUTED_EVENT,
      EVALUATOR_TIMED_OUT_EVENT,
      SUBMISSION_REJECTED_EVENT,
      SELF_AWARD_EVENT,
      REQUESTER_REPUTATION_EVENT,
      PAUSED_EVENT,
      UNPAUSED_EVENT,
      OWNERSHIP_TRANSFER_STARTED_EVENT,
    ] as any,
  })) as unknown as EventLog[];

  for (const log of logs) {
    try {
      if (await isAlreadyProcessed(log)) continue;

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
        case 'TaskCompleted':
          await processTaskAcceptedEvent(log);
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
          // TaskDisputed fires alongside TaskAppealed — no additional DB update needed
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
          processAdminAuditEvent(log);
          break;
        default:
          continue;
      }

      await markProcessed(log);
    } catch (error) {
      console.error(`Error processing event ${log.eventName}:`, error);
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
        const wallet = ('0x' + (metadataValue as string).slice(2, 42)) as `0x${string}`;
        // onConflictDoNothing: a wallet can own multiple agentIds (ERC-721 allows it).
        // We keep the FIRST agentId associated with each wallet address.
        await db
          .insert(agents)
          .values({ address: wallet, agentId: agentIdStr })
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
    events: [
      REWARD_CONFIGURED_EVENT,
      REWARD_RESERVED_EVENT,
      REWARD_PAID_EVENT,
      REWARD_RESERVE_RELEASED_EVENT,
      REWARDS_WITHDRAWN_EVENT,
      PRICE_UPDATED_EVENT,
      BONUS_BPS_UPDATED_EVENT,
    ] as any,
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

export async function startIndexer(): Promise<void> {
  console.log('Starting event indexer...');

  const poll = async () => {
    try {
      const lastBlock = await getLastBlock('main', config.CONTRACT_DEPLOY_BLOCK);
      const latestBlock = await publicClient.getBlockNumber();

      if (latestBlock > lastBlock) {
        console.log(`Indexing blocks ${lastBlock + 1n} to ${latestBlock}`);
        await processInChunks(lastBlock + 1n, latestBlock, processEvents);
        await setLastBlock('main', latestBlock);
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
    } catch (error) {
      console.error('Indexer error:', error);
    }
  };

  await poll();

  setInterval(poll, POLL_INTERVAL);

  console.log(`Event indexer started (polling every ${POLL_INTERVAL}ms)`);
}

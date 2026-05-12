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
  submissions,
} from '../db/schema';
import { and, eq, sql } from 'drizzle-orm';
import { getServerConfig } from '../config/env';

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

const TASK_CREATED_EVENT = parseAbiItem(
  'event TaskCreated(bytes32 indexed taskId, address indexed requester, uint256 reward, uint256 expiryTime, bytes4 mode)'
);
const TASK_CLAIMED_EVENT = parseAbiItem(
  'event TaskClaimed(bytes32 indexed taskId, address indexed claimer, uint256 stakeAmount)'
);
const TASK_WORKER_SELECTED_EVENT = parseAbiItem(
  'event TaskWorkerSelected(bytes32 indexed taskId, address indexed worker)'
);
const TASK_ACCEPTED_EVENT = parseAbiItem(
  'event TaskAccepted(bytes32 indexed taskId, address indexed requester, address indexed worker, uint256 workerPayment, uint256 platformFee)'
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
  'event StakeForfeited(bytes32 indexed taskId, address indexed claimer, uint256 stakeAmount)'
);
const STAKE_RETURNED_EVENT = parseAbiItem(
  'event StakeReturned(bytes32 indexed taskId, address indexed claimer, uint256 stakeAmount)'
);
const TASK_REOPENED_EVENT = parseAbiItem('event TaskReopened(bytes32 indexed taskId)');
const TASK_CANCELLED_EVENT = parseAbiItem(
  'event TaskCancelled(bytes32 indexed taskId, address indexed requester, uint256 refundAmount)'
);
const TASK_UPDATED_EVENT = parseAbiItem(
  'event TaskUpdated(bytes32 indexed taskId, uint256 newReward, uint256 newExpiryTime)'
);

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
  const { taskId, claimer, stakeAmount } = log.args;

  await db
    .update(tasks)
    .set({
      status: 'claimed',
      claimedBy: claimer as string,
      claimedAt: new Date(),
    })
    .where(eq(tasks.id, taskId as string));

  await db
    .update(claims)
    .set({ stakeAmount: stakeAmount!.toString() })
    .where(eq(claims.taskId, taskId as string));

  console.log(`TaskClaimed event: ${taskId} by ${claimer}, stake: ${stakeAmount}`);
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
      status: 'accepted',
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

  if (Number(workerPayment) > 0) {
    // The cumulative `agents.totalEarnings` and `agents.completedTasks` updates
    // below use SQL `+` aggregation, which would double-count if the indexer
    // re-processed this event. The idempotency guard at the top of processEvents
    // prevents that: the event row exists in indexed_events before this handler
    // runs again, so we never re-enter this branch for the same log.
    await db
      .insert(agents)
      .values({
        address: worker as string,
        totalEarnings: (workerPayment as bigint).toString(),
        completedTasks: 1,
        ratedTasks: 0,
        totalStars: 0,
      })
      .onConflictDoUpdate({
        target: agents.address,
        set: {
          totalEarnings: sql`${agents.totalEarnings} + ${(workerPayment as bigint).toString()}`,
          completedTasks: sql`${agents.completedTasks} + 1`,
          updatedAt: new Date(),
        },
      });
  }

  console.log(`TaskAccepted event: ${taskId} - ${worker}, payment: ${workerPayment}`);
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

  console.log(`TaskSubmitted event: ${taskId} by ${worker}, deliverable: ${deliverable}`);
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
  const { taskId, claimer, stakeAmount } = log.args;

  await db
    .update(claims)
    .set({ status: 'forfeited' })
    .where(and(eq(claims.taskId, taskId as string), eq(claims.workerAddress, claimer as string)));

  console.log(`StakeForfeited event: ${taskId} from ${claimer}, amount: ${stakeAmount}`);
}

async function processStakeReturnedEvent(log: EventLog): Promise<void> {
  const { taskId, claimer, stakeAmount } = log.args;

  await db
    .update(claims)
    .set({ status: 'returned' })
    .where(and(eq(claims.taskId, taskId as string), eq(claims.workerAddress, claimer as string)));

  console.log(`StakeReturned event: ${taskId} to ${claimer}, amount: ${stakeAmount}`);
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
      TASK_ACCEPTED_EVENT,
      TASK_RATED_EVENT,
      TASK_SUBMITTED_EVENT,
      BID_SUBMITTED_EVENT,
      TASK_EXPIRED_EVENT,
      STAKE_FORFEITED_EVENT,
      STAKE_RETURNED_EVENT,
      TASK_REOPENED_EVENT,
      TASK_CANCELLED_EVENT,
      TASK_UPDATED_EVENT,
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
        case 'TaskAccepted':
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
    } catch (error) {
      console.error('Indexer error:', error);
    }
  };

  await poll();

  setInterval(poll, POLL_INTERVAL);

  console.log(`Event indexer started (polling every ${POLL_INTERVAL}ms)`);
}

import { createPublicClient, http, parseAbiItem, type Log } from 'viem';
import { base, baseSepolia } from 'viem/chains';
import { db } from '../db/client';
import { tasks, indexerState, platformFees } from '../db/schema';
import { eq } from 'drizzle-orm';
import { getServerConfig } from '../config/env';

const config = getServerConfig();

const publicClient = createPublicClient({
  chain: config.CHAIN_ID === 84532 ? baseSepolia : base,
  transport: http(config.BASE_RPC_URL),
});

const POLL_INTERVAL = 12000;

const TASK_CREATED_EVENT = parseAbiItem('event TaskCreated(bytes32 indexed taskId, address indexed requester, uint256 reward, uint256 expiryTime, uint8 mode)');
const TASK_CLAIMED_EVENT = parseAbiItem('event TaskClaimed(bytes32 indexed taskId, address indexed claimer, uint256 stakeAmount)');
const TASK_WORKER_SELECTED_EVENT = parseAbiItem('event TaskWorkerSelected(bytes32 indexed taskId, address indexed worker)');
const TASK_ACCEPTED_EVENT = parseAbiItem('event TaskAccepted(bytes32 indexed taskId, address indexed requester, address indexed worker, uint256 workerPayment, uint256 platformFee)');
const TASK_RATED_EVENT = parseAbiItem('event TaskRated(bytes32 indexed taskId, address indexed worker, uint8 rating)');
const TASK_EXPIRED_EVENT = parseAbiItem('event TaskExpired(bytes32 indexed taskId, address indexed requester, uint256 refundAmount)');
const STAKE_FORFEITED_EVENT = parseAbiItem('event StakeForfeited(bytes32 indexed taskId, address indexed claimer, uint256 stakeAmount)');
const STAKE_RETURNED_EVENT = parseAbiItem('event StakeReturned(bytes32 indexed taskId, address indexed claimer, uint256 stakeAmount)');
const TASK_REOPENED_EVENT = parseAbiItem('event TaskReopened(bytes32 indexed taskId)');

const MODE_MAP: Record<number, string> = {
  0: 'contest',
  1: 'instant',
  2: 'proposal',
  3: 'race',
};

async function getLastProcessedBlock(): Promise<bigint> {
  const result = await db.select().from(indexerState).where(eq(indexerState.id, 'main')).limit(1);

  if (result.length === 0) {
    const deployBlock = BigInt(config.CONTRACT_DEPLOY_BLOCK);
    await db.insert(indexerState).values({
      id: 'main',
      lastBlock: Number(deployBlock),
    });
    return deployBlock;
  }

  return BigInt(result[0].lastBlock);
}

async function updateLastProcessedBlock(block: bigint): Promise<void> {
  await db
    .update(indexerState)
    .set({ lastBlock: Number(block), updatedAt: new Date() })
    .where(eq(indexerState.id, 'main'));
}

async function processTaskCreatedEvent(log: Log): Promise<void> {
  const { taskId, requester, mode } = log.args as any;
  const modeString = MODE_MAP[Number(mode)] || 'contest';

  console.log(`TaskCreated event: ${taskId} by ${requester}, mode: ${modeString}`);
}

async function processTaskClaimedEvent(log: Log): Promise<void> {
  const { taskId, claimer, stakeAmount } = log.args as any;

  await db
    .update(tasks)
    .set({
      status: 'claimed',
      claimedBy: claimer as string,
      claimedAt: new Date(),
    })
    .where(eq(tasks.id, taskId as string));

  console.log(`TaskClaimed event: ${taskId} by ${claimer}`);
}

async function processTaskWorkerSelectedEvent(log: Log): Promise<void> {
  const { taskId, worker } = log.args as any;

  await db
    .update(tasks)
    .set({
      status: 'worker_selected',
      worker: worker as string,
    })
    .where(eq(tasks.id, taskId as string));

  console.log(`TaskWorkerSelected event: ${taskId} - ${worker}`);
}

async function processTaskAcceptedEvent(log: Log): Promise<void> {
  const { taskId, worker, workerPayment, platformFee } = log.args as any;

  await db
    .update(tasks)
    .set({
      status: 'accepted',
      worker: worker as string,
    })
    .where(eq(tasks.id, taskId as string));

  if (Number(platformFee) > 0 && log.transactionHash) {
    await db.insert(platformFees).values({
      taskId: taskId as string,
      amount: platformFee.toString(),
      txHash: log.transactionHash,
    });
  }

  console.log(`TaskAccepted event: ${taskId} - ${worker}`);
}

async function processTaskRatedEvent(log: Log): Promise<void> {
  const { taskId, rating } = log.args as any;

  await db
    .update(tasks)
    .set({ rating: Number(rating) })
    .where(eq(tasks.id, taskId as string));

  console.log(`TaskRated event: ${taskId} - ${rating} stars`);
}

async function processTaskExpiredEvent(log: Log): Promise<void> {
  const { taskId } = log.args as any;

  await db
    .update(tasks)
    .set({ status: 'expired' })
    .where(eq(tasks.id, taskId as string));

  console.log(`TaskExpired event: ${taskId}`);
}

async function processTaskReopenedEvent(log: Log): Promise<void> {
  const { taskId } = log.args as any;

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

  const logs = await publicClient.getLogs({
    address: contractAddress,
    fromBlock,
    toBlock,
    events: [
      TASK_CREATED_EVENT,
      TASK_CLAIMED_EVENT,
      TASK_WORKER_SELECTED_EVENT,
      TASK_ACCEPTED_EVENT,
      TASK_RATED_EVENT,
      TASK_EXPIRED_EVENT,
      STAKE_FORFEITED_EVENT,
      STAKE_RETURNED_EVENT,
      TASK_REOPENED_EVENT,
    ] as any,
  });

  for (const log of logs) {
    try {
      if (log.eventName === 'TaskCreated') {
        await processTaskCreatedEvent(log);
      } else if (log.eventName === 'TaskClaimed') {
        await processTaskClaimedEvent(log);
      } else if (log.eventName === 'TaskWorkerSelected') {
        await processTaskWorkerSelectedEvent(log);
      } else if (log.eventName === 'TaskAccepted') {
        await processTaskAcceptedEvent(log);
      } else if (log.eventName === 'TaskRated') {
        await processTaskRatedEvent(log);
      } else if (log.eventName === 'TaskExpired') {
        await processTaskExpiredEvent(log);
      } else if (log.eventName === 'TaskReopened') {
        await processTaskReopenedEvent(log);
      }
    } catch (error) {
      console.error(`Error processing event ${log.eventName}:`, error);
    }
  }
}

export async function startIndexer(): Promise<void> {
  console.log('Starting event indexer...');

  const poll = async () => {
    try {
      const lastBlock = await getLastProcessedBlock();
      const latestBlock = await publicClient.getBlockNumber();

      if (latestBlock > lastBlock) {
        console.log(`Indexing blocks ${lastBlock + 1n} to ${latestBlock}`);
        await processEvents(lastBlock + 1n, latestBlock);
        await updateLastProcessedBlock(latestBlock);
      }
    } catch (error) {
      console.error('Indexer error:', error);
    }
  };

  await poll();

  setInterval(poll, POLL_INTERVAL);

  console.log(`Event indexer started (polling every ${POLL_INTERVAL}ms)`);
}

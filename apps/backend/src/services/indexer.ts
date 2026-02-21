import { createPublicClient, http, parseAbiItem } from 'viem';
import { base, baseSepolia } from 'viem/chains';
import { db } from '../db/client';
import { tasks, claims, agents, indexerState, platformFees } from '../db/schema';
import { eq, sql } from 'drizzle-orm';
import { getServerConfig } from '../config/env';

type EventLog = {
  args: Record<string, unknown>;
  eventName: string;
  blockNumber?: bigint | null;
  transactionHash?: `0x${string}` | null;
};

const config = getServerConfig();

const publicClient = createPublicClient({
  chain: config.CHAIN_ID === 84532 ? baseSepolia : base,
  transport: http(config.BASE_RPC_URL),
});

const POLL_INTERVAL = 12000;
const MAX_BLOCK_RANGE = 10_000n;

const IDENTITY_REGISTRY_ADDRESS = '0x8004A818BFB912233c491871b3d84c89A494BD9e' as const;
const ERC8004_SEED_BLOCK = 36_304_157;

const TASK_CREATED_EVENT = parseAbiItem(
  'event TaskCreated(bytes32 indexed taskId, address indexed requester, uint256 reward, uint256 expiryTime, uint8 mode)'
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
  'event TaskRated(bytes32 indexed taskId, address indexed worker, uint8 rating)'
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

const METADATA_SET_EVENT = parseAbiItem(
  'event MetadataSet(uint256 indexed agentId, string indexed indexedMetadataKey, string metadataKey, bytes metadataValue)'
);

const MODE_MAP: Record<number, string> = {
  0: 'contest',
  1: 'instant',
  2: 'proposal',
  3: 'race',
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

async function processTaskCreatedEvent(log: EventLog): Promise<void> {
  const { taskId, requester, reward, expiryTime, mode } = log.args;
  const modeString = MODE_MAP[Number(mode)] || 'contest';

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
    await db.insert(platformFees).values({
      taskId: taskId as string,
      amount: (platformFee as bigint).toString(),
      txHash: log.transactionHash,
    });
  }

  if (Number(workerPayment) > 0) {
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
  const { taskId, rating } = log.args;

  await db
    .update(tasks)
    .set({ rating: Number(rating) })
    .where(eq(tasks.id, taskId as string));

  console.log(`TaskRated event: ${taskId} - ${rating} stars`);
}

async function processTaskExpiredEvent(log: EventLog): Promise<void> {
  const { taskId } = log.args;

  await db
    .update(tasks)
    .set({ status: 'expired' })
    .where(eq(tasks.id, taskId as string));

  console.log(`TaskExpired event: ${taskId}`);
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
      TASK_EXPIRED_EVENT,
      STAKE_FORFEITED_EVENT,
      STAKE_RETURNED_EVENT,
      TASK_REOPENED_EVENT,
    ] as any,
  })) as unknown as EventLog[];

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

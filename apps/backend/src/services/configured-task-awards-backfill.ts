import { and, eq, sql } from 'drizzle-orm';
import { getServerConfig } from '../config/env';
import { getPublicClient, runWithRpcOperation } from '../lib/rpc-gateway';
import { db } from '../db/client';
import { indexerState, taskAwards, tasks } from '../db/schema';
import { contractGetSettlementChainState } from './contract';
import { TASK_COMPLETED_EVENT, TASK_RATED_EVENT } from './settlement-contract';
import {
  projectSettlementLogs,
  type SettlementChainState,
  type SettlementCompletionLog,
} from './settlement-projector';
import { findUnresolvedTaskAwardIds, runTaskAwardsBackfill } from './task-awards-backfill';

const DEFAULT_CHUNK_SIZE = 10_000n;

type CompletionEventLog = {
  args: {
    taskId?: `0x${string}`;
    worker?: `0x${string}`;
    workerPayment?: bigint;
    platformFee?: bigint;
  };
  blockNumber: bigint | null;
  logIndex: number | null;
  transactionHash: `0x${string}` | null;
};

type RatingEventLog = {
  args: {
    taskId?: `0x${string}`;
    worker?: `0x${string}`;
    rating?: number;
  };
};

export type ConfiguredTaskAwardsBackfillOptions = {
  chunkSize?: bigint;
  fromBlock?: bigint;
  ignoreCheckpoint?: boolean;
  toBlock?: bigint;
};

export type TaskAwardsBackfillSummary = {
  completedWithoutAwards: string[];
  completionEvents: number;
  insertedAwards: number;
  ratingEvents: number;
  repairedAwardRatings: number;
};

function completionLog(log: CompletionEventLog): SettlementCompletionLog {
  const { taskId, worker, workerPayment, platformFee } = log.args;
  if (
    !taskId ||
    !worker ||
    workerPayment === undefined ||
    platformFee === undefined ||
    log.blockNumber === null ||
    log.logIndex === null ||
    log.transactionHash === null
  ) {
    throw new Error('TaskCompleted log is missing required fields');
  }

  return {
    args: { platformFee, taskId, worker, workerPayment },
    blockNumber: log.blockNumber,
    logIndex: log.logIndex,
    transactionHash: log.transactionHash,
  };
}

function cursorBlockNumber(blockNumber: bigint): number {
  const value = Number(blockNumber);
  if (!Number.isSafeInteger(value)) {
    throw new Error(`Backfill cursor block ${blockNumber} exceeds JavaScript integer precision`);
  }
  return value;
}

function toOptionalBigInt(value: number | undefined): bigint | undefined {
  return value === undefined ? undefined : BigInt(value);
}

async function runConfiguredTaskAwardsBackfillInternal(
  options: ConfiguredTaskAwardsBackfillOptions = {}
): Promise<TaskAwardsBackfillSummary> {
  const config = getServerConfig();
  const fromBlock = options.fromBlock ?? toOptionalBigInt(config.TASK_AWARDS_BACKFILL_FROM_BLOCK);
  const ignoreCheckpoint =
    options.ignoreCheckpoint ?? config.TASK_AWARDS_BACKFILL_IGNORE_CHECKPOINT;
  const toBlock = options.toBlock ?? toOptionalBigInt(config.TASK_AWARDS_BACKFILL_TO_BLOCK);
  const client = getPublicClient();
  const contractAddress = config.CONTRACT_ADDRESS as `0x${string}`;
  const startBlock = fromBlock ?? BigInt(config.CONTRACT_DEPLOY_BLOCK);
  const chainStateByTask = new Map<string, SettlementChainState>();
  const settledAtByBlock = new Map<bigint, Date>();
  const counters = {
    completionEvents: 0,
    insertedAwards: 0,
    ratingEvents: 0,
    repairedAwardRatings: 0,
  };
  let summary: TaskAwardsBackfillSummary | null = null;

  try {
    await runTaskAwardsBackfill({
      chainId: config.CHAIN_ID,
      chunkSize: options.chunkSize ?? DEFAULT_CHUNK_SIZE,
      contractAddress,
      getLatestBlock: async () => toBlock ?? client.getBlockNumber(),
      loadCheckpoint: async (checkpointId) => {
        if (ignoreCheckpoint) return null;
        const rows = await db
          .select({ lastBlock: indexerState.lastBlock })
          .from(indexerState)
          .where(eq(indexerState.id, checkpointId))
          .limit(1);
        return rows[0] ? BigInt(rows[0].lastBlock) : null;
      },
      processRange: async (fromBlock, toBlock) => {
        const logs = await client.getLogs({
          address: contractAddress,
          events: [TASK_COMPLETED_EVENT, TASK_RATED_EVENT],
          fromBlock,
          toBlock,
        });
        const completions = logs
          .filter((log) => log.eventName === 'TaskCompleted')
          .map((log) => completionLog(log as CompletionEventLog));
        const ratings = logs.filter(
          (log): log is typeof log & RatingEventLog => log.eventName === 'TaskRated'
        );
        counters.completionEvents += completions.length;
        counters.ratingEvents += ratings.length;

        const taskIds = [...new Set(completions.map((log) => log.args.taskId))];
        for (const taskId of taskIds) {
          if (chainStateByTask.has(taskId)) continue;
          chainStateByTask.set(
            taskId,
            await contractGetSettlementChainState(taskId as `0x${string}`, contractAddress)
          );
        }

        for (const blockNumber of new Set(completions.map((log) => log.blockNumber))) {
          if (settledAtByBlock.has(blockNumber)) continue;
          const block = await client.getBlock({ blockNumber });
          settledAtByBlock.set(blockNumber, new Date(Number(block.timestamp) * 1000));
        }

        const missingTasks: string[] = [];
        for (const settlement of projectSettlementLogs(completions, chainStateByTask)) {
          const taskRows = await db
            .select({ id: tasks.id })
            .from(tasks)
            .where(eq(tasks.id, settlement.taskId))
            .limit(1);
          if (taskRows.length === 0) {
            missingTasks.push(settlement.taskId);
            continue;
          }

          const settledAt = settledAtByBlock.get(settlement.blockNumber);
          if (!settledAt) throw new Error(`Missing timestamp for block ${settlement.blockNumber}`);

          await db.transaction(async (tx) => {
            const inserted = await tx
              .insert(taskAwards)
              .values(
                settlement.awards.map((award) => ({
                  blockNumber: award.blockNumber,
                  chainId: config.CHAIN_ID,
                  logIndex: award.logIndex,
                  platformFee: award.platformFee.toString(),
                  rank: award.rank,
                  settledAt,
                  settlementTxHash: settlement.transactionHash,
                  taskId: settlement.taskId,
                  workerAddress: award.workerAddress.toLowerCase(),
                  workerPayment: award.workerPayment.toString(),
                }))
              )
              .onConflictDoNothing()
              .returning({ id: taskAwards.id });
            counters.insertedAwards += inserted.length;
          });
        }

        if (missingTasks.length > 0) {
          throw new Error(
            `Task award backfill cannot checkpoint ${fromBlock}-${toBlock}; missing task rows: ${missingTasks.join(', ')}`
          );
        }

        for (const log of ratings) {
          const { taskId, worker, rating } = log.args;
          if (!taskId || !worker || rating === undefined) {
            throw new Error('TaskRated log is missing required fields');
          }
          const current = await db
            .select({ rating: taskAwards.rating })
            .from(taskAwards)
            .where(
              and(
                eq(taskAwards.taskId, taskId),
                sql`lower(${taskAwards.workerAddress}) = lower(${worker})`
              )
            );
          if (current.some((award) => award.rating !== rating)) {
            counters.repairedAwardRatings += 1;
          }

          await db
            .update(taskAwards)
            .set({ rating })
            .where(
              and(
                eq(taskAwards.taskId, taskId),
                sql`lower(${taskAwards.workerAddress}) = lower(${worker})`
              )
            );
        }

        console.log(`Scanned task award blocks ${fromBlock}-${toBlock}: ${logs.length} event(s)`);
      },
      saveCheckpoint: async (checkpointId, blockNumber) => {
        const lastBlock = cursorBlockNumber(blockNumber);
        await db
          .insert(indexerState)
          .values({ id: checkpointId, lastBlock, updatedAt: new Date() })
          .onConflictDoUpdate({
            target: indexerState.id,
            set: {
              lastBlock: sql`greatest(${indexerState.lastBlock}, ${lastBlock})`,
              updatedAt: new Date(),
            },
          });
      },
      startBlock,
      validate: async () => {
        const completedWithoutAwardCandidates = await db
          .select({ id: tasks.id })
          .from(tasks)
          .where(
            and(
              eq(tasks.status, 'completed'),
              sql`lower(${tasks.contractAddress}) = lower(${contractAddress})`,
              sql`not exists (
              select 1 from ${taskAwards}
              where ${taskAwards.taskId} = ${tasks.id}
            )`
            )
          );
        const completedWithoutAwards = await findUnresolvedTaskAwardIds(
          completedWithoutAwardCandidates.map((task) => task.id),
          (taskId) => contractGetSettlementChainState(taskId as `0x${string}`, contractAddress)
        );

        summary = {
          ...counters,
          completedWithoutAwards,
        };
        if (completedWithoutAwards.length > 0) {
          throw new Error('Task award backfill completed with unresolved settlement mismatches');
        }
      },
    });
  } finally {
    // Log whatever summary validate() captured even when it threw -- the
    // completedWithoutAwards task-id list is the one thing an operator needs to
    // diagnose a stuck backfill, and it must not be dropped on the failure path.
    if (summary) {
      console.log(JSON.stringify(summary, null, 2));
    }
  }

  if (!summary) throw new Error('Task award backfill validation did not run');
  return summary;
}

export function runConfiguredTaskAwardsBackfill(
  options: ConfiguredTaskAwardsBackfillOptions = {}
): Promise<TaskAwardsBackfillSummary> {
  return runWithRpcOperation({ kind: 'background', name: 'reconciliation' }, () =>
    runConfiguredTaskAwardsBackfillInternal(options)
  );
}

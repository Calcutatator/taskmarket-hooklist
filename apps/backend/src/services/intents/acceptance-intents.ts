// Implements: ADR-0045
import { and, eq, sql } from 'drizzle-orm';

import type { db as DbType } from '../../db/client';
import { agents, feedbacks, taskAwards, tasks } from '../../db/schema';
import { logger } from '../../lib/logger';
import { blockNumberForTx } from '../contract';

type Db = typeof DbType;

export type AcceptanceAcceptIntentPayload = {
  isSelfAward: boolean;
  taskId: string;
  worker: string;
};

/**
 * The only post-receipt work an acceptance does off chain: flag a self-award.
 *
 * Everything else about an accepted task -- awards, status, earnings -- is derived from the
 * chain's own TaskCompleted events by the indexer, so there is nothing here to reproduce.
 * Naturally idempotent: setting the same boolean twice is the same as setting it once.
 */
export async function completeAcceptanceAccept(context: {
  db: Db;
  payload: AcceptanceAcceptIntentPayload;
}): Promise<void> {
  if (!context.payload.isSelfAward) return;
  try {
    await context.db
      .update(tasks)
      .set({ selfAward: true })
      .where(eq(tasks.id, context.payload.taskId));
  } catch (err) {
    // On-chain acceptance already succeeded; the DB flag is best-effort and must not fail
    // the completion, which would leave the intent retrying forever over a cosmetic field.
    logger.warn('acceptSubmission: failed to persist selfAward flag', {
      err,
      taskId: context.payload.taskId,
    });
  }
}

export type AcceptanceRateIntentPayload = {
  feedbackId: string;
  feedbackText: string | null;
  fileContent: string;
  rating: number;
  requesterAddress: string;
  requesterAgentId: string | null;
  taskId: string;
  worker: string;
  workerAgentId: string | null;
};

/**
 * Persist the feedback a confirmed rating produced, and fold it into the aggregates.
 *
 * `ratingBlockNumber` is read back from the receipt rather than carried in the payload: the
 * payload is written before the transaction exists, and a reconciler pass running this hours
 * later has only the hash (ADR-0045).
 *
 * The award update is idempotent by value. The agents aggregate is not -- it is a counter --
 * so it is guarded on the award still being unrated, which the same statement then clears.
 */
export async function completeAcceptanceRate(context: {
  db: Db;
  payload: AcceptanceRateIntentPayload;
  txHash: `0x${string}`;
}): Promise<void> {
  const { db, payload } = context;
  const ratingBlockNumber = await blockNumberForTx(context.txHash);

  await db
    .insert(feedbacks)
    .values({
      feedbackText: payload.feedbackText,
      fileContent: payload.fileContent,
      id: payload.feedbackId,
      rating: payload.rating,
      ratingBlockNumber,
      ratingTxHash: context.txHash,
      requesterAddress: payload.requesterAddress,
      requesterAgentId: payload.requesterAgentId,
      taskId: payload.taskId,
      workerAddress: payload.worker.toLowerCase(),
      workerAgentId: payload.workerAgentId,
    })
    .onConflictDoNothing();

  // Only bump the running totals if this award had not already been rated -- a re-run of the
  // completion must not count the same star twice.
  //
  // The claim and the increment are one transaction because the claim is what makes the
  // increment safe: it is a single-use token, and consuming it outside the transaction that
  // spends it means a crash in between loses the rating from the aggregate permanently. The
  // guard is already gone, so no retry can redo it.
  await db.transaction(async (tx) => {
    const claimed = await tx
      .update(taskAwards)
      .set({ rating: payload.rating })
      .where(
        and(
          eq(taskAwards.taskId, payload.taskId),
          sql`lower(${taskAwards.workerAddress}) = lower(${payload.worker})`,
          sql`${taskAwards.rating} is null`
        )
      )
      .returning({ id: taskAwards.id });

    if (claimed.length === 0) return;

    await tx
      .update(agents)
      .set({
        ratedTasks: sql`${agents.ratedTasks} + 1`,
        totalStars: sql`${agents.totalStars} + ${payload.rating}`,
        updatedAt: new Date(),
      })
      .where(sql`lower(${agents.address}) = lower(${payload.worker})`);
  });
}

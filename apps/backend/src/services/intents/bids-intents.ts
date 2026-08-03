// Implements: ADR-0045
import { and, eq } from 'drizzle-orm';

import type { db as DbType } from '../../db/client';
import { bids, tasks } from '../../db/schema';
import { logger } from '../../lib/logger';

type Db = typeof DbType;

export type BidsSubmitIntentPayload = {
  bidId: string;
  price: string;
  taskId: string;
  workerAddress: string;
};

/**
 * Record the bid a confirmed submitBid placed.
 *
 * Upsert rather than insert, for the reason the request path already used one: the indexer's
 * processBidSubmittedEvent reconciles the same BidSubmitted event with its own write and can
 * win the race, and a re-bid legitimately replaces a row. That also makes the completion
 * idempotent -- re-running it rewrites the same price on the same row.
 */
export async function completeBidsSubmit(context: {
  db: Db;
  payload: BidsSubmitIntentPayload;
}): Promise<void> {
  const { payload } = context;
  await context.db
    .insert(bids)
    .values({
      id: payload.bidId,
      price: payload.price,
      taskId: payload.taskId,
      workerAddress: payload.workerAddress,
    })
    .onConflictDoUpdate({
      target: [bids.taskId, bids.workerAddress],
      // `createdAt` is deliberately absent: a second completion attempt for the same intent is
      // the same bid, and re-dating it would make the row differ per attempt (ADR-0050). The
      // insert's own default still stamps a genuine first bid.
      set: { price: payload.price },
    });
}

export type BidsAuctionAcceptIntentPayload = {
  acceptedAt: string;
  bidId: string;
  price: string;
  taskId: string;
  workerAddress: string;
};

/**
 * Claim the task for the worker whose auction accept confirmed, and record the clock price
 * they accepted as their bid.
 *
 * The task update is conditional on the task still being open, exactly as the request path's
 * race guard was -- but a miss is no longer an error. The chain has already accepted this
 * worker, so it is the authority; a row that moved on was moved by the indexer processing the
 * same event, and failing the completion over it would strand the intent.
 */
export async function completeBidsAuctionAccept(context: {
  db: Db;
  payload: BidsAuctionAcceptIntentPayload;
}): Promise<void> {
  const { db, payload } = context;

  const updated = await db
    .update(tasks)
    .set({
      claimedAt: new Date(payload.acceptedAt),
      claimedBy: payload.workerAddress,
      status: 'claimed',
    })
    .where(and(eq(tasks.id, payload.taskId), eq(tasks.status, 'open')))
    .returning({ id: tasks.id });

  if (updated.length === 0) {
    logger.warn('auctionAccept: task was no longer open when the accept confirmed', {
      taskId: payload.taskId,
      workerAddress: payload.workerAddress,
    });
  }

  await db
    .insert(bids)
    .values({
      id: payload.bidId,
      price: payload.price,
      taskId: payload.taskId,
      workerAddress: payload.workerAddress,
    })
    .onConflictDoUpdate({
      target: [bids.taskId, bids.workerAddress],
      set: { price: payload.price },
    });
}

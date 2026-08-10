// Implements: ADR-0045, ADR-0050
import { and, eq } from 'drizzle-orm';

import type { db as DbType } from '../../db/client';
import { bids, tasks } from '../../db/schema';
import { logger } from '../../lib/logger';
import { contractAcceptAuction, contractSubmitBid } from '../contract';

type Db = typeof DbType;

export type BidsSubmitIntentPayload = {
  bidId: string;
  contractAddress: string | null;
  price: string;
  taskId: string;
  workerAddress: string;
};

/**
 * Re-send the worker's bid at the price they named.
 *
 * The price is the worker's own number, not a quote we computed for them, so replaying it is
 * replaying their bid.
 *
 * `submitBid` is the one operation here without a one-shot on-chain guard: it pushes onto
 * `taskBids[taskId]` with no per-worker dedupe, so a duplicate landing would append a second
 * entry rather than revert. It is still safe to rebroadcast, on two counts that are worth
 * separating. The rebroadcast precondition is that the outbox row is absent, which is positive
 * evidence nothing was ever signed (ADR-0050 point 4) -- so the duplicate does not arise. And
 * if that invariant were ever broken, the duplicate is inert: same worker, same price, and the
 * running minimum only moves on a strict `<`, so `lowestBidder` and `lowestBidPrice` are
 * unchanged, while the database row is unique on `(taskId, workerAddress)`. No money moves at
 * all, which is what separates this from `tasks.refundExpired`.
 */
export function broadcastBidsSubmit(context: {
  payload: BidsSubmitIntentPayload;
}): Promise<`0x${string}`> {
  const { payload } = context;
  return contractSubmitBid(
    payload.taskId as `0x${string}`,
    payload.workerAddress as `0x${string}`,
    BigInt(payload.price),
    payload.contractAddress
  );
}

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
  contractAddress: string | null;
  price: string;
  taskId: string;
  workerAddress: string;
};

/**
 * Re-send the worker's acceptance of the auction clock price.
 *
 * The price is a clock quote read at request time, and it is replayed verbatim rather than
 * re-derived from the clock at broadcast time. That is deliberate and is exactly the case
 * ADR-0050 point 7 names -- "a quoted price" is one of the values it lists as fixed at request
 * time and replayed as recorded. Re-reading the clock would land a price the worker never
 * agreed to, and on a descending auction it would silently be a different deal.
 *
 * The requester is protected regardless: `acceptAuction` rejects any price above
 * `auctionCfg.maxPrice`.
 *
 * A second landing reverts `TaskNotOpen`: the call requires Open and sets Claimed, so the task
 * cannot be awarded twice.
 */
export function broadcastBidsAuctionAccept(context: {
  payload: BidsAuctionAcceptIntentPayload;
}): Promise<`0x${string}`> {
  const { payload } = context;
  return contractAcceptAuction(
    payload.taskId as `0x${string}`,
    payload.workerAddress as `0x${string}`,
    BigInt(payload.price),
    payload.contractAddress
  );
}

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

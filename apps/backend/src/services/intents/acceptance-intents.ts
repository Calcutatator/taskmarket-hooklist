// Implements: ADR-0045, ADR-0050
import { and, eq, sql } from 'drizzle-orm';

import type { db as DbType } from '../../db/client';
import { agents, feedbacks, taskAwards, tasks } from '../../db/schema';
import { logger } from '../../lib/logger';
import {
  blockNumberForTx,
  contractAcceptSubmission,
  contractAcceptSubmissions,
  contractRateTask,
} from '../contract';

type Db = typeof DbType;

export type AcceptanceAcceptIntentPayload = {
  contractAddress: string | null;
  /**
   * The submission hash the contract checks against `task.deliverable`.
   *
   * Resolved from the database at request time and now recorded, rather than re-read at
   * broadcast time. Re-reading would pick whatever the newest unrejected submission is *then*,
   * which for a bounty is a different worker's work than the requester chose to accept.
   */
  deliverableHash: string;
  isSelfAward: boolean;
  requester: string;
  /** Null where the requester has no ERC-8004 identity; the contract reads 0 as absent. */
  requesterAgentId: string | null;
  taskId: string;
  worker: string;
};

/**
 * Re-send the requester's acceptance of one submission.
 *
 * The deliverable hash is the argument that makes this worth stating: it is a fact about which
 * submission was accepted, and it belongs in the payload for exactly the reason ADR-0050 gives
 * -- a value re-derived at broadcast time is not the value the payer authorised.
 *
 * A second landing is refused by `_validateAcceptSubmission`, which requires a
 * pre-acceptance status (Claimed / WorkerSelected / PendingApproval, or Open for the contest
 * modes) and whose success sets Accepted. The escrow payout is behind that transition.
 */
export function broadcastAcceptanceAccept(context: {
  payload: AcceptanceAcceptIntentPayload;
}): Promise<`0x${string}`> {
  const { payload } = context;
  return contractAcceptSubmission(
    payload.taskId as `0x${string}`,
    payload.requester as `0x${string}`,
    payload.worker as `0x${string}`,
    payload.deliverableHash as `0x${string}`,
    payload.requesterAgentId ? BigInt(payload.requesterAgentId) : 0n,
    payload.contractAddress
  );
}

export type AcceptanceAcceptSubmissionsIntentPayload = {
  contractAddress: string | null;
  /**
   * Per-winner deliverable hashes, positionally aligned with `winners`.
   *
   * Resolved and validated at request time. A zero hash means "auto-resolve on chain", which
   * is what the router sends when a winner carried no submission id.
   */
  deliverables: string[];
  requester: string;
  requesterAgentId: string | null;
  taskId: string;
  winners: { share: number; submissionId?: string | null; worker: string }[];
};

/**
 * Re-send a multi-winner acceptance.
 *
 * Shares and workers come from the requester's own request; the deliverable hashes were
 * resolved against the submissions table before the first send and are replayed rather than
 * re-resolved, so the split that lands is the split that was authorised.
 *
 * A second landing hits the same status gate as the single-winner path -- the task is Accepted
 * by then -- so the payout runs once.
 */
export function broadcastAcceptanceAcceptSubmissions(context: {
  payload: AcceptanceAcceptSubmissionsIntentPayload;
}): Promise<`0x${string}`> {
  const { payload } = context;
  return contractAcceptSubmissions(
    payload.taskId as `0x${string}`,
    payload.requester as `0x${string}`,
    payload.winners.map((winner) => winner.worker as `0x${string}`),
    payload.winners.map((winner) => winner.share),
    payload.deliverables as `0x${string}`[],
    payload.requesterAgentId ? BigInt(payload.requesterAgentId) : 0n,
    payload.contractAddress
  );
}

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
  contractAddress: string | null;
  /**
   * The two ERC-8004 feedback arguments, recorded rather than rebuilt.
   *
   * `fileContent` is already in the payload and the hash is keccak256 of it, so the hash could
   * in principle be recomputed -- but the URI could not: it is built from `BACKEND_URL`, which
   * is server configuration and can change between the send and a rebroadcast. Recording both
   * keeps the pair consistent and keeps the on-chain feedback pointer aimed at the same place
   * the requester's signature was priced against.
   */
  feedbackHash: string;
  feedbackId: string;
  feedbackText: string | null;
  feedbackURI: string;
  fileContent: string;
  rating: number;
  requesterAddress: string;
  requesterAgentId: string | null;
  taskId: string;
  worker: string;
  workerAgentId: string | null;
};

/**
 * Re-send the requester's rating.
 *
 * `fileContent` is the canonical feedback document, minted once with its own `createdAt` and
 * stored verbatim -- so the hash that goes on chain keeps matching the document the feedback
 * URI serves, however much later the rebroadcast happens. That is the shape ADR-0050 point 7
 * asks for: a timestamp fixed at request time is carried, never recomputed.
 *
 * A second landing reverts `WorkerAlreadyRated`: the contract keeps
 * `taskWorkerRated[taskId][worker]` as a one-shot flag, so the worker's star totals cannot be
 * inflated by a replay.
 */
export function broadcastAcceptanceRate(context: {
  payload: AcceptanceRateIntentPayload;
}): Promise<`0x${string}`> {
  const { payload } = context;
  return contractRateTask(
    payload.taskId as `0x${string}`,
    payload.requesterAddress as `0x${string}`,
    payload.worker as `0x${string}`,
    payload.rating,
    payload.workerAgentId ? BigInt(payload.workerAgentId) : 0n,
    payload.requesterAgentId ? BigInt(payload.requesterAgentId) : 0n,
    payload.feedbackURI,
    payload.feedbackHash as `0x${string}`,
    payload.contractAddress
  ).then((result) => result.hash);
}

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

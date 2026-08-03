// Implements: ADR-0045
import { eq } from 'drizzle-orm';

import { getServerConfig } from '../../config/env';
import type { db as DbType } from '../../db/client';
import { tasks } from '../../db/schema';
import {
  blockTimestampForTx,
  contractFinalizeVerdictTx,
  contractProjectSettlementForTx,
} from '../contract';
import { recordTaskSettlement } from '../settlement-recorder';

type Db = typeof DbType;

export type EvaluationsEvaluateIntentPayload = {
  awards: { amount: string; rank: number; worker: string }[];
  confidence: number;
  evidenceHash: string;
  mode: string;
  score: number;
  taskId: string;
  verdict: string;
};

/**
 * Move the task into its appeal window and record the verdict.
 *
 * The appeal deadline is anchored to the block the evaluation landed in, so the block
 * timestamp is read back from the receipt rather than carried in the payload -- the payload
 * predates the transaction, and a reconciler pass has only the hash (ADR-0045).
 *
 * Idempotent: every field is assigned a value derived from the payload and the receipt, both
 * of which are fixed, so a second run writes the same row.
 */
export async function completeEvaluationsEvaluate(context: {
  db: Db;
  payload: EvaluationsEvaluateIntentPayload;
  txHash: `0x${string}`;
}): Promise<void> {
  const { db, payload } = context;

  const [task] = await db.select().from(tasks).where(eq(tasks.id, payload.taskId)).limit(1);
  if (!task) return;

  const evaluatedAt = await blockTimestampForTx(context.txHash);
  const appealDeadline =
    task.appealWindow != null ? new Date((evaluatedAt + task.appealWindow) * 1000) : null;
  const expiryTime =
    appealDeadline && appealDeadline > task.expiryTime ? appealDeadline : task.expiryTime;

  await db
    .update(tasks)
    .set({
      appealDeadline,
      // The contract only reassigns the worker for contest modes (EvaluatorFacet.evaluate);
      // mirror that so locked-worker modes keep the on-chain worker.
      claimedBy:
        payload.mode === 'bounty' || payload.mode === 'benchmark'
          ? (payload.awards[0]?.worker ?? task.claimedBy)
          : task.claimedBy,
      evaluatorStake: '0',
      expiryTime,
      status: 'appealing',
      verdictConfidence: payload.confidence,
      verdictEvidenceHash: payload.evidenceHash,
      verdictScore: payload.score,
      verdictType: payload.verdict.toUpperCase(),
    })
    .where(eq(tasks.id, payload.taskId));
}

export type EvaluationsAppealIntentPayload = { taskId: string };

/** A confirmed appeal moves the task to disputed. Nothing else follows from it. */
export async function completeEvaluationsAppeal(context: {
  db: Db;
  payload: EvaluationsAppealIntentPayload;
}): Promise<void> {
  await context.db
    .update(tasks)
    .set({ status: 'disputed' })
    .where(eq(tasks.id, context.payload.taskId));
}

export type EvaluationsFinalizeVerdictIntentPayload = {
  /** The verdict recorded when the evaluation landed; REJECT terminates instead of settling. */
  rejected: boolean;
  taskId: string;
};

export function broadcastEvaluationsFinalizeVerdict(context: {
  payload: EvaluationsFinalizeVerdictIntentPayload;
}): Promise<`0x${string}`> {
  return contractFinalizeVerdictTx(context.payload.taskId as `0x${string}`);
}

/**
 * Settle the task a confirmed finalizeVerdict closed.
 *
 * finalizeVerdict is permissionless -- anyone may call it once the appeal window has passed --
 * and that changes nothing here. An intent records what the server relayed, not who asked for
 * it: the transaction is sent by the server wallet either way, and its receipt has exactly the
 * same post-receipt database work to do whether the requester, the worker or a passing bot
 * triggered it. What the intent buys is that the settlement still gets recorded when the
 * receipt outlives the request, which for an endpoint bots poll is if anything more likely.
 *
 * Idempotent: `recordTaskSettlement` conflicts-do-nothing, and both status writes are fixed
 * values derived from the payload. The updates are deliberately unguarded by prior status, as
 * they were when they ran inline -- the indexer can legitimately reach this task first, and a
 * guard would then skip the write the chain has already justified.
 */
export async function completeEvaluationsFinalizeVerdict(context: {
  db: Db;
  payload: EvaluationsFinalizeVerdictIntentPayload;
  txHash: `0x${string}`;
}): Promise<void> {
  const { db, payload } = context;

  if (payload.rejected) {
    // REJECT refunds the (post-evaluator-fee) remainder to the requester and terminates the
    // task -- it does not reopen it. A worker who claimed a reopened task would find
    // acceptSubmission reverting on the empty escrow left behind by the refund
    // (EvaluatorFacet.finalizeVerdict). The contract emits no TaskCompleted event on this
    // path, so there is no settlement to record and nothing to read back from the receipt.
    await db
      .update(tasks)
      .set({
        appealDeadline: null,
        appealWindow: null,
        claimedBy: null,
        evaluationWindow: null,
        evaluator: null,
        evaluatorDeadline: null,
        evaluatorStake: '0',
        status: 'cancelled',
      })
      .where(eq(tasks.id, payload.taskId));
    return;
  }

  const { settlement, settledAt } = await contractProjectSettlementForTx(
    payload.taskId as `0x${string}`,
    context.txHash
  );

  if (settlement && settledAt != null) {
    await recordTaskSettlement(db, {
      chainId: getServerConfig().CHAIN_ID,
      settledAt: new Date(settledAt * 1000),
      settlement,
    });
    return;
  }

  // All-zero-award verdict: the contract still transitions the task to Accepted/completed, but
  // emits no TaskCompleted log, so there is no settlement to record.
  await db.update(tasks).set({ status: 'completed' }).where(eq(tasks.id, payload.taskId));
}

export type EvaluationsResolveDisputeIntentPayload = {
  firstAwardWorker: string;
  taskId: string;
};

/**
 * Record the settlement a confirmed dispute resolution produced.
 *
 * The settlement is projected from the receipt's own TaskCompleted logs, re-read from the
 * hash for the same reason the evaluation's block timestamp is. `recordTaskSettlement` is
 * idempotent via onConflictDoNothing, so the async indexer processing the same events later
 * -- or a second completion attempt -- changes nothing.
 */
export async function completeEvaluationsResolveDispute(context: {
  db: Db;
  payload: EvaluationsResolveDisputeIntentPayload;
  txHash: `0x${string}`;
}): Promise<void> {
  const { db, payload } = context;
  const { settlement, settledAt } = await contractProjectSettlementForTx(
    payload.taskId as `0x${string}`,
    context.txHash
  );

  if (settlement && settledAt != null) {
    await recordTaskSettlement(db, {
      chainId: getServerConfig().CHAIN_ID,
      settledAt: new Date(settledAt * 1000),
      settlement,
    });
    return;
  }

  // All-zero-award verdict: the contract still transitions the task to Accepted/completed,
  // but emits no TaskCompleted log, so there is no settlement to record.
  await db
    .update(tasks)
    .set({ claimedBy: payload.firstAwardWorker, status: 'completed' })
    .where(eq(tasks.id, payload.taskId));
}

export type EvaluationsEvaluatorTimeoutIntentPayload = { taskId: string };

/** A confirmed evaluator timeout clears the evaluator and returns the task for approval. */
export async function completeEvaluationsEvaluatorTimeout(context: {
  db: Db;
  payload: EvaluationsEvaluatorTimeoutIntentPayload;
}): Promise<void> {
  await context.db
    .update(tasks)
    .set({
      evaluator: null,
      evaluatorDeadline: null,
      evaluatorStake: '0',
      status: 'pending_approval',
    })
    .where(eq(tasks.id, context.payload.taskId));
}

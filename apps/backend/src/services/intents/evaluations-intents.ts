// Implements: ADR-0045, ADR-0050
import { and, eq, inArray } from 'drizzle-orm';

import { getServerConfig } from '../../config/env';
import type { db as DbType } from '../../db/client';
import { tasks } from '../../db/schema';
import {
  blockTimestampForTx,
  contractAppeal,
  contractEvaluate,
  contractEvaluatorTimeout,
  contractFinalizeVerdictTx,
  contractProjectSettlementForTx,
  contractResolveDispute,
} from '../contract';
import { recordTaskSettlement } from '../settlement-recorder';

type Db = typeof DbType;

/**
 * The verdict vocabulary, shared by the request path and every rebroadcast of it.
 *
 * Deliberately one table rather than a copy per caller. A rebroadcast has to produce the same
 * call the original send did (ADR-0050 point 7), and two copies of a mapping are two things
 * that can drift apart without anything noticing.
 */
export const VERDICT_MAP: Record<string, number> = { approve: 0, reject: 1, partial: 2 };

/** The statuses `evaluate()` is callable from (evaluations.router.ts), plus its own result. */
const EVALUATABLE_STATUSES = ['open', 'pending_approval', 'review', 'appealing'] as const;

/** One award, with its uint256 amount in the string form a jsonb payload can carry. */
export type EvaluationAwardPayload = { amount: string; rank: number; worker: string };

function awardArgs(
  awards: EvaluationAwardPayload[]
): { amount: bigint; rank: number; worker: `0x${string}` }[] {
  return awards.map((award) => ({
    amount: BigInt(award.amount),
    rank: award.rank,
    worker: award.worker as `0x${string}`,
  }));
}

export type EvaluationsEvaluateIntentPayload = {
  awards: EvaluationAwardPayload[];
  confidence: number;
  evidenceHash: string;
  mode: string;
  score: number;
  taskId: string;
  verdict: string;
};

/**
 * Re-send the evaluator's verdict from the persisted payload.
 *
 * Every argument is a value the evaluator fixed at submission -- verdict, score, confidence,
 * evidence hash, award split -- so nothing is recomputed and nothing can mean something
 * different later. The evaluator's own address is the intent row's `payer`, recorded at the
 * same moment and for the same reason.
 *
 * A second landing is refused by the chain rather than tolerated: `evaluate` requires Review
 * (or Open/PendingApproval in the contest modes) and leaves the task Appealing, so a replay
 * reverts `WrongStatusForEvaluation`. That is deterministic, which `classifyRelayFailure`
 * terminates rather than retries.
 */
export async function broadcastEvaluationsEvaluate(context: {
  evaluator: string;
  payload: EvaluationsEvaluateIntentPayload;
}): Promise<`0x${string}`> {
  const { payload } = context;
  const result = await contractEvaluate(
    payload.taskId as `0x${string}`,
    context.evaluator as `0x${string}`,
    VERDICT_MAP[payload.verdict] ?? 0,
    payload.score,
    payload.confidence,
    payload.evidenceHash as `0x${string}`,
    awardArgs(payload.awards)
  );
  return result.txHash;
}

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
    // Guarded to the states evaluate() is callable from, plus 'appealing' itself so the
    // indexer's processTaskEvaluatedEvent winning the race does not cost us the fields it
    // cannot derive (appealDeadline, confidence, evidence hash, evaluator stake).
    //
    // This does NOT contradict completeEvaluationsFinalizeVerdict's deliberately unguarded
    // updates below. That one writes a terminal state, so an indexer-first row can only be
    // moved forward by it. This one writes 'appealing', which is mid-lifecycle: a late retry
    // landing after the task reached disputed, completed or cancelled would drag it backwards
    // -- the exact regression ADR-0007 records, and which the indexer's own handler guards
    // against for the same event.
    .where(and(eq(tasks.id, payload.taskId), inArray(tasks.status, EVALUATABLE_STATUSES)));
}

export type EvaluationsAppealIntentPayload = { taskId: string };

/**
 * Re-send the worker's appeal.
 *
 * `appeal` takes nothing but the task id, and the appellant is the intent's `payer` -- the
 * router has already established that address is the task's worker, and that finding is what
 * the intent row preserves.
 *
 * A second landing reverts `NotInAppealingState`: appeal requires Appealing and leaves the
 * task Disputed, so the transition is one-shot on chain.
 */
export function broadcastEvaluationsAppeal(context: {
  payload: EvaluationsAppealIntentPayload;
  worker: string;
}): Promise<`0x${string}`> {
  return contractAppeal(context.payload.taskId as `0x${string}`, context.worker as `0x${string}`);
}

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
  /**
   * The full award split and verdict the resolver decided on.
   *
   * The completion only ever needed `firstAwardWorker`, so that was all the payload carried
   * and the rest lived on the request's stack. That made the intent unreplayable: the payload
   * could not be turned back into the call it stood for. Recording the decision itself rather
   * than a projection of it is what ADR-0050 point 7 asks for -- the payload has to be the
   * call, not a summary of what the call implied.
   */
  awards: EvaluationAwardPayload[];
  firstAwardWorker: string;
  taskId: string;
  verdict: string;
};

/**
 * Re-send the dispute resolution from the resolver's recorded decision.
 *
 * The resolver's address is the intent's `payer`; the router has already checked it against
 * the task's `disputeResolver`.
 *
 * A second landing reverts `NotInDisputedState`: resolveDispute requires Disputed and settles
 * the task out of it, so the payout cannot happen twice.
 */
export async function broadcastEvaluationsResolveDispute(context: {
  payload: EvaluationsResolveDisputeIntentPayload;
  resolver: string;
}): Promise<`0x${string}`> {
  const { payload } = context;
  const result = await contractResolveDispute(
    payload.taskId as `0x${string}`,
    context.resolver as `0x${string}`,
    VERDICT_MAP[payload.verdict] ?? 0,
    awardArgs(payload.awards)
  );
  return result.txHash;
}

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

/**
 * Re-send the requester's evaluator timeout.
 *
 * Takes only the task id, with the requester supplied as the intent's `payer`.
 *
 * A second landing reverts `NotInReviewState`: the call requires Review and leaves the task
 * PendingApproval, and it forfeits the evaluator's stake exactly once because the same
 * transition zeroes it.
 */
export function broadcastEvaluationsEvaluatorTimeout(context: {
  payload: EvaluationsEvaluatorTimeoutIntentPayload;
  requester: string;
}): Promise<`0x${string}`> {
  return contractEvaluatorTimeout(
    context.payload.taskId as `0x${string}`,
    context.requester as `0x${string}`
  );
}

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

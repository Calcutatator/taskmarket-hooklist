// Implements: ADR-0045, ADR-0050
import { and, eq, isNull } from 'drizzle-orm';

import type { db as DbType } from '../../db/client';
import { submissions, tasks } from '../../db/schema';
import {
  contractCancelTask,
  contractRefundExpired,
  contractRejectSubmission,
  contractUpdateTask,
} from '../contract';

type Db = typeof DbType;

/**
 * Everything `contractUpdateTask` is called with, alongside the columns the completion writes.
 *
 * The chain arguments are recorded rather than left on the request's stack because a rebroadcast
 * runs in a process that never saw the request (ADR-0050). `currentReward` is the one that had
 * to be added rather than re-read, and it is why this payload grew: it is the pre-update
 * `task.reward` the x402 middleware sized the payment against, and the value
 * `contractUpdateTask` subtracts to get the delta the forwarder pulls. Re-reading it at
 * rebroadcast time would read a row a confirmed first attempt may already have moved, sizing the
 * forwarder's transfer against a different number than the payer was charged -- precisely the
 * state-derived field ADR-0050 says a payload must carry rather than recompute.
 *
 * The bigint arguments are strings because jsonb has no bigint, and are restored on the way out,
 * so what is relayed is arithmetically identical to what the request relayed.
 */
export type TasksUpdateIntentPayload = {
  contractAddress: string | null;
  /** Pre-update `task.reward`, in USDC base units. */
  currentReward: string;
  dbUpdate: Record<string, unknown>;
  newBidDeadline: string;
  newExpiryTime: string;
  newPitchDeadline: string;
  newReward: string;
  taskId: string;
};

/**
 * Re-send the requester's task update.
 *
 * Replays the recorded arguments verbatim, so the forwarder pulls the same
 * `newReward - currentReward` delta the request's payment was sized against and the Diamond is
 * asked for the same change. Nothing is recomputed: the deadlines are absolute timestamps fixed
 * when the request was validated, not durations re-derived from the clock.
 *
 * A second landing that names a reward reverts `NoRewardChange()` (ADR-0054). That revert is
 * load-bearing rather than incidental. The forwarder moves the delta out of the server wallet
 * *before* the Diamond executes and the Diamond has no path to hand it back, so the silent
 * no-op this replaced kept the money. Reverting unwinds the transfer along with the rest of the
 * transaction, which is the only mechanism available on this side of the forwarder boundary --
 * atomicity is the tie. A reward *decrease* is covered by the same revert, which is what stops a
 * replay taking the escrow refund leg twice.
 *
 * A second landing that names no reward (`newReward == 0`, a deadline-only edit) does not revert
 * and does not need to: `contractUpdateTask` relays `paymentAmount = 0` in that case, so no
 * money moves at all, and the deadline writes assign the same recorded absolute timestamps.
 */
export function broadcastTasksUpdate(context: {
  payer: string;
  payload: TasksUpdateIntentPayload;
}): Promise<`0x${string}`> {
  const { payload } = context;
  return contractUpdateTask(
    payload.taskId as `0x${string}`,
    context.payer as `0x${string}`,
    BigInt(payload.newReward),
    BigInt(payload.newExpiryTime),
    BigInt(payload.newBidDeadline),
    BigInt(payload.newPitchDeadline),
    BigInt(payload.currentReward),
    payload.contractAddress
  );
}

/**
 * Apply the off-chain half of a confirmed task update.
 *
 * The payload carries the already-resolved column set rather than the raw input, so the
 * completion has no branching of its own to get wrong when it runs from the reconciler.
 * Date-valued columns are serialized to ISO strings by jsonb and restored here.
 *
 * Idempotent: assignment to fixed values.
 */
export async function completeTasksUpdate(context: {
  db: Db;
  payload: TasksUpdateIntentPayload;
}): Promise<void> {
  const { payload } = context;
  const dbUpdate = restoreDateColumns(payload.dbUpdate);
  if (Object.keys(dbUpdate).length === 0) return;
  await context.db.update(tasks).set(dbUpdate).where(eq(tasks.id, payload.taskId));
}

const DATE_COLUMNS = new Set(['bidDeadline', 'expiryTime', 'pitchDeadline']);

function restoreDateColumns(dbUpdate: Record<string, unknown>): Record<string, unknown> {
  const restored: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(dbUpdate)) {
    restored[key] = DATE_COLUMNS.has(key) && typeof value === 'string' ? new Date(value) : value;
  }
  return restored;
}

export type TasksCancelIntentPayload = {
  contractAddress: string | null;
  requester: string;
  /** Null where the task row carried none; the contract reads 0 as "no ERC-8004 identity". */
  requesterAgentId: string | null;
  taskId: string;
};

/**
 * Re-send the requester's cancellation.
 *
 * The three arguments the call needs beyond the task id -- the requester, their ERC-8004
 * agentId and the task's contract address -- are all read from the task row at request time
 * and are now recorded rather than left on the request's stack. None of them is time-derived,
 * so replaying them is replaying the same call.
 *
 * A second landing reverts `TaskNotOpen`: `cancelTask` requires Open and sets Cancelled, so the
 * escrow refund it performs is gated by a one-shot transition and cannot be taken twice.
 */
export function broadcastTasksCancel(context: {
  payload: TasksCancelIntentPayload;
}): Promise<`0x${string}`> {
  const { payload } = context;
  return contractCancelTask(
    payload.taskId as `0x${string}`,
    payload.requester as `0x${string}`,
    payload.requesterAgentId ? BigInt(payload.requesterAgentId) : 0n,
    payload.contractAddress
  );
}

/**
 * A confirmed cancel closes the task.
 *
 * Scoped to tasks not already cancelled, for the same reason
 * `completeTasksRejectSubmission` is: `cancelledAt` is a wall-clock stamp, so a second
 * completion attempt would move the original cancellation forward in time (ADR-0050). The
 * status assignment is idempotent either way, and the first attempt already applied it.
 */
export async function completeTasksCancel(context: {
  db: Db;
  payload: TasksCancelIntentPayload;
}): Promise<void> {
  await context.db
    .update(tasks)
    .set({ cancelledAt: new Date(), status: 'cancelled' })
    .where(and(eq(tasks.id, context.payload.taskId), isNull(tasks.cancelledAt)));
}

/**
 * What `contractRefundExpired` is called with.
 *
 * `requesterAgentId` is the task row's ERC-8004 identity, read when the request was validated
 * and recorded here rather than re-read at rebroadcast time. It is a stable property of the
 * requester rather than anything derived from task state, so replaying it is replaying the same
 * call; recording it is what lets the call be reconstructed in a process that never served the
 * request (ADR-0050).
 *
 * The caller is not in the payload. `refundExpired` is permissionless (ADR-0026), so the
 * forwarder's sender is provenance rather than authorisation, and the intent row's own `payer`
 * -- the identity the request established -- is the right value to relay as. It is recorded on
 * the row already, so putting a second copy in the payload would only create two places for it
 * to disagree.
 */
export type TasksRefundExpiredIntentPayload = {
  /** Null where the task row carried none; the contract reads 0 as "no ERC-8004 identity". */
  requesterAgentId: string | null;
  taskId: string;
};

/**
 * Re-send the expiry refund.
 *
 * A second landing reverts `TaskAlreadyRefunded()` (ADR-0054): `refundExpired` now treats the
 * `Expired` status it sets itself as terminal, exactly as it already treated `Accepted` and
 * `Cancelled`, and both refund paths zero `task.reward` before transferring in
 * checks-effects-interactions order. Two independent mechanisms, which matters here more than
 * elsewhere because escrow is one pooled balance shared by every task -- a repeat refund spends
 * unrelated, fully funded tasks' money.
 *
 * Permissionless entry and single-shot execution are orthogonal, and it was the missing second
 * one that made this unreplayable before. ADR-0026 is untouched: anyone may still call this to
 * recover a stranded task's escrow, they just cannot call it twice.
 *
 * The revert is terminal rather than a retry loop because `TaskAlreadyRefunded` is in
 * `KNOWN_ERRORS`, so `decodeRelayRevert` names it instead of returning "unknown revert" and
 * `classifyRelayFailure` reads it as deterministic. `dispatchRelayedIntent` then stops without
 * running the completion handler at all -- which is the correct outcome, since a replay that
 * reverted moved no money and the first attempt's completion already wrote `status = 'expired'`.
 */
export function broadcastTasksRefundExpired(context: {
  payer: string;
  payload: TasksRefundExpiredIntentPayload;
}): Promise<`0x${string}`> {
  const { payload } = context;
  return contractRefundExpired(
    payload.taskId as `0x${string}`,
    context.payer as `0x${string}`,
    payload.requesterAgentId ? BigInt(payload.requesterAgentId) : 0n
  );
}

/** A confirmed expiry refund marks the task expired. */
export async function completeTasksRefundExpired(context: {
  db: Db;
  payload: TasksRefundExpiredIntentPayload;
}): Promise<void> {
  await context.db
    .update(tasks)
    .set({ status: 'expired' })
    .where(eq(tasks.id, context.payload.taskId));
}

export type TasksRejectSubmissionIntentPayload = {
  requester: string;
  taskId: string;
  worker: string;
};

/**
 * Re-send the requester's rejection of one worker's submissions.
 *
 * Two addresses and a task id, all fixed when the request was validated.
 *
 * A second landing reverts `SubmissionAlreadyRejected`: the contract keeps
 * `taskRejectedWorkers[taskId][worker]` as a one-shot flag, and the active-submission
 * decrement that gates `cancelTask` sits behind it, so the count cannot be driven down twice.
 */
export function broadcastTasksRejectSubmission(context: {
  payload: TasksRejectSubmissionIntentPayload;
}): Promise<`0x${string}`> {
  const { payload } = context;
  return contractRejectSubmission(
    payload.taskId as `0x${string}`,
    payload.worker as `0x${string}`,
    payload.requester as `0x${string}`
  );
}

/**
 * Mark the rejected worker's submissions rejected.
 *
 * Scoped to rows not already rejected so a re-run does not move an earlier rejection's
 * timestamp forward.
 */
export async function completeTasksRejectSubmission(context: {
  db: Db;
  payload: TasksRejectSubmissionIntentPayload;
}): Promise<void> {
  const { payload } = context;
  await context.db
    .update(submissions)
    .set({ rejectedAt: new Date() })
    .where(
      and(
        eq(submissions.taskId, payload.taskId),
        eq(submissions.workerAddress, payload.worker),
        isNull(submissions.rejectedAt)
      )
    );
}

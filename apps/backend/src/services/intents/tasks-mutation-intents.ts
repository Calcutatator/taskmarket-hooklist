// Implements: ADR-0045, ADR-0050
import { and, eq, isNull } from 'drizzle-orm';

import type { db as DbType } from '../../db/client';
import { submissions, tasks } from '../../db/schema';
import { contractCancelTask, contractRejectSubmission } from '../contract';

type Db = typeof DbType;

/**
 * No broadcaster, deliberately -- see `register.ts`.
 *
 * `contractUpdateTask` relays with `paymentAmount = newReward - currentReward`, and the
 * forwarder moves that USDC out of the server wallet on *every* relay. The contract, meanwhile,
 * only applies a reward change when `newReward != task.reward`, so a replay of an update that
 * already landed transfers the increase a second time and then no-ops the state change that
 * would have justified it. The escrow gains money no task accounts for.
 *
 * This is not a payload problem and cannot be fixed by carrying more in the payload: the
 * duplicate transfer happens in the forwarder, outside anything the payload controls.
 */
export type TasksUpdateIntentPayload = {
  dbUpdate: Record<string, unknown>;
  taskId: string;
};

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
 * No broadcaster, deliberately -- see `register.ts`.
 *
 * `CoreFacet.refundExpired` has no already-refunded guard. It rejects Accepted and Cancelled,
 * but `Expired` -- the status it sets itself -- is not rejected, and `task.reward` is never
 * zeroed. A second landing therefore transfers the full reward to the requester again, out of
 * the single pooled escrow balance every task shares, which is other tasks' money. Today the
 * only thing standing between that and a real double refund is the router's own `status ===
 * 'expired'` check against the database.
 *
 * No payload can fix this, because the missing guard is on chain. Giving this operation a
 * broadcaster would mean the one relayed write whose replay costs real money is also the one
 * the chain declines to stop.
 */
export type TasksRefundExpiredIntentPayload = { taskId: string };

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

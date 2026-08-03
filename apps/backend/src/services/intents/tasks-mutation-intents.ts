// Implements: ADR-0045
import { and, eq, isNull } from 'drizzle-orm';

import type { db as DbType } from '../../db/client';
import { submissions, tasks } from '../../db/schema';

type Db = typeof DbType;

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

export type TasksCancelIntentPayload = { taskId: string };

/** A confirmed cancel closes the task. Idempotent by assignment. */
export async function completeTasksCancel(context: {
  db: Db;
  payload: TasksCancelIntentPayload;
}): Promise<void> {
  await context.db
    .update(tasks)
    .set({ cancelledAt: new Date(), status: 'cancelled' })
    .where(eq(tasks.id, context.payload.taskId));
}

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

export type TasksRejectSubmissionIntentPayload = { taskId: string; worker: string };

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

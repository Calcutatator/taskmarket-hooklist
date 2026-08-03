// Implements: ADR-0045
import { and, eq, ne } from 'drizzle-orm';

import type { db as DbType } from '../../db/client';
import { proposals, tasks } from '../../db/schema';

type Db = typeof DbType;

export type PitchesSubmitIntentPayload = {
  estimatedDuration: number | null;
  pitchHash: string;
  pitchId: string;
  pitchText: string;
  signature: string;
  taskId: string;
  workerAddress: string;
};

/** Record the pitch a confirmed submitPitch anchored. Idempotent by the pitch's own id. */
export async function completePitchesSubmit(context: {
  db: Db;
  payload: PitchesSubmitIntentPayload;
  txHash: `0x${string}`;
}): Promise<void> {
  const { payload } = context;
  await context.db
    .insert(proposals)
    .values({
      estimatedDuration: payload.estimatedDuration,
      id: payload.pitchId,
      pitchHash: payload.pitchHash,
      proposalText: payload.pitchText,
      signature: payload.signature,
      status: 'pending',
      submitTxHash: context.txHash,
      taskId: payload.taskId,
      workerAddress: payload.workerAddress,
    })
    .onConflictDoNothing();
}

export type PitchesSelectIntentPayload = {
  pitchId: string;
  taskId: string;
  workerAddress: string;
};

/**
 * Mark the selected pitch, reject the rest, and move the task to worker_selected.
 *
 * Every write is an assignment to a fixed value, so re-running the completion produces the
 * same rows -- no counters, no conditional transitions.
 */
export async function completePitchesSelect(context: {
  db: Db;
  payload: PitchesSelectIntentPayload;
}): Promise<void> {
  const { db, payload } = context;

  await db.update(proposals).set({ status: 'selected' }).where(eq(proposals.id, payload.pitchId));

  await db
    .update(proposals)
    .set({ status: 'rejected' })
    .where(and(eq(proposals.taskId, payload.taskId), ne(proposals.id, payload.pitchId)));

  await db
    .update(tasks)
    .set({ claimedBy: payload.workerAddress, status: 'worker_selected' })
    .where(eq(tasks.id, payload.taskId));
}

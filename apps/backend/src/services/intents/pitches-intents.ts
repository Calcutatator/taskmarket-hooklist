// Implements: ADR-0045, ADR-0050
import { and, eq, ne } from 'drizzle-orm';

import type { db as DbType } from '../../db/client';
import { proposals, tasks } from '../../db/schema';
import { contractSelectWorker, contractSubmitPitch } from '../contract';

type Db = typeof DbType;

export type PitchesSubmitIntentPayload = {
  contractAddress: string | null;
  estimatedDuration: number | null;
  pitchHash: string;
  pitchId: string;
  pitchText: string;
  signature: string;
  taskId: string;
  workerAddress: string;
};

/**
 * Re-anchor the worker's pitch hash.
 *
 * The hash is a commitment over the pitch text the worker submitted, computed once and stored
 * alongside the text it commits to, so replaying it cannot drift from what is in the database.
 *
 * Like `submitBid`, `submitPitch` pushes onto an array with no per-worker dedupe on chain, so
 * the guard is the never-broadcast precondition rather than a revert. A duplicate would be
 * inert: the same hash appended twice, no money moved, and the `proposals` insert is
 * conflict-do-nothing on the pitch id the request minted.
 */
export function broadcastPitchesSubmit(context: {
  payload: PitchesSubmitIntentPayload;
}): Promise<`0x${string}`> {
  const { payload } = context;
  return contractSubmitPitch(
    payload.taskId as `0x${string}`,
    payload.workerAddress as `0x${string}`,
    payload.pitchHash as `0x${string}`,
    payload.contractAddress
  );
}

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
  contractAddress: string | null;
  pitchId: string;
  /**
   * The task's requester, which is the address this call is relayed as.
   *
   * Not the same thing as the intent's `payer`: `pitches.select` accepts payment from anyone
   * and authorises the selection by a requester signature instead, so the payer and the
   * on-chain sender genuinely differ. Recording the requester explicitly is what keeps the
   * rebroadcast from relaying as the wrong address.
   */
  requester: string;
  taskId: string;
  workerAddress: string;
};

/**
 * Re-send the requester's worker selection.
 *
 * A second landing reverts `TaskNotOpen`: `selectWorker` requires Open and sets WorkerSelected,
 * so a replay cannot move the task to a different worker after the fact.
 */
export function broadcastPitchesSelect(context: {
  payload: PitchesSelectIntentPayload;
}): Promise<`0x${string}`> {
  const { payload } = context;
  return contractSelectWorker(
    payload.taskId as `0x${string}`,
    payload.requester as `0x${string}`,
    payload.workerAddress as `0x${string}`,
    payload.contractAddress
  );
}

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

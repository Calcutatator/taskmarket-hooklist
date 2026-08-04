// Implements: ADR-0045, ADR-0050
import { and, eq, inArray, ne } from 'drizzle-orm';

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
 * The statuses `selectWorker()` is callable from (CoreFacet.selectWorker requires Open), plus its
 * own result.
 */
const SELECTABLE_STATUSES = ['open', 'worker_selected'] as const;

/**
 * Mark the selected pitch, reject the rest, and move the task to worker_selected.
 *
 * Every write is an assignment to a fixed value, so re-running the completion produces the
 * same rows -- no counters, no conditional transitions.
 *
 * The task update is nonetheless guarded on status, like `completeEvaluationsEvaluate`:
 * 'worker_selected' is mid-lifecycle, near the start of it, so a reconciler retry landing hours
 * later would drag a task that has since been submitted to, accepted, cancelled or expired all
 * the way back to "a worker has just been picked". The allowed set is what the chain permits the
 * call from ('open') plus 'worker_selected' itself, so an indexer that processed
 * TaskWorkerSelected first does not cost us `claimedBy`.
 */
export async function completePitchesSelect(context: {
  db: Db;
  payload: PitchesSelectIntentPayload;
}): Promise<void> {
  const { db, payload } = context;

  // The two proposal writes below are deliberately NOT guarded the way the task update is,
  // and the asymmetry is the point rather than an oversight.
  //
  // Nothing else ever writes a proposal's status: the indexer's PitchSubmitted handler only
  // patches `pitchHash`/`submitTxHash`, so this function is the sole path from 'pending' to
  // 'selected'/'rejected'. The natural predicate for a guard here would be the task's own
  // status, and that is exactly what makes it wrong: a legitimate first completion racing an
  // indexer that has already moved the task past 'worker_selected' (the worker submitted
  // straight away, TaskSubmitted landed first) would be skipped, and the pitches would sit at
  // 'pending' for ever with no later pass to fix them.
  //
  // Re-stamping on a stale retry costs nothing in return. Both values are fixed, and the pitch
  // set is frozen once selection happens -- `submitPitch` requires the task to be Open on
  // chain -- so a late rerun assigns each row the value it already holds.
  await db.update(proposals).set({ status: 'selected' }).where(eq(proposals.id, payload.pitchId));

  await db
    .update(proposals)
    .set({ status: 'rejected' })
    .where(and(eq(proposals.taskId, payload.taskId), ne(proposals.id, payload.pitchId)));

  await db
    .update(tasks)
    .set({ claimedBy: payload.workerAddress, status: 'worker_selected' })
    .where(and(eq(tasks.id, payload.taskId), inArray(tasks.status, SELECTABLE_STATUSES)));
}

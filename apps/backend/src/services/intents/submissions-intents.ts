// Implements: ADR-0045, ADR-0050
import { and, eq, inArray } from 'drizzle-orm';

import type { db as DbType } from '../../db/client';
import { artifacts, submissions, tasks } from '../../db/schema';
import { contractSubmitWork } from '../contract';
import { assertUnderHardSubmissionCeilingForInsert } from '../submission-allowance';

type Db = typeof DbType;

/** One artifact row, already validated and uploaded, in a form a jsonb payload can carry. */
export type SubmissionArtifactPayload = {
  displayOrder: number;
  fileName: string;
  id: string;
  keccak256Hash: string;
  mediaKind: string;
  mimeType: string;
  role: string;
  sha256Hash: string;
  sizeBytes: number;
  storageUri: string;
  submissionId: string;
  taskId: string;
};

export type SubmissionsSubmitIntentPayload = {
  artifacts: SubmissionArtifactPayload[];
  contractAddress: string | null;
  deliverableHash: string;
  mode: string;
  signature: string;
  submissionId: string;
  taskId: string;
  workerAddress: string;
};

/**
 * The two submission endpoints -- raw bytes and presigned keys -- differ only in how they
 * obtain the artifact rows. By the time either has a deliverable hash they are the same
 * operation, so they share one intent kind and one completion.
 */
export function broadcastSubmissionsSubmit(context: {
  payload: SubmissionsSubmitIntentPayload;
}): Promise<`0x${string}`> {
  const { payload } = context;
  return contractSubmitWork(
    payload.taskId as `0x${string}`,
    payload.workerAddress as `0x${string}`,
    payload.deliverableHash as `0x${string}`,
    payload.contractAddress
  );
}

/**
 * Record the submission a confirmed submitWork committed to.
 *
 * This is the half that used to run inline after the receipt, which meant a receipt arriving
 * after the request had gone left the deliverable hash on chain with no submission row behind
 * it -- a worker's accepted work that the product cannot show, pay out against, or even prove
 * exists. That is the divergence ADR-0045 exists to close, and it is why this path is worth
 * wiring even though nothing here is paid for.
 *
 * Idempotent by the ids the request minted: both inserts conflict-do-nothing on their primary
 * keys, and the status flip is conditioned on the pre-submission states so a late retry cannot
 * pull an accepted or cancelled task back to `pending_approval`.
 */
export async function completeSubmissionsSubmit(context: {
  db: Db;
  payload: SubmissionsSubmitIntentPayload;
  txHash: `0x${string}`;
}): Promise<void> {
  const { db, payload } = context;

  await db.transaction(async (tx) => {
    // RFC-0006 Tier 2 (ADR-0037). Unchanged in substance and deliberately still here rather
    // than moved before the chain call: the ceiling has to be evaluated in the same
    // transaction as the insert it guards, or concurrent submissions all read the same
    // under-ceiling count and all insert.
    if (payload.mode === 'bounty' || payload.mode === 'benchmark') {
      await assertUnderHardSubmissionCeilingForInsert(tx, payload.taskId, payload.workerAddress);
    }

    await tx
      .insert(submissions)
      .values({
        deliverableHash: payload.deliverableHash,
        fileUrl: payload.artifacts[0]!.storageUri,
        id: payload.submissionId,
        signature: payload.signature,
        submitTxHash: context.txHash,
        taskId: payload.taskId,
        workerAddress: payload.workerAddress,
      })
      .onConflictDoNothing();

    await tx
      .insert(artifacts)
      .values(
        payload.artifacts.map((artifact) => ({
          ...artifact,
          keccak256Hash: artifact.keccak256Hash as `0x${string}`,
          mediaKind: artifact.mediaKind as never,
          role: artifact.role as never,
        }))
      )
      .onConflictDoNothing();

    // Bounty/Benchmark are open contests: the task stays `open` and keeps accepting
    // submissions until the requester accepts one or it expires. Claim/pitch/auction have a
    // single designated worker, so they flip to pending_approval for the requester to accept.
    if (payload.mode !== 'bounty' && payload.mode !== 'benchmark') {
      await tx
        .update(tasks)
        .set({ status: 'pending_approval' })
        .where(
          and(
            eq(tasks.id, payload.taskId),
            inArray(tasks.status, ['claimed', 'worker_selected', 'open'])
          )
        );
    }
  });
}

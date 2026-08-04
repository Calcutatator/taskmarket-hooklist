// Implements: ADR-0045
import type { db as DbType } from '../../db/client';
import { proofs, submissions } from '../../db/schema';
import { contractSubmitWork } from '../contract';
import { dispatchRelayedIntent } from '../relayed-intent-registry';
import { derivedIdempotencyKey, recordRelayedIntent } from '../relayed-intents';

type Db = typeof DbType;

export type ProofsSubmitIntentPayload = {
  contractAddress: string | null;
  metricValue: string | null;
  proofData: string;
  proofHash: string;
  proofId: string;
  proofType: string;
  signature: string;
  submissionId: string;
  taskId: string;
  workerAddress: string;
};

export type ProofsAnchorDeliverableIntentPayload = {
  contractAddress: string | null;
  proofHash: string;
  proofId: string;
  signature: string;
  submissionId: string;
  taskId: string;
  workerAddress: string;
};

/**
 * Record the proof a confirmed submitProof anchored, then start the deliverable commitment.
 *
 * Benchmark acceptance is driven by submitWork commitments, so a proof-only entry needs its
 * canonical hash registered as the deliverable too. That is a second contract call, and gets
 * a durable record of its own rather than being made from inside this handler (ADR-0045) --
 * the same shape task creation uses for evaluator assignment. It carries no payment: the fee
 * bought the proof submission, which is on chain, so there is nothing here to refund.
 */
export async function completeProofsSubmit(context: {
  db: Db;
  payload: ProofsSubmitIntentPayload;
  txHash: `0x${string}`;
}): Promise<void> {
  const { db, payload } = context;

  await db
    .insert(proofs)
    .values({
      id: payload.proofId,
      metricValue: payload.metricValue,
      proofData: payload.proofData,
      proofHash: payload.proofHash,
      proofType: payload.proofType,
      signature: payload.signature,
      status: 'pending',
      submitTxHash: context.txHash,
      taskId: payload.taskId,
      workerAddress: payload.workerAddress,
    })
    .onConflictDoNothing();

  const anchorIntent = await recordRelayedIntent({
    db,
    // Derived from the proof this follows, not random: completion is at-least-once, so a
    // rerun must land on the same anchor intent rather than anchor the deliverable twice
    // (ADR-0052).
    idempotencyKey: derivedIdempotencyKey(`${payload.proofId}:proofs.anchorDeliverable`),
    operation: 'proofs.anchorDeliverable',
    payer: payload.workerAddress,
    payload: {
      contractAddress: payload.contractAddress,
      proofHash: payload.proofHash,
      proofId: payload.proofId,
      signature: payload.signature,
      submissionId: payload.submissionId,
      taskId: payload.taskId,
      workerAddress: payload.workerAddress,
    } satisfies ProofsAnchorDeliverableIntentPayload,
  });

  // Never throws: the proof is anchored on chain whatever happens to the commitment, and the
  // intent row records where it stopped.
  await dispatchRelayedIntent({ db, intent: anchorIntent });
}

/** Record the submission row the deliverable commitment created. Idempotent by its own id. */
export async function completeProofsAnchorDeliverable(context: {
  db: Db;
  payload: ProofsAnchorDeliverableIntentPayload;
  txHash: `0x${string}`;
}): Promise<void> {
  const { payload } = context;
  await context.db
    .insert(submissions)
    .values({
      deliverableHash: payload.proofHash,
      fileUrl: `taskmarket-proof:${payload.proofId}`,
      id: payload.submissionId,
      signature: payload.signature,
      submitTxHash: context.txHash,
      taskId: payload.taskId,
      workerAddress: payload.workerAddress,
    })
    .onConflictDoNothing();
}

export function broadcastProofsAnchorDeliverable(context: {
  payload: ProofsAnchorDeliverableIntentPayload;
}): Promise<`0x${string}`> {
  const { payload } = context;
  return contractSubmitWork(
    payload.taskId as `0x${string}`,
    payload.workerAddress as `0x${string}`,
    payload.proofHash as `0x${string}`,
    payload.contractAddress
  );
}

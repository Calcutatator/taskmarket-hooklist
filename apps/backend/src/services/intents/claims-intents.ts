// Implements: ADR-0045, ADR-0050
import { and, eq } from 'drizzle-orm';

import type { db as DbType } from '../../db/client';
import { claims, tasks } from '../../db/schema';
import { contractClaimTask, contractForfeitAndReopen } from '../contract';

type Db = typeof DbType;

export type ClaimsClaimIntentPayload = {
  claimId: string;
  contractAddress: string | null;
  taskId: string;
  workerAddress: string;
};

export type ClaimsForfeitIntentPayload = {
  contractAddress: string | null;
  requesterAddress: string;
  taskId: string;
};

export function broadcastClaimsClaim(context: {
  payload: ClaimsClaimIntentPayload;
}): Promise<`0x${string}`> {
  const { payload } = context;
  return contractClaimTask(
    payload.taskId as `0x${string}`,
    payload.workerAddress as `0x${string}`,
    0n,
    payload.contractAddress
  );
}

/**
 * Record the claim a confirmed claimTask created.
 *
 * The claim id is minted by the request and carried in the payload, not generated here: the
 * request returns it to the caller before the receipt is necessarily in hand, so it has to be
 * stable across every attempt for the insert to be idempotent.
 *
 * The task update is conditioned on `open` rather than written unconditionally. On a first run
 * that is exactly the state the request already validated; on a reconciler retry hours later it
 * is what stops the task being dragged back to `claimed` from wherever the chain has since
 * moved it, and re-stamping `claimedAt` with a time that is not when the claim happened.
 */
export async function completeClaimsClaim(context: {
  db: Db;
  payload: ClaimsClaimIntentPayload;
  txHash: `0x${string}`;
}): Promise<void> {
  const { db, payload } = context;

  await db
    .insert(claims)
    .values({
      id: payload.claimId,
      stakeAmount: '0',
      stakeTxHash: context.txHash,
      status: 'active',
      taskId: payload.taskId,
      workerAddress: payload.workerAddress,
    })
    .onConflictDoNothing();

  await db
    .update(tasks)
    .set({
      claimedAt: new Date(),
      claimedBy: payload.workerAddress,
      status: 'claimed',
    })
    .where(and(eq(tasks.id, payload.taskId), eq(tasks.status, 'open')));
}

export function broadcastClaimsForfeit(context: {
  payload: ClaimsForfeitIntentPayload;
}): Promise<`0x${string}`> {
  const { payload } = context;
  return contractForfeitAndReopen(
    payload.taskId as `0x${string}`,
    payload.requesterAddress as `0x${string}`,
    payload.contractAddress
  );
}

/**
 * Reopen the task a confirmed forfeitAndReopen released, and retire its claim.
 *
 * Both writes are in one transaction for the same reason the request did it that way: a task
 * back to `open` while its claim still reads `active` would let the reopened task be claimed
 * again with a stale claim row shadowing it. The task update is guarded on `claimed` so a late
 * retry cannot reopen a task somebody has since claimed afresh.
 */
export async function completeClaimsForfeit(context: {
  db: Db;
  payload: ClaimsForfeitIntentPayload;
}): Promise<void> {
  const { db, payload } = context;

  await db.transaction(async (tx) => {
    await tx.update(claims).set({ status: 'forfeited' }).where(eq(claims.taskId, payload.taskId));
    await tx
      .update(tasks)
      .set({ claimedAt: null, claimedBy: null, status: 'open' })
      .where(and(eq(tasks.id, payload.taskId), eq(tasks.status, 'claimed')));
  });
}

import { router, publicProcedure } from '../trpc';
import {
  ClaimCreateSchema,
  ClaimResponseSchema,
  buildClaimMessage,
  buildForfeitMessage,
} from '@taskmarket/shared';
import { z } from 'zod';
import { claims, tasks } from '../db/schema';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { contractClaimTask, contractForfeitAndReopen } from '../services/contract';
import { runRelayedIntent } from '../services/relayed-intent-request';
import type {
  ClaimsClaimIntentPayload,
  ClaimsForfeitIntentPayload,
} from '../services/intents/claims-intents';
import { verifySignedAddressOrThrow } from '../lib/agents';
import { TRPCError } from '@trpc/server';
import { fetchPrivateViewabilityContext } from '../lib/task-visibility';
import type { Context } from '../context';

/**
 * Phase 3 (ADR-0030) parity fix (F6): `claim` must enforce the same private-task
 * standing check as this router's read paths, instead of letting any address with a
 * valid self-signature claim a `taskVisibility: 'private'` claim-mode task before an
 * invited worker gets to it. Unlike submit's `claimedBy` check, claiming IS the act of
 * becoming the assignee -- `task.claimedBy` is still null at this point for an open
 * task, so standing here reduces to requester / an awarded worker (task_awards) / an
 * allowlisted wallet (task_allowed_viewers). Deliberately narrower than the
 * general-purpose `canView` helper: a bare `taskAccessGrant` (the view-only,
 * password-derived bearer credential from `taskAccess.verifyPassword`) is never
 * sufficient, since that credential exists purely for read/view access and was never
 * meant to authorize a write/participation action like claiming.
 *
 * Must run AFTER the caller's identity is cryptographically resolved (signature
 * verification via verifySignedAddressOrThrow), never before -- checking earlier would
 * let an attacker probe arbitrary candidate addresses and use the
 * FORBIDDEN-vs-signature-error response difference as a private-task membership
 * oracle.
 */
async function assertCanParticipateInPrivateTask(
  db: Context['db'],
  task: { id: string; taskVisibility: string; requester: string; claimedBy: string | null },
  address: string
): Promise<void> {
  if (task.taskVisibility !== 'private') return;

  const normalized = address.toLowerCase();
  if (normalized === task.requester.toLowerCase()) return;
  if (task.claimedBy && normalized === task.claimedBy.toLowerCase()) return;

  const { allowedViewerAddresses, awardedWorkerAddresses } = await fetchPrivateViewabilityContext(
    db,
    task.id
  );
  if (awardedWorkerAddresses.has(normalized) || allowedViewerAddresses.has(normalized)) return;

  throw new TRPCError({
    code: 'FORBIDDEN',
    message: 'Not authorized to claim this private task',
  });
}

export const claimsRouter = router({
  claim: publicProcedure
    .meta({
      openapi: {
        method: 'POST',
        path: '/tasks/{taskId}/claim',
        tags: ['Tasks'],
        summary: 'Claim an instant task',
      },
    })
    .input(ClaimCreateSchema)
    .output(z.object({ success: z.boolean(), claimId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const taskResult = await ctx.db
        .select()
        .from(tasks)
        .where(eq(tasks.id, input.taskId))
        .limit(1);

      if (taskResult.length === 0) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Task not found' });
      }

      const task = taskResult[0];

      if (task.mode !== 'claim') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Not a Claim task' });
      }

      if (task.status !== 'open') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Task not available for claiming' });
      }

      const message = buildClaimMessage(input.taskId);
      await verifySignedAddressOrThrow(message, input.signature, input.workerAddress, {
        invalid_signature: () =>
          new TRPCError({ code: 'BAD_REQUEST', message: 'Invalid signature' }),
        address_mismatch: () =>
          new TRPCError({
            code: 'UNAUTHORIZED',
            message: 'Signature does not match worker address',
          }),
      });

      // F6: gate claiming a private task the same way this router's read paths are
      // gated -- must run after the signature verification above so the caller's
      // identity is already cryptographically verified before we branch on it.
      await assertCanParticipateInPrivateTask(ctx.db, task, input.workerAddress);

      // Minted before the intent is recorded so the id in the payload is the id returned to
      // the caller, whether the completion runs here or from a reconciler pass later.
      const claimId = randomUUID();

      // Free, but still an intent (ADR-0045). Nothing is refundable here; what the intent
      // buys is that a receipt landing after this request has gone still produces the claim
      // row and the claimed task, instead of leaving the chain holding a claim the database
      // has never heard of.
      await runRelayedIntent({
        db: ctx.db,
        idempotencyKey: ctx.idempotencyKey,
        operation: 'claims.claim',
        payer: input.workerAddress,
        payload: {
          claimId,
          contractAddress: task.contractAddress,
          taskId: input.taskId,
          workerAddress: input.workerAddress,
        } satisfies ClaimsClaimIntentPayload,
        send: () =>
          contractClaimTask(
            input.taskId as `0x${string}`,
            input.workerAddress as `0x${string}`,
            0n,
            task.contractAddress
          ),
      });

      return { success: true, claimId };
    }),

  forfeit: publicProcedure
    .meta({
      openapi: {
        method: 'POST',
        path: '/tasks/{taskId}/forfeit',
        tags: ['Tasks'],
        summary: 'Forfeit an expired claim and reopen the task (requester only)',
      },
    })
    .input(
      z.object({
        taskId: z.string().min(1),
        requesterAddress: z.string().min(1),
        signature: z.string().min(1),
      })
    )
    .output(z.object({ txHash: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const taskResult = await ctx.db
        .select()
        .from(tasks)
        .where(eq(tasks.id, input.taskId))
        .limit(1);

      if (taskResult.length === 0) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Task not found' });
      }

      const task = taskResult[0];

      if (task.mode !== 'claim') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Not a Claim task' });
      }

      if (task.status !== 'claimed') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Task is not currently claimed' });
      }

      if (task.requester.toLowerCase() !== input.requesterAddress.toLowerCase()) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Only the task requester can forfeit' });
      }

      const message = buildForfeitMessage(input.taskId);
      await verifySignedAddressOrThrow(message, input.signature, input.requesterAddress, {
        invalid_signature: () =>
          new TRPCError({ code: 'BAD_REQUEST', message: 'Invalid signature' }),
        address_mismatch: () =>
          new TRPCError({
            code: 'UNAUTHORIZED',
            message: 'Signature does not match requester address',
          }),
      });

      // Free, but still an intent: reopening the task and retiring its claim is post-receipt
      // database work, and without a durable record it is lost whenever the receipt outlives
      // the request -- leaving a task the chain has reopened but the database still shows as
      // claimed, unclaimable by anyone (ADR-0045).
      const { txHash } = await runRelayedIntent({
        db: ctx.db,
        idempotencyKey: ctx.idempotencyKey,
        operation: 'claims.forfeit',
        payer: input.requesterAddress,
        payload: {
          contractAddress: task.contractAddress,
          requesterAddress: input.requesterAddress,
          taskId: input.taskId,
        } satisfies ClaimsForfeitIntentPayload,
        send: () =>
          contractForfeitAndReopen(
            input.taskId as `0x${string}`,
            input.requesterAddress as `0x${string}`,
            task.contractAddress
          ),
      });

      return { txHash };
    }),

  getByTask: publicProcedure
    .input(z.object({ taskId: z.string() }))
    .output(ClaimResponseSchema.nullable())
    .query(async ({ input, ctx }) => {
      const result = await ctx.db
        .select()
        .from(claims)
        .where(eq(claims.taskId, input.taskId))
        .limit(1);

      if (result.length === 0) {
        return null;
      }

      const claim = result[0];

      return {
        id: claim.id,
        taskId: claim.taskId,
        workerAddress: claim.workerAddress,
        stakeAmount: claim.stakeAmount,
        stakeTxHash: claim.stakeTxHash,
        claimedAt: claim.claimedAt.toISOString(),
        status: claim.status as any,
      };
    }),
});

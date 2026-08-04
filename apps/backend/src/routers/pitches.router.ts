import { router, publicProcedure, optionalAuthProcedure } from '../trpc';
import {
  buildSelectWorkerMessage,
  PitchCreateSchema,
  PitchResponseSchema,
  PitchSelectSchema,
} from '@taskmarket/shared';
import { z } from 'zod';
import { proposals, tasks, agents } from '../db/schema';
import { eq, and } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { contractSelectWorker, contractSubmitPitch } from '../services/contract';
import { TRPCError } from '@trpc/server';
import { buildPitchHash } from '../lib/canonical-hashes';
import { lowerAddressEq, verifySignedAddressOrThrow } from '../lib/agents';
import { runRelayedIntent } from '../services/relayed-intent-request';
import type {
  PitchesSelectIntentPayload,
  PitchesSubmitIntentPayload,
} from '../services/intents/pitches-intents';
import { fetchPrivateViewabilityContext, resolveTaskViewability } from '../lib/task-visibility';
import type { Context } from '../context';

/**
 * Phase 3 (ADR-0030) parity fix (F3): `submit` must enforce the same private-task
 * standing check as this router's own `listByTask` reader (resolveTaskViewability),
 * instead of letting any signed/paying worker pitch on a `taskVisibility: 'private'`
 * task. Deliberately narrower than the general-purpose `canView` helper: standing here
 * is requester / task.claimedBy / an awarded worker (task_awards) / an allowlisted
 * wallet (task_allowed_viewers) only -- a bare `taskAccessGrant` (the view-only,
 * password-derived bearer credential from `taskAccess.verifyPassword`) is never
 * sufficient, since that credential exists purely for read/view access and was never
 * meant to authorize a write/participation action like submitting a pitch.
 *
 * Must run AFTER the caller's identity is cryptographically resolved (the X402 payer
 * check that payer === input.workerAddress), never before -- checking earlier would
 * let an attacker probe arbitrary candidate addresses and use the
 * FORBIDDEN-vs-payment-error response difference as a private-task membership oracle.
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
    message: 'Not authorized to submit a pitch on this private task',
  });
}

export const pitchesRouter = router({
  submit: publicProcedure
    .meta({
      openapi: {
        method: 'POST',
        path: '/tasks/{taskId}/pitches',
        tags: ['Tasks'],
        summary: 'Submit a pitch for a task',
      },
    })
    .input(PitchCreateSchema)
    .output(z.object({ success: z.boolean(), pitchId: z.string() }))
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

      if (task.mode !== 'pitch') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Not a Pitch task' });
      }

      if (task.status !== 'open') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Task not open for pitches' });
      }

      if (task.pitchDeadline && new Date() > task.pitchDeadline) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Pitch deadline has passed' });
      }

      if (new Date() > task.expiryTime) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Task has expired' });
      }

      const existingPitch = await ctx.db
        .select()
        .from(proposals)
        .where(
          and(eq(proposals.taskId, input.taskId), eq(proposals.workerAddress, input.workerAddress))
        )
        .limit(1);

      if (existingPitch.length > 0) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Worker has already submitted a pitch',
        });
      }

      // X402 payment guard: middleware in app.ts settles the USDC transfer and
      // sets ctx.res.locals.payer to the wallet that paid. We then require that
      // wallet to match input.workerAddress — a worker can't pay to submit a
      // pitch masquerading as someone else. Replaces the previous wallet-signed
      // check (signature is still accepted in the body for shape compat but no
      // longer verified).
      const payer: string | undefined = ctx.res.locals.payer;
      if (!payer) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Payment required: missing payer' });
      }
      if (payer.toLowerCase() !== input.workerAddress.toLowerCase()) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Payer must match workerAddress',
        });
      }

      // F3: gate participation on a private task the same way listByTask gates
      // reads -- must run after the payer check above so the caller's identity is
      // already cryptographically verified before we branch on it.
      await assertCanParticipateInPrivateTask(ctx.db, task, payer);

      const pitchHash = buildPitchHash(
        input.taskId as `0x${string}`,
        input.workerAddress as `0x${string}`,
        input.pitchText
      );

      const pitchId = randomUUID();

      await runRelayedIntent({
        db: ctx.db,
        idempotencyKey: ctx.idempotencyKey,
        operation: 'pitches.submit',
        payer,
        paymentTxHash: ctx.res.locals.paymentTxHash as `0x${string}` | undefined,
        payload: {
          contractAddress: task.contractAddress,
          estimatedDuration: input.estimatedDuration || null,
          pitchHash,
          pitchId,
          pitchText: input.pitchText,
          signature: input.signature,
          taskId: input.taskId,
          workerAddress: input.workerAddress,
        } satisfies PitchesSubmitIntentPayload,
        send: () =>
          contractSubmitPitch(
            input.taskId as `0x${string}`,
            input.workerAddress as `0x${string}`,
            pitchHash,
            task.contractAddress
          ),
      });

      return { success: true, pitchId };
    }),

  listByTask: optionalAuthProcedure
    .meta({
      openapi: {
        method: 'GET',
        path: '/tasks/{taskId}/pitches',
        tags: ['Tasks'],
        summary: 'List pitches for a pitch task',
      },
    })
    .input(z.object({ taskId: z.string() }))
    .output(z.array(PitchResponseSchema))
    .query(async ({ input, ctx }) => {
      // Phase 3 (ADR-0030): a private task the caller can't view returns no pitches,
      // matching this endpoint's pre-existing "unknown taskId returns []" behavior.
      const { viewable } = await resolveTaskViewability(
        ctx.db,
        input.taskId,
        ctx.caller,
        ctx.taskAccessGrant
      );
      if (!viewable) return [];

      const results = await ctx.db
        .select()
        .from(proposals)
        .where(eq(proposals.taskId, input.taskId));

      const pitchesWithStats = await Promise.all(
        results.map(async (pitch) => {
          const agentResult = await ctx.db
            .select()
            .from(agents)
            .where(lowerAddressEq(pitch.workerAddress))
            .limit(1);

          const agent = agentResult[0];

          return {
            id: pitch.id,
            taskId: pitch.taskId,
            workerAddress: pitch.workerAddress,
            pitchText: pitch.proposalText,
            estimatedDuration: pitch.estimatedDuration,
            status: pitch.status as any,
            submittedAt: pitch.submittedAt.toISOString(),
            workerAgentId: agent?.agentId ?? null,
            workerStats: agent
              ? {
                  completedTasks: agent.completedTasks,
                  averageRating:
                    agent.ratedTasks > 0 ? Number(agent.totalStars) / agent.ratedTasks : null,
                }
              : undefined,
          };
        })
      );

      return pitchesWithStats;
    }),

  select: publicProcedure
    .meta({
      openapi: {
        method: 'POST',
        path: '/tasks/{taskId}/pitches/select',
        tags: ['Tasks'],
        summary: 'Select a pitch (requester only)',
      },
    })
    .input(PitchSelectSchema)
    .output(z.object({ success: z.boolean() }))
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

      if (task.mode !== 'pitch') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Not a Pitch task' });
      }

      if (task.status !== 'open') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Task not open' });
      }

      const pitchResult = await ctx.db
        .select()
        .from(proposals)
        .where(and(eq(proposals.id, input.pitchId), eq(proposals.taskId, input.taskId)))
        .limit(1);

      if (pitchResult.length === 0) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Pitch not found for this task' });
      }

      const pitch = pitchResult[0];
      // The selection signature is deterministic (no nonce), so a captured
      // payload could be replayed after a rejected finalization reopens the
      // task; only pitches still awaiting a decision are selectable.
      if (pitch.status !== 'pending') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Pitch is no longer selectable' });
      }

      if (pitch.workerAddress.toLowerCase() !== input.workerAddress.toLowerCase()) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Selected worker does not match the pitch worker',
        });
      }

      const message = buildSelectWorkerMessage(input.taskId, input.pitchId, input.workerAddress);
      await verifySignedAddressOrThrow(message, input.signature, task.requester, {
        invalid_signature: () =>
          new TRPCError({ code: 'BAD_REQUEST', message: 'Invalid selection signature' }),
        address_mismatch: () =>
          new TRPCError({
            code: 'FORBIDDEN',
            message: 'Selection signature must be from the task requester',
          }),
      });

      // X402 payment guard: this action is configured as a paid route
      // (PAID_TASK_ACTION_ROUTES.select_worker in app.ts), but that REST wrapper is
      // a separate entry point from this tRPC procedure -- calling this procedure
      // directly (e.g. via /trpc/pitches.select) bypasses x402Middleware entirely
      // unless the procedure also checks the settled payer itself, the same way
      // every other paid-action procedure in this codebase does (see pitches.submit
      // above, bids.submit, proofs.submit, etc.).
      const payer: string | undefined = ctx.res.locals.payer;
      if (!payer) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Payment required' });
      }

      await runRelayedIntent({
        db: ctx.db,
        idempotencyKey: ctx.idempotencyKey,
        operation: 'pitches.select',
        payer,
        paymentTxHash: ctx.res.locals.paymentTxHash as `0x${string}` | undefined,
        // `requester` is recorded separately from `payer` on purpose: this route accepts
        // payment from anyone and authorises the selection by the requester's signature, so
        // the two addresses genuinely differ and a rebroadcast must relay as the requester.
        payload: {
          contractAddress: task.contractAddress,
          pitchId: input.pitchId,
          requester: task.requester,
          taskId: input.taskId,
          workerAddress: input.workerAddress,
        } satisfies PitchesSelectIntentPayload,
        send: () =>
          contractSelectWorker(
            input.taskId as `0x${string}`,
            task.requester as `0x${string}`,
            input.workerAddress as `0x${string}`,
            task.contractAddress
          ),
      });

      return { success: true };
    }),
});

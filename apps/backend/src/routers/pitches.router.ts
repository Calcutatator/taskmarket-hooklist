import { router, publicProcedure } from '../trpc';
import {
  buildSelectWorkerMessage,
  PitchCreateSchema,
  PitchResponseSchema,
  PitchSelectSchema,
} from '@taskmarket/shared';
import { z } from 'zod';
import { proposals, tasks, agents } from '../db/schema';
import { eq, and, ne } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { contractSelectWorker, contractSubmitPitch } from '../services/contract';
import { TRPCError } from '@trpc/server';
import { buildPitchHash } from '../lib/canonical-hashes';
import { recoverMessageAddress } from 'viem';

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

      const pitchHash = buildPitchHash(
        input.taskId as `0x${string}`,
        input.workerAddress as `0x${string}`,
        input.pitchText
      );

      const pitchId = randomUUID();

      // Anchor on chain before inserting the off-chain row: if the contract call
      // reverts, we don't leave a phantom DB row pointing at no tx hash.
      const submitTxHash = await contractSubmitPitch(
        input.taskId as `0x${string}`,
        input.workerAddress as `0x${string}`,
        pitchHash,
        task.contractAddress
      );

      await ctx.db.insert(proposals).values({
        id: pitchId,
        taskId: input.taskId,
        workerAddress: input.workerAddress,
        proposalText: input.pitchText,
        estimatedDuration: input.estimatedDuration || null,
        signature: input.signature,
        status: 'pending',
        pitchHash,
        submitTxHash,
      });

      return { success: true, pitchId };
    }),

  listByTask: publicProcedure
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
      const results = await ctx.db
        .select()
        .from(proposals)
        .where(eq(proposals.taskId, input.taskId));

      const pitchesWithStats = await Promise.all(
        results.map(async (pitch) => {
          const agentResult = await ctx.db
            .select()
            .from(agents)
            .where(eq(agents.address, pitch.workerAddress))
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
      if (pitch.workerAddress.toLowerCase() !== input.workerAddress.toLowerCase()) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Selected worker does not match the pitch worker',
        });
      }

      const message = buildSelectWorkerMessage(input.taskId, input.pitchId, input.workerAddress);
      let signer: string;
      try {
        signer = await recoverMessageAddress({
          message,
          signature: input.signature as `0x${string}`,
        });
      } catch {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Invalid selection signature' });
      }

      if (task.requester.toLowerCase() !== signer.toLowerCase()) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Selection signature must be from the task requester',
        });
      }

      await contractSelectWorker(
        input.taskId as `0x${string}`,
        task.requester as `0x${string}`,
        input.workerAddress as `0x${string}`,
        task.contractAddress
      );

      await ctx.db
        .update(proposals)
        .set({ status: 'selected' })
        .where(eq(proposals.id, input.pitchId));

      await ctx.db
        .update(proposals)
        .set({ status: 'rejected' })
        .where(and(eq(proposals.taskId, input.taskId), ne(proposals.id, input.pitchId)));

      await ctx.db
        .update(tasks)
        .set({
          status: 'worker_selected',
          worker: input.workerAddress,
        })
        .where(eq(tasks.id, input.taskId));

      return { success: true };
    }),
});

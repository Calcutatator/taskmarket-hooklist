import { router, publicProcedure } from '../trpc';
import { PitchCreateSchema, PitchResponseSchema, PitchSelectSchema } from '@taskmarket/shared';
import { z } from 'zod';
import { proposals, tasks, agents } from '../db/schema';
import { eq, and, ne } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { contractSelectWorker } from '../services/contract';

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
        throw new Error('Task not found');
      }

      const task = taskResult[0];

      if (task.mode !== 'pitch') {
        throw new Error('Not a Pitch task');
      }

      if (task.status !== 'open') {
        throw new Error('Task not open for pitches');
      }

      if (task.pitchDeadline && new Date() > task.pitchDeadline) {
        throw new Error('Pitch deadline has passed');
      }

      const existingPitch = await ctx.db
        .select()
        .from(proposals)
        .where(
          and(eq(proposals.taskId, input.taskId), eq(proposals.workerAddress, input.workerAddress))
        )
        .limit(1);

      if (existingPitch.length > 0) {
        throw new Error('Worker has already submitted a pitch');
      }

      const pitchId = randomUUID();

      await ctx.db.insert(proposals).values({
        id: pitchId,
        taskId: input.taskId,
        workerAddress: input.workerAddress,
        proposalText: input.pitchText,
        estimatedDuration: input.estimatedDuration || null,
        signature: input.signature,
        status: 'pending',
      });

      return { success: true, pitchId };
    }),

  listByTask: publicProcedure
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
      const payer: string = ctx.res.locals.payer;

      const taskResult = await ctx.db
        .select()
        .from(tasks)
        .where(eq(tasks.id, input.taskId))
        .limit(1);

      if (taskResult.length === 0) {
        throw new Error('Task not found');
      }

      const task = taskResult[0];

      if (task.mode !== 'pitch') {
        throw new Error('Not a Pitch task');
      }

      if (task.status !== 'open') {
        throw new Error('Task not open');
      }

      if (payer && task.requester.toLowerCase() !== payer.toLowerCase()) {
        throw new Error('Only the task requester can select a worker');
      }

      await contractSelectWorker(
        input.taskId as `0x${string}`,
        task.requester as `0x${string}`,
        input.workerAddress as `0x${string}`
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

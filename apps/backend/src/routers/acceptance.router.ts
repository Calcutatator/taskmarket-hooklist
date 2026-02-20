import { router, publicProcedure } from '../trpc';
import { z } from 'zod';
import { tasks, agents, platformFees, ratings } from '../db/schema';
import { eq, sql } from 'drizzle-orm';
import { contractAcceptSubmission, contractRateTask } from '../services/contract';

export const acceptanceRouter = router({
  accept: publicProcedure
    .meta({ openapi: { method: 'POST', path: '/tasks/{taskId}/accept', tags: ['Tasks'], summary: 'Accept submission (X402 required)' } })
    .input(
      z.object({
        taskId: z.string(),
        worker: z.string(),
      })
    )
    .output(z.object({ success: z.boolean() }))
    .mutation(async ({ input, ctx }) => {
      const payer: string = ctx.res.locals.payer;
      if (!payer) {
        throw new Error('Payment required: missing payer');
      }

      const taskResult = await ctx.db
        .select()
        .from(tasks)
        .where(eq(tasks.id, input.taskId))
        .limit(1);

      if (taskResult.length === 0) {
        throw new Error('Task not found');
      }

      const task = taskResult[0];

      if (task.requester.toLowerCase() !== payer.toLowerCase()) {
        throw new Error('Only the task requester can accept a submission');
      }

      const txHash = await contractAcceptSubmission(
        input.taskId as `0x${string}`,
        input.worker as `0x${string}`,
      );

      await ctx.db
        .update(tasks)
        .set({
          status: 'accepted',
          worker: input.worker,
        })
        .where(eq(tasks.id, input.taskId));

      const agentResult = await ctx.db
        .select()
        .from(agents)
        .where(eq(agents.address, input.worker))
        .limit(1);

      if (agentResult.length === 0) {
        await ctx.db.insert(agents).values({
          address: input.worker,
          completedTasks: 1,
          totalEarnings: task.reward,
        });
      } else {
        await ctx.db
          .update(agents)
          .set({
            completedTasks: sql`${agents.completedTasks} + 1`,
            totalEarnings: sql`${agents.totalEarnings} + ${task.reward}`,
            updatedAt: new Date(),
          })
          .where(eq(agents.address, input.worker));
      }

      await ctx.db.insert(platformFees).values({
        taskId: input.taskId,
        amount: '0',
        txHash,
      });

      return { success: true };
    }),

  rate: publicProcedure
    .meta({ openapi: { method: 'POST', path: '/tasks/{taskId}/rate', tags: ['Tasks'], summary: 'Rate task (X402 required)' } })
    .input(
      z.object({
        taskId: z.string(),
        worker: z.string(),
        rating: z.number().min(1).max(5),
      })
    )
    .output(z.object({ success: z.boolean() }))
    .mutation(async ({ input, ctx }) => {
      const payer: string = ctx.res.locals.payer;
      if (!payer) {
        throw new Error('Payment required: missing payer');
      }

      const taskResult = await ctx.db
        .select()
        .from(tasks)
        .where(eq(tasks.id, input.taskId))
        .limit(1);

      if (taskResult.length === 0 || taskResult[0].status !== 'accepted') {
        throw new Error('Task not accepted');
      }

      const task = taskResult[0];

      if (task.requester.toLowerCase() !== payer.toLowerCase()) {
        throw new Error('Only the task requester can rate a task');
      }

      const { blockNumber } = await contractRateTask(
        input.taskId as `0x${string}`,
        input.rating,
      );

      await ctx.db
        .update(tasks)
        .set({ rating: input.rating })
        .where(eq(tasks.id, input.taskId));

      await ctx.db.insert(ratings).values({
        taskId: input.taskId,
        workerAddress: input.worker,
        rating: input.rating,
        blockNumber,
      });

      await ctx.db
        .update(agents)
        .set({
          ratedTasks: sql`${agents.ratedTasks} + 1`,
          totalStars: sql`${agents.totalStars} + ${input.rating}`,
          updatedAt: new Date(),
        })
        .where(eq(agents.address, input.worker));

      return { success: true };
    }),
});

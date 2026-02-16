import { router, publicProcedure } from '../trpc';
import { z } from 'zod';
import { tasks, agents, platformFees, ratings } from '../db/schema';
import { eq, sql } from 'drizzle-orm';

export const acceptanceRouter = router({
  accept: publicProcedure
    .input(
      z.object({
        taskId: z.string(),
        worker: z.string(),
        txHash: z.string(),
        workerPayment: z.string(),
        platformFee: z.string(),
      })
    )
    .output(z.object({ success: z.boolean() }))
    .mutation(async ({ input, ctx }) => {
      const taskResult = await ctx.db
        .select()
        .from(tasks)
        .where(eq(tasks.id, input.taskId))
        .limit(1);

      if (taskResult.length === 0) {
        throw new Error('Task not found');
      }

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
          totalEarnings: input.workerPayment,
        });
      } else {
        await ctx.db
          .update(agents)
          .set({
            completedTasks: sql`${agents.completedTasks} + 1`,
            totalEarnings: sql`${agents.totalEarnings} + ${input.workerPayment}`,
            updatedAt: new Date(),
          })
          .where(eq(agents.address, input.worker));
      }

      if (Number(input.platformFee) > 0) {
        await ctx.db.insert(platformFees).values({
          taskId: input.taskId,
          amount: input.platformFee,
          txHash: input.txHash,
        });
      }

      return { success: true };
    }),

  rate: publicProcedure
    .input(
      z.object({
        taskId: z.string(),
        worker: z.string(),
        rating: z.number().min(1).max(5),
        txHash: z.string(),
        blockNumber: z.number(),
      })
    )
    .output(z.object({ success: z.boolean() }))
    .mutation(async ({ input, ctx }) => {
      const taskResult = await ctx.db
        .select()
        .from(tasks)
        .where(eq(tasks.id, input.taskId))
        .limit(1);

      if (taskResult.length === 0 || taskResult[0].status !== 'accepted') {
        throw new Error('Task not accepted');
      }

      await ctx.db
        .update(tasks)
        .set({ rating: input.rating })
        .where(eq(tasks.id, input.taskId));

      await ctx.db.insert(ratings).values({
        taskId: input.taskId,
        workerAddress: input.worker,
        rating: input.rating,
        blockNumber: input.blockNumber,
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

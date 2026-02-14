import { router, publicProcedure } from '../trpc';
import {
  TaskCreateSchema,
  TaskListInputSchema,
  TaskListResponseSchema,
  TaskResponseSchema,
} from '@stakework/shared';
import { z } from 'zod';
import { tasks } from '../db/schema';
import { eq, and, sql, desc } from 'drizzle-orm';

export const tasksRouter = router({
  create: publicProcedure
    .input(
      TaskCreateSchema.extend({
        id: z.string(),
        requester: z.string(),
        requesterPubkey: z.string(),
        escrowTxHash: z.string(),
        expiryTime: z.string(),
      })
    )
    .output(z.object({ success: z.boolean(), taskId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      await ctx.db.insert(tasks).values({
        id: input.id,
        requester: input.requester,
        requesterPubkey: input.requesterPubkey,
        description: input.description,
        reward: input.reward,
        escrowTxHash: input.escrowTxHash,
        expiryTime: new Date(input.expiryTime),
        status: 'open',
        tags: input.tags,
      });

      return { success: true, taskId: input.id };
    }),

  list: publicProcedure
    .input(TaskListInputSchema)
    .output(TaskListResponseSchema)
    .query(async ({ input, ctx }) => {
      const limit = input.limit || 20;

      let query = ctx.db.select().from(tasks);

      if (input.status && input.status !== 'ALL') {
        query = query.where(eq(tasks.status, input.status)) as any;
      }

      if (input.tags && input.tags.length > 0) {
        query = query.where(sql`${tasks.tags} && ${input.tags}`) as any;
      }

      if (input.minReward) {
        query = query.where(sql`${tasks.reward} >= ${input.minReward}`) as any;
      }

      query = query.orderBy(desc(tasks.createdAt)).limit(limit + 1) as any;

      const results = await query;
      const hasMore = results.length > limit;
      const tasksList = hasMore ? results.slice(0, limit) : results;

      return {
        tasks: tasksList.map((task) => ({
          id: task.id,
          requester: task.requester,
          requesterPubkey: task.requesterPubkey,
          description: task.description,
          reward: task.reward,
          escrowTxHash: task.escrowTxHash,
          createdAt: task.createdAt.toISOString(),
          expiryTime: task.expiryTime.toISOString(),
          status: task.status as any,
          tags: task.tags,
          worker: task.worker,
          rating: task.rating,
        })),
        nextCursor: hasMore ? tasksList[tasksList.length - 1].id : null,
        hasMore,
      };
    }),

  get: publicProcedure
    .input(z.object({ taskId: z.string() }))
    .output(TaskResponseSchema.nullable())
    .query(async ({ input, ctx }) => {
      const result = await ctx.db
        .select()
        .from(tasks)
        .where(eq(tasks.id, input.taskId))
        .limit(1);

      if (result.length === 0) {
        return null;
      }

      const task = result[0];
      return {
        id: task.id,
        requester: task.requester,
        requesterPubkey: task.requesterPubkey,
        description: task.description,
        reward: task.reward,
        escrowTxHash: task.escrowTxHash,
        createdAt: task.createdAt.toISOString(),
        expiryTime: task.expiryTime.toISOString(),
        status: task.status as any,
        tags: task.tags,
        worker: task.worker,
        rating: task.rating,
      };
    }),
});

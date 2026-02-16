import { router, publicProcedure } from '../trpc';
import {
  TaskCreateSchema,
  TaskListInputSchema,
  TaskListResponseSchema,
  TaskResponseSchema,
} from '@clawtasker/shared';
import { z } from 'zod';
import { tasks, submissions, proposals } from '../db/schema';
import { eq, sql, desc, and } from 'drizzle-orm';

export const tasksRouter = router({
  create: publicProcedure
    .input(
      TaskCreateSchema.extend({
        id: z.string(),
        requester: z.string(),
        requesterPubkey: z.string(),
        escrowTxHash: z.string(),
        expiryTime: z.string(),
        proposalDeadline: z.string().optional(),
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
        mode: input.mode || 'contest',
        stakeRequired: input.stakeRequired ? 1 : 0,
        stakeBps: input.stakeBps || 0,
        proposalDeadline: input.proposalDeadline ? new Date(input.proposalDeadline) : null,
        metricDescription: input.metricDescription || null,
        metricTarget: input.metricTarget || null,
      });

      return { success: true, taskId: input.id };
    }),

  list: publicProcedure
    .input(TaskListInputSchema)
    .output(TaskListResponseSchema)
    .query(async ({ input, ctx }) => {
      const limit = input.limit || 20;

      let conditions = [];
      if (input.status && input.status !== 'ALL') {
        conditions.push(eq(tasks.status, input.status));
      }
      if (input.mode && input.mode !== 'ALL') {
        conditions.push(eq(tasks.mode, input.mode));
      }
      if (input.tags && input.tags.length > 0) {
        conditions.push(sql`${tasks.tags} && ${input.tags}`);
      }
      if (input.minReward) {
        conditions.push(sql`${tasks.reward} >= ${input.minReward}`);
      }

      let query = ctx.db.select().from(tasks);
      if (conditions.length > 0) {
        query = query.where(and(...conditions)) as any;
      }
      query = query.orderBy(desc(tasks.createdAt)).limit(limit + 1) as any;

      const results = await query;
      const hasMore = results.length > limit;
      const tasksList = hasMore ? results.slice(0, limit) : results;

      const tasksWithCounts = await Promise.all(
        tasksList.map(async (task) => {
          const submissionCount = await ctx.db
            .select({ count: sql<number>`count(*)` })
            .from(submissions)
            .where(eq(submissions.taskId, task.id));

          const proposalCount = await ctx.db
            .select({ count: sql<number>`count(*)` })
            .from(proposals)
            .where(eq(proposals.taskId, task.id));

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
            mode: task.mode as any,
            stakeRequired: task.stakeRequired === 1,
            stakeBps: task.stakeBps,
            proposalDeadline: task.proposalDeadline?.toISOString() || null,
            metricDescription: task.metricDescription,
            metricTarget: task.metricTarget,
            claimedBy: task.claimedBy,
            claimedAt: task.claimedAt?.toISOString() || null,
            platformFeeBps: task.platformFeeBps,
            submissionCount: Number(submissionCount[0]?.count || 0),
            proposalCount: Number(proposalCount[0]?.count || 0),
          };
        })
      );

      return {
        tasks: tasksWithCounts,
        nextCursor: hasMore ? tasksList[tasksList.length - 1].id : null,
        hasMore,
      };
    }),

  get: publicProcedure
    .input(z.object({ taskId: z.string() }))
    .output(TaskResponseSchema.nullable())
    .query(async ({ input, ctx }) => {
      const result = await ctx.db.select().from(tasks).where(eq(tasks.id, input.taskId)).limit(1);

      if (result.length === 0) {
        return null;
      }

      const task = result[0];

      const submissionCount = await ctx.db
        .select({ count: sql<number>`count(*)` })
        .from(submissions)
        .where(eq(submissions.taskId, task.id));

      const proposalCount = await ctx.db
        .select({ count: sql<number>`count(*)` })
        .from(proposals)
        .where(eq(proposals.taskId, task.id));

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
        mode: task.mode as any,
        stakeRequired: task.stakeRequired === 1,
        stakeBps: task.stakeBps,
        proposalDeadline: task.proposalDeadline?.toISOString() || null,
        metricDescription: task.metricDescription,
        metricTarget: task.metricTarget,
        claimedBy: task.claimedBy,
        claimedAt: task.claimedAt?.toISOString() || null,
        platformFeeBps: task.platformFeeBps,
        submissionCount: Number(submissionCount[0]?.count || 0),
        proposalCount: Number(proposalCount[0]?.count || 0),
      };
    }),
});

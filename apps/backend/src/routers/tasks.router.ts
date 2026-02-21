import { router, publicProcedure } from '../trpc';
import {
  TaskCreateSchema,
  TaskListInputSchema,
  TaskListResponseSchema,
  TaskResponseSchema,
} from '@taskmarket/shared';
import { z } from 'zod';
import { tasks, submissions, proposals, agents } from '../db/schema';
import { eq, sql, desc, and } from 'drizzle-orm';
import { randomBytes } from 'crypto';
import { contractCreateTask, MODE_MAP } from '../services/contract';
import { getServerConfig } from '../config/env';

export const tasksRouter = router({
  create: publicProcedure
    .meta({
      openapi: {
        method: 'POST',
        path: '/tasks',
        tags: ['Tasks'],
        summary: 'Create task (X402 required)',
      },
    })
    .input(TaskCreateSchema)
    .output(z.object({ success: z.boolean(), taskId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const payer: string = ctx.res.locals.payer;
      if (!payer) {
        throw new Error('Payment required: missing payer');
      }

      const config = getServerConfig();
      const taskId = `0x${randomBytes(32).toString('hex')}` as `0x${string}`;
      const reward = BigInt(input.reward);
      const durationSecs = BigInt(input.duration * 3600);
      const mode = MODE_MAP[input.mode ?? 'contest'] ?? 0;

      const proposalDeadlineSecs =
        input.mode === 'proposal'
          ? input.proposalDeadline
            ? BigInt(input.proposalDeadline)
            : durationSecs
          : 0n;
      const escrowTxHash = await contractCreateTask(
        taskId,
        payer as `0x${string}`,
        reward,
        durationSecs,
        mode,
        proposalDeadlineSecs
      );

      const expiryTime = new Date(Date.now() + input.duration * 3600 * 1000);

      const requesterAgent = await ctx.db
        .select({ agentId: agents.agentId })
        .from(agents)
        .where(eq(agents.address, payer))
        .limit(1);

      await ctx.db.insert(tasks).values({
        id: taskId,
        requester: payer,
        requesterPubkey: payer,
        description: input.description,
        reward: input.reward,
        escrowTxHash,
        expiryTime,
        status: 'open',
        tags: input.tags,
        mode: input.mode ?? 'contest',
        stakeRequired: input.stakeRequired ? 1 : 0,
        stakeBps: input.stakeBps ?? 0,
        proposalDeadline: input.proposalDeadline
          ? new Date(Date.now() + input.proposalDeadline * 1000)
          : null,
        metricDescription: input.metricDescription ?? null,
        metricTarget: input.metricTarget ?? null,
        platformFeeBps: config.DEFAULT_PLATFORM_FEE_BPS,
        requesterAgentId: requesterAgent[0]?.agentId ?? null,
      });

      return { success: true, taskId };
    }),

  list: publicProcedure
    .meta({ openapi: { method: 'GET', path: '/tasks', tags: ['Tasks'], summary: 'List tasks' } })
    .input(TaskListInputSchema)
    .output(TaskListResponseSchema)
    .query(async ({ input, ctx }) => {
      const limit = input.limit || 20;

      const conditions = [];
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
    .meta({
      openapi: {
        method: 'GET',
        path: '/tasks/{taskId}',
        tags: ['Tasks'],
        summary: 'Get task by ID',
      },
    })
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

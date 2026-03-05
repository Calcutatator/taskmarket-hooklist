import { router, publicProcedure } from '../trpc';
import {
  AgentStatsSchema,
  LeaderboardResponseSchema,
  LeaderboardInputSchema,
  TaskInboxInputSchema,
  TaskInboxResponseSchema,
} from '@taskmarket/shared';
import { z } from 'zod';
import { agents, feedbacks, tasks, submissions, proposals } from '../db/schema';
import { eq, desc, sql, and, or, ilike, gte } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';

export const agentsRouter = router({
  stats: publicProcedure
    .meta({
      openapi: {
        method: 'GET',
        path: '/agents/stats',
        tags: ['Agents'],
        summary: 'Get agent stats by address or agentId',
      },
    })
    .input(
      z.object({
        address: z.string().optional(),
        agentId: z.string().optional(),
      })
    )
    .output(AgentStatsSchema)
    .query(async ({ input, ctx }) => {
      if (!input.address && !input.agentId) {
        throw new Error('Provide address or agentId');
      }

      const agentResult = input.agentId
        ? await ctx.db.select().from(agents).where(eq(agents.agentId, input.agentId)).limit(1)
        : await ctx.db.select().from(agents).where(eq(agents.address, input.address!)).limit(1);

      if (agentResult.length === 0) {
        const addr = input.address ?? '';
        return {
          address: addr,
          agentId: null,
          completedTasks: 0,
          ratedTasks: 0,
          totalStars: 0,
          averageRating: 0,
          totalEarnings: '0',
          skills: [],
          recentRatings: [],
        };
      }

      const agent = agentResult[0];

      const recentRatings = await ctx.db
        .select({
          taskId: feedbacks.taskId,
          rating: feedbacks.rating,
          createdAt: feedbacks.createdAt,
        })
        .from(feedbacks)
        .where(eq(feedbacks.workerAddress, agent.address))
        .orderBy(desc(feedbacks.createdAt))
        .limit(10);

      const averageRating = agent.ratedTasks > 0 ? agent.totalStars / agent.ratedTasks : 0;

      return {
        address: agent.address,
        agentId: agent.agentId ?? null,
        completedTasks: agent.completedTasks,
        ratedTasks: agent.ratedTasks,
        totalStars: agent.totalStars,
        averageRating: Number(averageRating.toFixed(1)),
        totalEarnings: agent.totalEarnings,
        skills: agent.skills ?? [],
        emailAddress: agent.emailAddress ?? null,
        recentRatings: recentRatings.map((r) => ({
          taskId: r.taskId,
          rating: r.rating,
          createdAt: r.createdAt.toISOString(),
        })),
      };
    }),

  inbox: publicProcedure
    .meta({
      openapi: {
        method: 'GET',
        path: '/agents/inbox',
        tags: ['Agents'],
        summary: 'Get tasks created and worked on by address',
      },
    })
    .input(TaskInboxInputSchema)
    .output(TaskInboxResponseSchema)
    .query(async ({ input, ctx }) => {
      const { address } = input;

      const mapTask = async (task: typeof tasks.$inferSelect) => {
        const submissionCount = await ctx.db
          .select({ count: sql<number>`count(*)` })
          .from(submissions)
          .where(eq(submissions.taskId, task.id));

        const pitchCount = await ctx.db
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
          pitchDeadline: task.pitchDeadline?.toISOString() || null,
          bidDeadline: task.bidDeadline?.toISOString() || null,
          maxPrice: task.maxPrice ?? null,
          metricDescription: task.metricDescription,
          metricTarget: task.metricTarget,
          claimedBy: task.claimedBy,
          claimedAt: task.claimedAt?.toISOString() || null,
          platformFeeBps: task.platformFeeBps,
          submissionCount: Number(submissionCount[0]?.count || 0),
          pitchCount: Number(pitchCount[0]?.count || 0),
        };
      };

      const requesterRows = await ctx.db
        .select()
        .from(tasks)
        .where(eq(tasks.requester, address))
        .orderBy(desc(tasks.createdAt))
        .limit(50);

      const workerRows = await ctx.db
        .select()
        .from(tasks)
        .where(or(eq(tasks.worker, address), eq(tasks.claimedBy, address)))
        .orderBy(desc(tasks.createdAt))
        .limit(50);

      const [asRequester, asWorker] = await Promise.all([
        Promise.all(requesterRows.map(mapTask)),
        Promise.all(workerRows.map(mapTask)),
      ]);

      return { asRequester, asWorker };
    }),

  count: publicProcedure
    .meta({
      openapi: {
        method: 'GET',
        path: '/agents/count',
        tags: ['Agents'],
        summary: 'Get total number of registered agents',
      },
    })
    .input(z.object({}))
    .output(z.object({ count: z.number(), totalEarnings: z.string() }))
    .query(async ({ ctx }) => {
      const result = await ctx.db
        .select({
          count: sql<number>`count(*)::int`,
          totalEarnings: sql<string>`coalesce(sum(${agents.totalEarnings}::numeric), 0)::text`,
        })
        .from(agents);
      return {
        count: result[0]?.count ?? 0,
        totalEarnings: result[0]?.totalEarnings ?? '0',
      };
    }),

  leaderboard: publicProcedure
    .meta({
      openapi: {
        method: 'GET',
        path: '/agents/leaderboard',
        tags: ['Agents'],
        summary:
          'List agents sorted by reputation or task count, with optional skill/search filter',
      },
    })
    .input(LeaderboardInputSchema)
    .output(LeaderboardResponseSchema)
    .query(async ({ input, ctx }) => {
      const avgRatingExpr = sql<number>`CASE WHEN ${agents.ratedTasks} > 0 THEN ${agents.totalStars}::float / ${agents.ratedTasks} ELSE 0 END`;

      const filters: SQL[] = [];

      if (input.skill) {
        // Safe parameterized: value passed as bind parameter, not raw SQL
        filters.push(sql`${input.skill} = ANY(${agents.skills})`);
      }

      if (input.search) {
        filters.push(
          or(ilike(agents.agentId, `%${input.search}%`), ilike(agents.address, `${input.search}%`))!
        );
      }

      if (input.minRating) {
        filters.push(sql`${avgRatingExpr} >= ${input.minRating}`);
      }

      if (input.minTasks) {
        filters.push(gte(agents.completedTasks, input.minTasks));
      }

      const whereClause =
        filters.length === 0 ? undefined : filters.length === 1 ? filters[0] : and(...filters)!;

      const orderBy =
        input.sort === 'tasks'
          ? [desc(agents.completedTasks), desc(avgRatingExpr)]
          : [desc(avgRatingExpr), desc(agents.completedTasks)];

      const results = await ctx.db
        .select({
          address: agents.address,
          agentId: agents.agentId,
          completedTasks: agents.completedTasks,
          ratedTasks: agents.ratedTasks,
          totalStars: agents.totalStars,
          totalEarnings: agents.totalEarnings,
          skills: agents.skills,
          averageRating: avgRatingExpr,
        })
        .from(agents)
        .where(whereClause)
        .orderBy(...orderBy)
        .limit(input.limit)
        .offset(input.offset);

      return results.map((row, index) => ({
        rank: input.offset + index + 1,
        address: row.address,
        agentId: row.agentId ?? null,
        completedTasks: row.completedTasks,
        averageRating: Number(row.averageRating.toFixed(1)),
        totalEarnings: row.totalEarnings ?? '0',
        skills: row.skills ?? [],
      }));
    }),
});

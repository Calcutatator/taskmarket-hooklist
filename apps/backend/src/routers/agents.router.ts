import { router, publicProcedure } from '../trpc';
import {
  AgentStatsSchema,
  LeaderboardResponseSchema,
  LeaderboardInputSchema,
} from '@taskmarket/shared';
import { z } from 'zod';
import { agents, feedbacks } from '../db/schema';
import { eq, desc, sql, and, or, ilike } from 'drizzle-orm';
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
        recentRatings: recentRatings.map((r) => ({
          taskId: r.taskId,
          rating: r.rating,
          createdAt: r.createdAt.toISOString(),
        })),
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

      const filters: SQL[] = [sql`${agents.completedTasks} >= 1`];

      if (input.skill) {
        // Safe parameterized: value passed as bind parameter, not raw SQL
        filters.push(sql`${input.skill} = ANY(${agents.skills})`);
      }

      if (input.search) {
        filters.push(
          or(ilike(agents.agentId, `%${input.search}%`), ilike(agents.address, `${input.search}%`))!
        );
      }

      const whereClause = filters.length === 1 ? filters[0] : and(...filters)!;

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
        .limit(input.limit);

      return results.map((row, index) => ({
        rank: index + 1,
        address: row.address,
        agentId: row.agentId ?? null,
        completedTasks: row.completedTasks,
        averageRating: Number(row.averageRating.toFixed(1)),
        totalEarnings: row.totalEarnings ?? '0',
        skills: row.skills ?? [],
      }));
    }),
});

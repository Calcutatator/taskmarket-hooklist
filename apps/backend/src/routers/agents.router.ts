import { router, publicProcedure } from '../trpc';
import { AgentStatsSchema, LeaderboardResponseSchema } from '@stakework/shared';
import { z } from 'zod';
import { agents, ratings } from '../db/schema';
import { eq, desc, sql } from 'drizzle-orm';

export const agentsRouter = router({
  stats: publicProcedure
    .input(z.object({ address: z.string() }))
    .output(AgentStatsSchema)
    .query(async ({ input, ctx }) => {
      const agentResult = await ctx.db
        .select()
        .from(agents)
        .where(eq(agents.address, input.address))
        .limit(1);

      if (agentResult.length === 0) {
        return {
          address: input.address,
          completedTasks: 0,
          ratedTasks: 0,
          totalStars: 0,
          averageRating: 0,
          totalEarnings: '0',
          recentRatings: [],
        };
      }

      const agent = agentResult[0];

      const recentRatings = await ctx.db
        .select()
        .from(ratings)
        .where(eq(ratings.workerAddress, input.address))
        .orderBy(desc(ratings.createdAt))
        .limit(10);

      const averageRating =
        agent.ratedTasks > 0 ? agent.totalStars / agent.ratedTasks : 0;

      return {
        address: agent.address,
        completedTasks: agent.completedTasks,
        ratedTasks: agent.ratedTasks,
        totalStars: agent.totalStars,
        averageRating: Number(averageRating.toFixed(1)),
        totalEarnings: agent.totalEarnings,
        recentRatings: recentRatings.map((r) => ({
          taskId: r.taskId,
          rating: r.rating,
          createdAt: r.createdAt.toISOString(),
        })),
      };
    }),

  leaderboard: publicProcedure
    .input(z.object({ limit: z.number().optional().default(20) }))
    .output(LeaderboardResponseSchema)
    .query(async ({ input, ctx }) => {
      const results = await ctx.db
        .select({
          address: agents.address,
          completedTasks: agents.completedTasks,
          ratedTasks: agents.ratedTasks,
          totalStars: agents.totalStars,
          averageRating: sql<number>`CASE WHEN ${agents.ratedTasks} > 0 THEN ${agents.totalStars}::float / ${agents.ratedTasks} ELSE 0 END`,
        })
        .from(agents)
        .where(sql`${agents.ratedTasks} >= 5`)
        .orderBy(desc(sql`CASE WHEN ${agents.ratedTasks} > 0 THEN ${agents.totalStars}::float / ${agents.ratedTasks} ELSE 0 END`), desc(agents.completedTasks))
        .limit(input.limit);

      return results.map((row, index) => ({
        rank: index + 1,
        address: row.address,
        completedTasks: row.completedTasks,
        averageRating: Number(row.averageRating.toFixed(1)),
      }));
    }),
});

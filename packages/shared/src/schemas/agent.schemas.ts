import { z } from 'zod';

export const AgentStatsSchema = z.object({
  address: z.string(),
  completedTasks: z.number(),
  ratedTasks: z.number(),
  totalStars: z.number(),
  averageRating: z.number(),
  totalEarnings: z.string(),
  recentRatings: z
    .array(
      z.object({
        taskId: z.string(),
        rating: z.number(),
        createdAt: z.string(),
      })
    )
    .optional(),
});

export const LeaderboardEntrySchema = z.object({
  rank: z.number(),
  address: z.string(),
  completedTasks: z.number(),
  averageRating: z.number(),
  totalEarnings: z.string(),
});

export const LeaderboardResponseSchema = z.array(LeaderboardEntrySchema);

export type AgentStats = z.infer<typeof AgentStatsSchema>;
export type LeaderboardEntry = z.infer<typeof LeaderboardEntrySchema>;
export type LeaderboardResponse = z.infer<typeof LeaderboardResponseSchema>;

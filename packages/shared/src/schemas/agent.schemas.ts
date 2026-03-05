import { z } from 'zod';

export const AgentStatsSchema = z.object({
  address: z.string(),
  agentId: z.string().nullable().optional(),
  completedTasks: z.number(),
  ratedTasks: z.number(),
  totalStars: z.number(),
  averageRating: z.number(),
  totalEarnings: z.string(),
  skills: z.array(z.string()).optional(),
  emailAddress: z.string().nullable().optional(),
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

export const LeaderboardInputSchema = z.object({
  limit: z.number().optional().default(20),
  offset: z.number().optional().default(0),
  sort: z.enum(['reputation', 'tasks']).optional().default('reputation'),
  skill: z.string().optional(),
  search: z.string().optional(),
  minRating: z.number().min(0).max(5).optional(),
  minTasks: z.number().int().min(0).optional(),
});

export const LeaderboardEntrySchema = z.object({
  rank: z.number(),
  address: z.string(),
  agentId: z.string().nullable(),
  completedTasks: z.number(),
  averageRating: z.number(),
  totalEarnings: z.string(),
  skills: z.array(z.string()),
  emailAddress: z.string().nullable().optional(),
});

export const LeaderboardResponseSchema = z.array(LeaderboardEntrySchema);

export type AgentStats = z.infer<typeof AgentStatsSchema>;
export type LeaderboardInput = z.infer<typeof LeaderboardInputSchema>;
export type LeaderboardEntry = z.infer<typeof LeaderboardEntrySchema>;
export type LeaderboardResponse = z.infer<typeof LeaderboardResponseSchema>;

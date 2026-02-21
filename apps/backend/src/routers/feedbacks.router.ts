import { router, publicProcedure } from '../trpc';
import { z } from 'zod';
import { feedbacks } from '../db/schema';
import { eq } from 'drizzle-orm';

export const feedbacksRouter = router({
  list: publicProcedure
    .meta({
      openapi: {
        method: 'GET',
        path: '/tasks/{taskId}/feedbacks',
        tags: ['Tasks'],
        summary: 'List feedbacks for a task',
      },
    })
    .input(z.object({ taskId: z.string() }))
    .output(
      z.object({
        feedbacks: z.array(
          z.object({
            id: z.string(),
            taskId: z.string(),
            workerAddress: z.string(),
            workerAgentId: z.string().nullable(),
            requesterAddress: z.string(),
            requesterAgentId: z.string().nullable(),
            rating: z.number(),
            feedbackText: z.string().nullable(),
            ratingTxHash: z.string().nullable(),
            createdAt: z.string(),
          })
        ),
      })
    )
    .query(async ({ input, ctx }) => {
      const rows = await ctx.db
        .select({
          id: feedbacks.id,
          taskId: feedbacks.taskId,
          workerAddress: feedbacks.workerAddress,
          workerAgentId: feedbacks.workerAgentId,
          requesterAddress: feedbacks.requesterAddress,
          requesterAgentId: feedbacks.requesterAgentId,
          rating: feedbacks.rating,
          feedbackText: feedbacks.feedbackText,
          ratingTxHash: feedbacks.ratingTxHash,
          createdAt: feedbacks.createdAt,
        })
        .from(feedbacks)
        .where(eq(feedbacks.taskId, input.taskId));

      return {
        feedbacks: rows.map((r) => ({
          ...r,
          createdAt: r.createdAt.toISOString(),
        })),
      };
    }),
});

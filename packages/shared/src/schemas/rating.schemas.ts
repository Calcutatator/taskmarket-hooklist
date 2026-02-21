import { z } from 'zod';

export const RatingInputSchema = z.object({
  taskId: z.string(),
  worker: z.string(),
  rating: z.number().int().min(0).max(100),
  feedbackText: z.string().max(500).optional(),
});

export const FeedbackSchema = z.object({
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
});

export type RatingInput = z.infer<typeof RatingInputSchema>;
export type Feedback = z.infer<typeof FeedbackSchema>;

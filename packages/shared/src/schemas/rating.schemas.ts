import { z } from 'zod';

export const RatingSchema = z.object({
  id: z.number(),
  taskId: z.string(),
  workerAddress: z.string(),
  rating: z.number().min(1).max(5),
  blockNumber: z.number(),
  createdAt: z.string(),
});

export type Rating = z.infer<typeof RatingSchema>;

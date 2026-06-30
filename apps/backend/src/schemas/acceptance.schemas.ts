import { z } from 'zod';

export const AcceptInputSchema = z.object({
  taskId: z.string(),
  worker: z.string(),
});

export const AcceptSubmissionsInputSchema = z
  .object({
    taskId: z.string(),
    winners: z
      .array(
        z.object({
          worker: z.string(),
          share: z.number().int().min(1).max(10000),
        })
      )
      .min(1, 'At least one winner required'),
  })
  .refine((data) => data.winners.reduce((acc, w) => acc + w.share, 0) === 10000, {
    message: 'Winner shares must sum to 10000 basis points',
  });

export const RateInputSchema = z.object({
  taskId: z.string(),
  worker: z.string(),
  rating: z.number().int().min(0).max(100),
  feedbackText: z.string().max(500).optional(),
});

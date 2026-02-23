import { z } from 'zod';

export const SubmissionCreateSchema = z.object({
  taskId: z.string(),
  workerAddress: z.string(),
  file: z.string().min(1, 'File is required'),
  signature: z.string(),
});

export const SubmissionResponseSchema = z.object({
  id: z.string(),
  taskId: z.string(),
  workerAddress: z.string(),
  fileUrl: z.string(),
  signature: z.string(),
  submittedAt: z.string(),
  workerAgentId: z.string().nullable().optional(),
  workerStats: z
    .object({
      completedTasks: z.number(),
      ratedTasks: z.number(),
      totalStars: z.number(),
      averageRating: z.number(),
    })
    .nullable()
    .optional(),
});

export const DownloadRequestSchema = z.object({
  acceptanceTxHash: z.string(),
});

export const DownloadResponseSchema = z.object({
  fileUrl: z.string(),
  keyBundle: z.string().nullable().optional(),
  expiresAt: z.string(),
});

export type SubmissionCreate = z.infer<typeof SubmissionCreateSchema>;
export type SubmissionResponse = z.infer<typeof SubmissionResponseSchema>;
export type DownloadRequest = z.infer<typeof DownloadRequestSchema>;
export type DownloadResponse = z.infer<typeof DownloadResponseSchema>;

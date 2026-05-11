import { z } from 'zod';

export const ArtifactRole = z.enum(['preview', 'source', 'final', 'attachment']);

export const ArtifactMediaKind = z.enum([
  'image',
  'video',
  'audio',
  'pdf',
  'text',
  'archive',
  'unknown',
]);

export const ArtifactCreateSchema = z.object({
  fileName: z.string().min(1, 'File name is required').max(255, 'File name is too long'),
  mimeType: z.string().min(1, 'MIME type is required').max(120, 'MIME type is too long'),
  role: ArtifactRole.optional().default('attachment'),
  file: z.string().min(1, 'File is required'),
});

export const ArtifactResponseSchema = z.object({
  id: z.string(),
  taskId: z.string(),
  submissionId: z.string(),
  role: ArtifactRole,
  fileName: z.string(),
  mimeType: z.string(),
  mediaKind: ArtifactMediaKind,
  storageUri: z.string(),
  sizeBytes: z.number(),
  sha256Hash: z.string(),
  keccak256Hash: z.string(),
  displayOrder: z.number(),
  textPreview: z.string().optional(),
});

export const SubmissionCreateSchema = z.object({
  taskId: z.string(),
  workerAddress: z.string(),
  artifacts: z.array(ArtifactCreateSchema).min(1).max(20),
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
  deliverableHash: z.string().nullable().optional(),
  submitTxHash: z.string().nullable().optional(),
  artifacts: z.array(ArtifactResponseSchema).optional().default([]),
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
  artifactId: z.string().optional(),
});

export const DownloadResponseSchema = z.object({
  fileUrl: z.string(),
  keyBundle: z.string().nullable().optional(),
  expiresAt: z.string(),
});

export type ArtifactCreate = z.infer<typeof ArtifactCreateSchema>;
export type ArtifactResponse = z.infer<typeof ArtifactResponseSchema>;
export type ArtifactRoleValue = z.infer<typeof ArtifactRole>;
export type ArtifactMediaKindValue = z.infer<typeof ArtifactMediaKind>;
export type SubmissionCreate = z.infer<typeof SubmissionCreateSchema>;
export type SubmissionResponse = z.infer<typeof SubmissionResponseSchema>;
export type DownloadRequest = z.infer<typeof DownloadRequestSchema>;
export type DownloadResponse = z.infer<typeof DownloadResponseSchema>;

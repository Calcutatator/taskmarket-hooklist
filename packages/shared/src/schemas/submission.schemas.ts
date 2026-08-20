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
  workerAddress: z.string(),
  workerAgentId: z.string().nullable(),
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
  previewUrl: z.string().optional(),
  previewExpiresAt: z.string().optional(),
});

export const SubmissionCreateSchema = z.object({
  taskId: z.string(),
  workerAddress: z.string(),
  artifacts: z.array(ArtifactCreateSchema).min(1).max(20),
  signature: z.string(),
});

export const SubmissionResponseSchema = z.object({
  id: z.string(),
  // The submission's public name (ADR-0098), e.g. 'SUB-7K2QA9XF'. This is what the UI shows and
  // what search accepts; `id` stays the primary key and the idempotency key.
  referenceCode: z.string().nullable().optional(),
  taskId: z.string(),
  workerAddress: z.string(),
  fileUrl: z.string(),
  signature: z.string(),
  submittedAt: z.string(),
  rejectedAt: z.string().nullable().optional(),
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

// A single accepted/completed task for a worker, with its artifacts. Acceptance
// is derived from the feedbacks table (which marks completed/rated tasks).
export const AgentWorkItemSchema = z.object({
  taskId: z.string(),
  taskTitle: z.string(),
  completedAt: z.string(),
  artifacts: z.array(ArtifactResponseSchema),
});

export const AgentWorkResponseSchema = z.array(AgentWorkItemSchema);

export const DownloadRequestSchema = z.object({
  acceptanceTxHash: z.string(),
  artifactId: z.string().optional(),
});

export const DownloadResponseSchema = z.object({
  fileUrl: z.string(),
  keyBundle: z.string().nullable().optional(),
  expiresAt: z.string(),
});

// Presigned upload schemas — used by the web form and CLI for direct-to-S3 uploads

const MAX_ARTIFACT_BYTES = 500 * 1024 * 1024;

export const RequestUploadUrlInputSchema = z.object({
  taskId: z.string(),
  workerAddress: z.string(),
  signature: z.string(),
  fileName: z.string().min(1, 'File name is required').max(255, 'File name is too long'),
  mimeType: z.string().min(1, 'MIME type is required').max(120, 'MIME type is too long'),
  role: ArtifactRole.optional().default('attachment'),
  sizeBytes: z
    .number()
    .int()
    .positive('Size must be positive')
    .max(MAX_ARTIFACT_BYTES, 'File must not exceed 500 MB'),
});

export const RequestUploadUrlOutputSchema = z.object({
  uploadUrl: z.string(),
  artifactKey: z.string(),
});

export const ArtifactKeyInputSchema = z.object({
  artifactKey: z.string().min(1, 'Artifact key is required'),
  fileName: z.string().min(1, 'File name is required').max(255, 'File name is too long'),
  mimeType: z.string().min(1, 'MIME type is required').max(120, 'MIME type is too long'),
  role: ArtifactRole.optional().default('attachment'),
  sizeBytes: z
    .number()
    .int()
    .positive('Size must be positive')
    .max(MAX_ARTIFACT_BYTES, 'File must not exceed 500 MB'),
  sha256Hash: z.string().regex(/^[0-9a-f]{64}$/, 'sha256Hash must be 64 lowercase hex chars'),
  keccak256Hash: z
    .string()
    .regex(/^0x[0-9a-fA-F]{64}$/, 'keccak256Hash must be 0x followed by 64 hex chars'),
});

export const SubmissionCreateFromKeysSchema = z.object({
  taskId: z.string(),
  workerAddress: z.string(),
  artifacts: z.array(ArtifactKeyInputSchema).min(1).max(20),
  signature: z.string(),
});

export type ArtifactCreate = z.infer<typeof ArtifactCreateSchema>;
export type ArtifactResponse = z.infer<typeof ArtifactResponseSchema>;
export type ArtifactRoleValue = z.infer<typeof ArtifactRole>;
export type ArtifactMediaKindValue = z.infer<typeof ArtifactMediaKind>;
export type SubmissionCreate = z.infer<typeof SubmissionCreateSchema>;
export type SubmissionResponse = z.infer<typeof SubmissionResponseSchema>;
export type AgentWorkItem = z.infer<typeof AgentWorkItemSchema>;
export type AgentWorkResponse = z.infer<typeof AgentWorkResponseSchema>;
export type DownloadRequest = z.infer<typeof DownloadRequestSchema>;
export type DownloadResponse = z.infer<typeof DownloadResponseSchema>;
export type RequestUploadUrlInput = z.infer<typeof RequestUploadUrlInputSchema>;
export type RequestUploadUrlOutput = z.infer<typeof RequestUploadUrlOutputSchema>;
export type ArtifactKeyInput = z.infer<typeof ArtifactKeyInputSchema>;
export type SubmissionCreateFromKeys = z.infer<typeof SubmissionCreateFromKeysSchema>;

import { z } from 'zod';

// Phase 3 (ADR-0030): schemas for the taskAccess router -- password verification and
// wallet-allowlist management for private tasks. Kept in their own file rather than
// growing task.schemas.ts further, following this repo's existing per-feature-file
// convention (task-drops.schemas.ts, evaluation.schemas.ts, etc.).

export const VerifyTaskAccessPasswordInputSchema = z.object({
  taskId: z.string(),
  password: z.string().min(1),
});

export const VerifyTaskAccessPasswordResponseSchema = z.object({
  grant: z.string(),
  expiresAt: z.string(),
});

export const AddAllowedViewerInputSchema = z.object({
  taskId: z.string(),
  viewerAddress: z.string(),
});

export const RemoveAllowedViewerInputSchema = z.object({
  taskId: z.string(),
  viewerAddress: z.string(),
});

export const ListAllowedViewersInputSchema = z.object({
  taskId: z.string(),
});

export const AllowedViewerResponseSchema = z.object({
  viewerAddress: z.string(),
  addedBy: z.string(),
  createdAt: z.string(),
});

export const ListAllowedViewersResponseSchema = z.array(AllowedViewerResponseSchema);

export type VerifyTaskAccessPasswordInput = z.infer<typeof VerifyTaskAccessPasswordInputSchema>;
export type VerifyTaskAccessPasswordResponse = z.infer<
  typeof VerifyTaskAccessPasswordResponseSchema
>;
export type AddAllowedViewerInput = z.infer<typeof AddAllowedViewerInputSchema>;
export type RemoveAllowedViewerInput = z.infer<typeof RemoveAllowedViewerInputSchema>;
export type ListAllowedViewersInput = z.infer<typeof ListAllowedViewersInputSchema>;
export type AllowedViewerResponse = z.infer<typeof AllowedViewerResponseSchema>;

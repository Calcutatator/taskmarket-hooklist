import { z } from 'zod';

export const ClaimStatus = z.enum(['active', 'submitted', 'forfeited', 'returned']);

export const ClaimCreateSchema = z.object({
  taskId: z.string().min(1, 'Task ID is required'),
  workerAddress: z.string().min(1, 'Worker address is required'),
  stakeTxHash: z.string().min(1, 'Stake transaction hash is required'),
  signature: z.string().min(1, 'Signature is required'),
});

export const ClaimResponseSchema = z.object({
  id: z.string(),
  taskId: z.string(),
  workerAddress: z.string(),
  stakeAmount: z.string(),
  stakeTxHash: z.string(),
  claimedAt: z.string(),
  status: ClaimStatus,
});

export type ClaimCreate = z.infer<typeof ClaimCreateSchema>;
export type ClaimResponse = z.infer<typeof ClaimResponseSchema>;
export type ClaimStatusType = z.infer<typeof ClaimStatus>;

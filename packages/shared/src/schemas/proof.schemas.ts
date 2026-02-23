import { z } from 'zod';

export const ProofType = z.enum(['url', 'screenshot', 'api_data', 'manual']);

export const ProofStatus = z.enum(['pending', 'verified', 'rejected']);

export const ProofSubmitSchema = z.object({
  taskId: z.string().min(1, 'Task ID is required'),
  workerAddress: z.string().min(1, 'Worker address is required'),
  proofData: z.string().min(1, 'Proof data is required').max(10000, 'Proof data is too long'),
  proofType: ProofType,
  metricValue: z.string().max(200).optional(),
  signature: z.string().min(1, 'Signature is required'),
});

export const ProofResponseSchema = z.object({
  id: z.string(),
  taskId: z.string(),
  workerAddress: z.string(),
  proofData: z.string(),
  proofType: ProofType,
  metricValue: z.string().nullable(),
  status: ProofStatus,
  submittedAt: z.string(),
  workerAgentId: z.string().nullable().optional(),
});

export type ProofSubmit = z.infer<typeof ProofSubmitSchema>;
export type ProofResponse = z.infer<typeof ProofResponseSchema>;
export type ProofTypeType = z.infer<typeof ProofType>;
export type ProofStatusType = z.infer<typeof ProofStatus>;

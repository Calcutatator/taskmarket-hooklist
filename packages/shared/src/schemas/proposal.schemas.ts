import { z } from 'zod';

export const ProposalStatus = z.enum(['pending', 'selected', 'rejected']);

export const ProposalCreateSchema = z.object({
  taskId: z.string().min(1, 'Task ID is required'),
  workerAddress: z.string().min(1, 'Worker address is required'),
  proposalText: z.string().min(10, 'Proposal text must be at least 10 characters').max(5000, 'Proposal text is too long'),
  estimatedDuration: z.number().positive('Estimated duration must be positive').optional(),
  signature: z.string().min(1, 'Signature is required'),
});

export const ProposalResponseSchema = z.object({
  id: z.string(),
  taskId: z.string(),
  workerAddress: z.string(),
  proposalText: z.string(),
  estimatedDuration: z.number().nullable(),
  status: ProposalStatus,
  submittedAt: z.string(),
  workerStats: z.object({
    completedTasks: z.number(),
    averageRating: z.number().nullable(),
  }).optional(),
});

export const ProposalSelectSchema = z.object({
  taskId: z.string().min(1, 'Task ID is required'),
  proposalId: z.string().min(1, 'Proposal ID is required'),
  workerAddress: z.string().min(1, 'Worker address is required'),
  signature: z.string().min(1, 'Signature is required'),
});

export type ProposalCreate = z.infer<typeof ProposalCreateSchema>;
export type ProposalResponse = z.infer<typeof ProposalResponseSchema>;
export type ProposalSelect = z.infer<typeof ProposalSelectSchema>;
export type ProposalStatusType = z.infer<typeof ProposalStatus>;

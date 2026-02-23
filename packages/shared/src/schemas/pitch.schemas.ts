import { z } from 'zod';

export const PitchStatus = z.enum(['pending', 'selected', 'rejected']);

export const PitchCreateSchema = z.object({
  taskId: z.string().min(1, 'Task ID is required'),
  workerAddress: z.string().min(1, 'Worker address is required'),
  pitchText: z.string().min(1, 'Pitch text is required'),
  estimatedDuration: z.number().positive('Estimated duration must be positive').optional(),
  signature: z.string().min(1, 'Signature is required'),
});

export const PitchResponseSchema = z.object({
  id: z.string(),
  taskId: z.string(),
  workerAddress: z.string(),
  pitchText: z.string(),
  estimatedDuration: z.number().nullable(),
  status: PitchStatus,
  submittedAt: z.string(),
  workerAgentId: z.string().nullable().optional(),
  workerStats: z
    .object({
      completedTasks: z.number(),
      averageRating: z.number().nullable(),
    })
    .optional(),
});

export const PitchSelectSchema = z.object({
  taskId: z.string().min(1, 'Task ID is required'),
  pitchId: z.string().min(1, 'Pitch ID is required'),
  workerAddress: z.string().min(1, 'Worker address is required'),
  signature: z.string().min(1, 'Signature is required'),
});

export type PitchCreate = z.infer<typeof PitchCreateSchema>;
export type PitchResponse = z.infer<typeof PitchResponseSchema>;
export type PitchSelect = z.infer<typeof PitchSelectSchema>;
export type PitchStatusType = z.infer<typeof PitchStatus>;

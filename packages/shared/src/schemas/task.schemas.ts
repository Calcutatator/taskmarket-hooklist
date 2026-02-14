import { z } from 'zod';

export const TaskStatus = z.enum([
  'open',
  'pending_approval',
  'accepted',
  'completed',
  'expired',
  'disputed',
]);

export const TaskCreateSchema = z.object({
  description: z
    .string()
    .min(1, 'Description is required')
    .max(2000, 'Description is too long'),
  reward: z.string().min(1, 'Reward is required'),
  duration: z.number().positive('Duration must be positive'),
  tags: z.array(z.string()).max(10, 'Maximum 10 tags allowed'),
});

export const TaskResponseSchema = z.object({
  id: z.string(),
  requester: z.string(),
  requesterPubkey: z.string(),
  description: z.string(),
  reward: z.string(),
  escrowTxHash: z.string(),
  createdAt: z.string(),
  expiryTime: z.string(),
  status: TaskStatus,
  tags: z.array(z.string()),
  worker: z.string().nullable(),
  rating: z.number().min(1).max(5).nullable(),
});

export const TaskListInputSchema = z.object({
  limit: z.number().min(1).max(100).optional().default(20),
  cursor: z.string().optional(),
  status: z
    .enum(['ALL', 'open', 'pending_approval', 'accepted', 'completed', 'expired', 'disputed'])
    .optional()
    .default('ALL'),
  tags: z.array(z.string()).optional(),
  minReward: z.string().optional(),
});

export const TaskListResponseSchema = z.object({
  tasks: z.array(TaskResponseSchema),
  nextCursor: z.string().nullable(),
  hasMore: z.boolean(),
});

export type TaskCreate = z.infer<typeof TaskCreateSchema>;
export type TaskResponse = z.infer<typeof TaskResponseSchema>;
export type TaskListInput = z.infer<typeof TaskListInputSchema>;
export type TaskListResponse = z.infer<typeof TaskListResponseSchema>;
export type TaskStatusType = z.infer<typeof TaskStatus>;

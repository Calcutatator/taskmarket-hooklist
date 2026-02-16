import { z } from 'zod';

export const TaskMode = z.enum(['contest', 'instant', 'proposal', 'race']);

export const TaskStatus = z.enum([
  'open',
  'claimed',
  'worker_selected',
  'pending_approval',
  'accepted',
  'completed',
  'expired',
  'disputed',
]);

export const TaskCreateSchema = z.object({
  description: z.string().min(1, 'Description is required').max(2000, 'Description is too long'),
  reward: z.string().min(1, 'Reward is required'),
  duration: z.number().positive('Duration must be positive'),
  tags: z.array(z.string()).max(10, 'Maximum 10 tags allowed'),
  mode: TaskMode.optional().default('contest'),
  stakeRequired: z.boolean().optional().default(false),
  stakeBps: z.number().min(0).max(10000).optional().default(0),
  proposalDeadline: z.number().positive().optional(),
  metricDescription: z.string().max(500).optional(),
  metricTarget: z.string().max(200).optional(),
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
  mode: TaskMode,
  stakeRequired: z.boolean(),
  stakeBps: z.number(),
  proposalDeadline: z.string().nullable(),
  metricDescription: z.string().nullable(),
  metricTarget: z.string().nullable(),
  claimedBy: z.string().nullable(),
  claimedAt: z.string().nullable(),
  platformFeeBps: z.number(),
  submissionCount: z.number().optional().default(0),
  proposalCount: z.number().optional().default(0),
});

export const TaskListInputSchema = z.object({
  limit: z.number().min(1).max(100).optional().default(20),
  cursor: z.string().optional(),
  status: z
    .enum(['ALL', 'open', 'claimed', 'worker_selected', 'pending_approval', 'accepted', 'completed', 'expired', 'disputed'])
    .optional()
    .default('ALL'),
  mode: z.enum(['ALL', 'contest', 'instant', 'proposal', 'race']).optional().default('ALL'),
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
export type TaskModeType = z.infer<typeof TaskMode>;

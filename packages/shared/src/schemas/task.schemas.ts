import { z } from 'zod';

export const TaskMode = z.enum(['bounty', 'claim', 'pitch', 'benchmark', 'auction']);

export const TaskStatus = z.enum([
  'open',
  'claimed',
  'worker_selected',
  'pending_approval',
  'review',
  'appealing',
  'disputed',
  'completed',
  'expired',
  'cancelled',
]);

export const AuctionType = z.enum(['dutch', 'english', 'reverse_dutch', 'reverse_english']);

export const TaskCreateSchema = z.object({
  description: z.string().min(1, 'Description is required').max(2000, 'Description is too long'),
  reward: z.string().min(1, 'Reward is required'),
  duration: z.number().positive('Duration must be positive'),
  tags: z.array(z.string()).max(10, 'Maximum 10 tags allowed'),
  mode: TaskMode.optional().default('bounty'),
  stakeRequired: z.boolean().optional().default(false),
  stakeBps: z.number().min(0).max(10000).optional().default(0),
  pitchDeadline: z.number().positive().optional(),
  bidDeadline: z.number().positive().optional(),
  maxPrice: z.string().optional(),
  metricDescription: z.string().max(500).optional(),
  metricTarget: z.string().max(200).optional(),
  auctionType: AuctionType.optional(),
  auctionStartPrice: z.string().optional(),
  auctionFloorPrice: z.string().optional(),
  hookContract: z.string().optional(),
  hookData: z
    .string()
    .regex(
      /^0x(?:[0-9a-fA-F]{2})*$/,
      'hookData must be hex-encoded bytes (0x followed by pairs of hex digits)'
    )
    .optional(),
  evaluator: z.string().optional(),
  evaluatorFeeBps: z.number().min(0).max(10000).optional(),
  evaluationWindowHours: z.number().positive().optional(),
  appealWindowHours: z.number().positive().optional(),
  disputeResolver: z.string().optional(),
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
  rating: z.number().min(0).max(100).nullable(),
  mode: TaskMode,
  stakeRequired: z.boolean(),
  stakeBps: z.number(),
  pitchDeadline: z.string().nullable(),
  bidDeadline: z.string().nullable(),
  maxPrice: z.string().nullable(),
  metricDescription: z.string().nullable(),
  metricTarget: z.string().nullable(),
  claimedBy: z.string().nullable(),
  claimedAt: z.string().nullable(),
  platformFeeBps: z.number(),
  submissionCount: z.number().optional().default(0),
  pitchCount: z.number().optional().default(0),
  requesterAgentId: z.string().nullable().optional(),
  requesterActorType: z.enum(['agent', 'human']).optional(),
  workerAgentId: z.string().nullable().optional(),
  workerActorType: z.enum(['agent', 'human']).optional(),
  auctionType: AuctionType.nullable().optional(),
  auctionStartPrice: z.string().nullable().optional(),
  auctionFloorPrice: z.string().nullable().optional(),
  currentAuctionPrice: z.string().nullable().optional(),
  auctionBidCount: z.number().nullable().optional(),
  auctionPriceReachesFloorAt: z.string().nullable().optional(),
  auctionPriceReachesMaxAt: z.string().nullable().optional(),
  currentLowestBid: z.string().nullable().optional(),
  hookContract: z.string().nullable().optional(),
  evaluator: z.string().nullable().optional(),
  evaluatorStake: z.string().nullable().optional(),
  evaluatorFeeBps: z.number().nullable().optional(),
  evaluationWindow: z.number().nullable().optional(),
  appealWindow: z.number().nullable().optional(),
  disputeResolver: z.string().nullable().optional(),
  appealDeadline: z.string().nullable().optional(),
  evaluatorDeadline: z.string().nullable().optional(),
  verdictType: z.enum(['APPROVE', 'REJECT', 'PARTIAL']).nullable().optional(),
  verdictScore: z.number().nullable().optional(),
  verdictConfidence: z.number().nullable().optional(),
  verdictEvidenceHash: z.string().nullable().optional(),
});

export const TaskListInputSchema = z.object({
  limit: z.number().min(1).max(100).optional().default(20),
  cursor: z.string().optional(),
  status: z
    .union([TaskStatus, z.literal('ALL')])
    .optional()
    .default('ALL'),
  mode: z
    .enum(['ALL', 'bounty', 'claim', 'pitch', 'benchmark', 'auction'])
    .optional()
    .default('ALL'),
  auctionType: AuctionType.optional(),
  requesterActorType: z.enum(['agent', 'human']).optional(),
  tags: z.array(z.string()).optional(),
  minReward: z.string().optional(),
  maxReward: z.string().optional(),
  deadlineHours: z.number().int().positive().optional(),
});

export const TaskListResponseSchema = z.object({
  tasks: z.array(TaskResponseSchema),
  nextCursor: z.string().nullable(),
  hasMore: z.boolean(),
});

export const TaskInboxInputSchema = z.object({
  address: z.string(),
});

export const TaskInboxResponseSchema = z.object({
  asRequester: z.array(TaskResponseSchema),
  asWorker: z.array(TaskResponseSchema),
});

export const PendingActionName = z.enum([
  'accept',
  'appeal',
  'auction_accept',
  'bid',
  'cancel',
  'claim',
  'evaluate',
  'evaluator_timeout',
  'finalize_verdict',
  'forfeit',
  'pitch',
  'rate',
  'resolve_dispute',
  'select_winner',
  'select_worker',
  'submit',
  'submit_proof',
  'update',
]);

export const PendingActionSchema = z.object({
  role: z.enum(['requester', 'worker', 'evaluator', 'dispute_resolver', 'anyone']),
  action: PendingActionName,
  command: z.string(),
});

export const TaskDetailResponseSchema = TaskResponseSchema.extend({
  pendingActions: PendingActionSchema.array(),
});

export const CancelTaskInputSchema = z.object({
  taskId: z.string(),
});

export const UpdateTaskInputSchema = z.object({
  taskId: z.string(),
  reward: z.string().optional(),
  expiryTime: z.number().optional(),
  bidDeadline: z.number().optional(),
  pitchDeadline: z.number().optional(),
  auctionFloorPrice: z.string().optional(),
  auctionStartPrice: z.string().optional(),
  description: z.string().optional(),
  tags: z.array(z.string()).optional(),
  metricDescription: z.string().optional(),
});

export type TaskCreate = z.infer<typeof TaskCreateSchema>;
export type TaskResponse = z.infer<typeof TaskResponseSchema>;
export type TaskDetailResponse = z.infer<typeof TaskDetailResponseSchema>;
export type PendingAction = z.infer<typeof PendingActionSchema>;
export type PendingActionNameValue = z.infer<typeof PendingActionName>;
export type TaskListInput = z.infer<typeof TaskListInputSchema>;
export type TaskListResponse = z.infer<typeof TaskListResponseSchema>;
export type TaskStatusType = z.infer<typeof TaskStatus>;
export type TaskModeType = z.infer<typeof TaskMode>;
export type AuctionTypeValue = z.infer<typeof AuctionType>;
export type TaskInboxInput = z.infer<typeof TaskInboxInputSchema>;
export type TaskInboxResponse = z.infer<typeof TaskInboxResponseSchema>;

import { z } from 'zod';
import { TaskDropCreateInlineSchema } from './task-drops.schemas';
import {
  csvArrayQueryParam,
  PositiveUsdcBaseUnitsSchema,
  UsdcBaseUnitsSchema,
} from './common.schemas';

export const TaskMode = z.enum(['bounty', 'claim', 'pitch', 'benchmark', 'auction']);

// 'private' is deliberately not a value here yet -- it would behave identically to
// 'unlisted' with no real access control until read-authentication exists across the
// read surface (ADR-0014, ADR-0015). Add it only once that enforcement is real.
export const TaskVisibility = z.enum(['unlisted', 'public']);

// ADR-0016: independent axis from TaskVisibility. Chosen once at creation and
// locked in permanently -- there is no update path for this field anywhere.
// 'public' (default) matches today's always-open submission behavior exactly.
export const SubmissionVisibility = z.enum(['public', 'reveal_all', 'winner_only', 'never']);

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

// Derived, server-computed lifecycle bucket over `status` -- ADR-0024. `status` stays a
// literal mirror of on-chain/indexer state and never changes meaning; `phase` exists
// because `status` can legitimately sit at 'open'/'claimed'/'worker_selected' past
// `expiryTime` (status only transitions via an explicit refundExpired transaction or an
// indexer-observed event, never automatically on a timer -- see ADR-0007), and nothing
// named that condition before this.
export const TaskPhase = z.enum(['active', 'in_review', 'awaiting_settlement', 'resolved']);

export const AuctionType = z.enum(['dutch', 'english', 'reverse_dutch', 'reverse_english']);

export const PendingActionName = z.enum([
  'accept',
  'accept_submissions',
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
  'reject_submission',
  'refund_expired',
  'resolve_dispute',
  'select_winner',
  'select_worker',
  'submit',
  'submit_proof',
  'update',
]);

export const PAID_PENDING_ACTION_NAMES = [
  'accept',
  'accept_submissions',
  'appeal',
  'auction_accept',
  'bid',
  'cancel',
  'evaluate',
  'evaluator_timeout',
  'pitch',
  'rate',
  'refund_expired',
  'reject_submission',
  'resolve_dispute',
  'submit_proof',
  'update',
] as const satisfies readonly (typeof PendingActionName.options)[number][];

export const PendingActionSchema = z.object({
  role: z.enum(['requester', 'worker', 'evaluator', 'dispute_resolver', 'anyone']),
  action: PendingActionName,
  command: z.string(),
  eligibleAddress: z.string().nullable().optional(),
  requiresPayment: z.boolean().optional(),
  paymentAmount: z.string().nullable().optional(),
  availableAfter: z.string().nullable().optional(),
  availableUntil: z.string().nullable().optional(),
  targetWorker: z.string().nullable().optional(),
});

export const TaskAwardSchema = z.object({
  workerAddress: z.string(),
  workerAgentId: z.string().nullable(),
  workerActorType: z.enum(['agent', 'human']),
  rank: z.number().int().positive(),
  isPrimary: z.boolean(),
  grossAmount: z.string(),
  workerPayment: z.string(),
  platformFee: z.string(),
  settlementTxHash: z.string(),
  settledAt: z.string(),
  rating: z.number().min(0).max(100).nullable(),
});

export const TaskCreateSchema = z
  .object({
    description: z.string().min(1, 'Description is required').max(2000, 'Description is too long'),
    reward: PositiveUsdcBaseUnitsSchema,
    duration: z.number().positive('Duration must be positive'),
    tags: z.array(z.string()).max(10, 'Maximum 10 tags allowed'),
    mode: TaskMode.optional().default('bounty'),
    taskVisibility: TaskVisibility.optional().default('public'),
    submissionVisibility: SubmissionVisibility.optional().default('public'),
    stakeRequired: z.boolean().optional().default(false),
    stakeBps: z.number().min(0).max(10000).optional().default(0),
    pitchDeadline: z.number().positive().optional(),
    bidDeadline: z.number().positive().optional(),
    maxPrice: PositiveUsdcBaseUnitsSchema.optional(),
    metricDescription: z.string().max(500).optional(),
    metricTarget: z.string().max(200).optional(),
    auctionType: AuctionType.optional(),
    auctionStartPrice: UsdcBaseUnitsSchema.optional(),
    auctionFloorPrice: UsdcBaseUnitsSchema.optional(),
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
    taskDropId: z.string().min(1).optional(),
    taskDropCreate: TaskDropCreateInlineSchema.optional(),
  })
  .superRefine((input, ctx) => {
    if (input.taskDropId && input.taskDropCreate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['taskDropId'],
        message: 'Provide taskDropId or taskDropCreate, not both',
      });
    }

    if (input.mode !== 'auction') return;

    // The superRefine still runs when a field-level regex check has already
    // failed; skip the BigInt cross-field comparisons then so safeParse
    // reports issues instead of throwing.
    const toBaseUnits = (value: string | undefined) =>
      value !== undefined && /^[0-9]+$/.test(value) ? BigInt(value) : null;
    const reward = toBaseUnits(input.reward);

    if (!input.maxPrice) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['maxPrice'],
        message: 'maxPrice is required for auction mode',
      });
    } else if (
      reward !== null &&
      toBaseUnits(input.maxPrice) !== null &&
      toBaseUnits(input.maxPrice) !== reward
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['maxPrice'],
        message: 'maxPrice must equal reward for auction mode',
      });
    }

    if (!input.auctionType) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['auctionType'],
        message:
          'auctionType is required for auction mode (dutch, english, reverse_dutch, reverse_english)',
      });
      return;
    }

    if (input.auctionType === 'dutch' && input.auctionFloorPrice === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['auctionFloorPrice'],
        message: 'auctionFloorPrice is required for dutch auction type',
      });
    }
    if (input.auctionType === 'reverse_dutch' && input.auctionStartPrice === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['auctionStartPrice'],
        message: 'auctionStartPrice is required for reverse_dutch auction type',
      });
    }

    for (const [field, value] of [
      ['auctionFloorPrice', input.auctionFloorPrice],
      ['auctionStartPrice', input.auctionStartPrice],
    ] as const) {
      const parsed = toBaseUnits(value);
      if (parsed !== null && reward !== null && parsed > reward) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [field],
          message: `${field} must be less than or equal to reward`,
        });
      }
    }
  });

export const TaskResponseSchema = z.object({
  id: z.string(),
  requester: z.string(),
  requesterPubkey: z.string().nullable(),
  description: z.string(),
  reward: z.string(),
  escrowTxHash: z.string(),
  createdAt: z.string(),
  expiryTime: z.string(),
  status: TaskStatus,
  tags: z.array(z.string()),
  mode: TaskMode,
  taskVisibility: TaskVisibility.optional().default('public'),
  submissionVisibility: SubmissionVisibility.optional().default('public'),
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
  awardCount: z.number().int().nonnegative().optional(),
  // Read-time projection of the rank-1 task_awards row -- not a separately
  // written field, so it cannot drift out of sync the way the old worker/
  // rating compatibility fields could (see ADR-0006). null before settlement.
  primaryAward: z
    .object({
      workerAddress: z.string(),
      rating: z.number().min(0).max(100).nullable(),
    })
    .nullable()
    .optional(),
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
  submissionWindowOpen: z.boolean(),
  phase: TaskPhase,
  netReward: z.string().nullable().optional(),
  pendingActions: PendingActionSchema.array().optional(),
  selfAward: z.boolean().nullable().optional(),
  taskDropId: z.string().nullable().optional(),
  taskDrop: z
    .object({
      id: z.string(),
      name: z.string(),
    })
    .nullable()
    .optional(),
  hooks: z.array(z.string()).optional(),
});

export const TaskListInputSchema = z.object({
  limit: z.number().min(1).max(100).optional().default(20),
  cursor: z.string().optional(),
  status: z
    .union([TaskStatus, z.literal('ALL')])
    .optional()
    .default('ALL'),
  phase: TaskPhase.optional(),
  mode: z
    .enum(['ALL', 'bounty', 'claim', 'pitch', 'benchmark', 'auction'])
    .optional()
    .default('ALL'),
  auctionType: AuctionType.optional(),
  requesterActorType: z.enum(['agent', 'human']).optional(),
  tags: csvArrayQueryParam(),
  minReward: z.string().optional(),
  maxReward: z.string().optional(),
  deadlineHours: z.number().int().positive().optional(),
  requester: z.string().optional(),
  worker: z.string().optional(),
  taskDropId: z.string().trim().min(1).optional(),
  sort: z
    .enum(['newest', 'reward_desc', 'reward_asc', 'deadline_asc'])
    .optional()
    .default('newest'),
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

export const TaskDetailResponseSchema = TaskResponseSchema.extend({
  pendingActions: PendingActionSchema.array(),
  awards: TaskAwardSchema.array().optional(),
  dreamsPerUsdc: z.string().optional(),
  bonusBps: z.number().optional(),
  estimatedUsdBonusValue: z.string().optional(),
  estimatedWorkerUsdBonusValue: z.string().optional(),
  estimatedRequesterUsdBonusValue: z.string().optional(),
  estimatedWorkerDreamsBonus: z.string().optional(),
  estimatedRequesterDreamsBonus: z.string().optional(),
});

export const CancelTaskInputSchema = z.object({
  taskId: z.string(),
});

export const RejectSubmissionInputSchema = z.object({
  taskId: z.string(),
  worker: z.string(),
});

export const RefundExpiredInputSchema = z.object({
  taskId: z.string(),
});

export const UpdateTaskInputSchema = z.object({
  taskId: z.string(),
  reward: PositiveUsdcBaseUnitsSchema.optional(),
  expiryTime: z.number().int().positive().optional(),
  bidDeadline: z.number().int().positive().optional(),
  pitchDeadline: z.number().int().positive().optional(),
  auctionFloorPrice: UsdcBaseUnitsSchema.optional(),
  auctionStartPrice: UsdcBaseUnitsSchema.optional(),
  description: z.string().max(2000, 'Description is too long').optional(),
  tags: z.array(z.string()).max(10, 'Maximum 10 tags allowed').optional(),
  metricDescription: z.string().max(500).optional(),
});

export const RequesterStatsSchema = z.object({
  completedCount: z.number(),
  selfAwardCount: z.number(),
  cancelledAfterSubmissionsCount: z.number(),
  expiredNoActionCount: z.number(),
  expiredAfterRejectionsCount: z.number(),
  totalTasksCreated: z.number(),
  totalSubmissionAttempts: z.number(),
  totalUniqueWorkers: z.number(),
});

export type TaskCreate = z.infer<typeof TaskCreateSchema>;
export type TaskResponse = z.infer<typeof TaskResponseSchema>;
export type TaskDetailResponse = z.infer<typeof TaskDetailResponseSchema>;
export type TaskAward = z.infer<typeof TaskAwardSchema>;
export type PendingAction = z.infer<typeof PendingActionSchema>;
export type PendingActionNameValue = z.infer<typeof PendingActionName>;
export type PaidPendingActionNameValue = (typeof PAID_PENDING_ACTION_NAMES)[number];
export type TaskListInput = z.infer<typeof TaskListInputSchema>;
export type TaskListResponse = z.infer<typeof TaskListResponseSchema>;
export type TaskStatusType = z.infer<typeof TaskStatus>;
export type TaskPhaseType = z.infer<typeof TaskPhase>;
export type TaskModeType = z.infer<typeof TaskMode>;
export type TaskVisibilityType = z.infer<typeof TaskVisibility>;
export type SubmissionVisibilityType = z.infer<typeof SubmissionVisibility>;
export type AuctionTypeValue = z.infer<typeof AuctionType>;
export type TaskInboxInput = z.infer<typeof TaskInboxInputSchema>;
export type TaskInboxResponse = z.infer<typeof TaskInboxResponseSchema>;
export type RequesterStats = z.infer<typeof RequesterStatsSchema>;

import { z } from 'zod';

/**
 * Stats data layer schemas.
 *
 * These power the chart-ready time-series and aggregation endpoints under
 * `stats.*`. All monetary values are USDC base units (numeric(78,0)) and are
 * ALWAYS returned as strings; never coerce them to JavaScript numbers.
 *
 * Bucket strings are 'YYYY-MM-DD' (UTC) for both day and week buckets. Week
 * buckets use the Monday-anchored start date produced by Postgres
 * `date_trunc('week', ...)`.
 */

export const TimeRangeEnum = z.enum(['7d', '30d', '90d', 'all']);
export const BucketEnum = z.enum(['day', 'week']);

export const ActivityTypeEnum = z.enum([
  'task_created',
  'task_submitted',
  'task_claimed',
  'task_pitched',
  'bid_placed',
  'task_rated',
]);

const ActorTypeEnum = z.enum(['human', 'agent']);

// ---------------------------------------------------------------------------
// platformTimeSeries
// ---------------------------------------------------------------------------

export const PlatformTimeSeriesInputSchema = z.object({
  range: TimeRangeEnum.optional().default('30d'),
  bucket: BucketEnum.optional().default('day'),
});

export const PlatformTimeSeriesPointSchema = z.object({
  bucket: z.string(),
  tasksCreated: z.number(),
  rewardVolume: z.string(),
  completedTasks: z.number(),
  newAgents: z.number(),
  activeAgents: z.number(),
});

export const PlatformTimeSeriesResponseSchema = z.array(PlatformTimeSeriesPointSchema);

// ---------------------------------------------------------------------------
// agentTimeSeries
// ---------------------------------------------------------------------------

export const AgentTimeSeriesInputSchema = z
  .object({
    address: z.string().optional(),
    agentId: z.string().optional(),
    range: TimeRangeEnum.optional().default('90d'),
    bucket: BucketEnum.optional().default('week'),
  })
  .refine((v) => Boolean(v.address) || Boolean(v.agentId), {
    message: 'Provide address or agentId',
  });

export const AgentTimeSeriesPointSchema = z.object({
  bucket: z.string(),
  earnings: z.string(),
  cumulativeEarnings: z.string(),
  tasksCompleted: z.number(),
  avgRating: z.number().nullable(),
  ratingsCount: z.number(),
  activityCount: z.number(),
});

export const AgentTimeSeriesResponseSchema = z.array(AgentTimeSeriesPointSchema);

// ---------------------------------------------------------------------------
// breakdowns
// ---------------------------------------------------------------------------

export const BreakdownsInputSchema = z.object({});

export const BreakdownsResponseSchema = z.object({
  status: z.array(z.object({ status: z.string(), count: z.number() })),
  mode: z.array(z.object({ mode: z.string(), count: z.number() })),
  actorType: z.array(z.object({ actorType: ActorTypeEnum, count: z.number() })),
});

// ---------------------------------------------------------------------------
// activityFeed
// ---------------------------------------------------------------------------

export const ActivityFeedInputSchema = z.object({
  limit: z.number().int().min(1).max(50).optional().default(20),
  cursor: z.string().optional(),
  types: z.array(ActivityTypeEnum).optional(),
});

export const ActivityFeedItemSchema = z.object({
  type: ActivityTypeEnum,
  timestamp: z.string(),
  taskId: z.string(),
  taskTitle: z.string().nullable(),
  actor: z.string(),
  actorType: ActorTypeEnum,
  amount: z.string().nullable(),
  rating: z.number().nullable(),
});

export const ActivityFeedResponseSchema = z.object({
  items: z.array(ActivityFeedItemSchema),
  nextCursor: z.string().nullable(),
});

// ---------------------------------------------------------------------------
// activityHeatmap
// ---------------------------------------------------------------------------

export const HeatmapDimensionEnum = z.enum(['mode', 'hourOfWeek']);

export const ActivityHeatmapInputSchema = z.object({
  range: TimeRangeEnum.optional().default('30d'),
  dimension: HeatmapDimensionEnum.optional().default('mode'),
});

export const ActivityHeatmapCellSchema = z.object({
  row: z.string(),
  col: z.string(),
  count: z.number(),
  volume: z.string(),
});

export const ActivityHeatmapResponseSchema = z.object({
  rowKeys: z.array(z.string()),
  colKeys: z.array(z.string()),
  cells: z.array(ActivityHeatmapCellSchema),
  maxCount: z.number(),
});

// ---------------------------------------------------------------------------
// Inferred types (the frontend contract imported from @taskmarket/shared)
// ---------------------------------------------------------------------------

export type TimeRange = z.infer<typeof TimeRangeEnum>;
export type Bucket = z.infer<typeof BucketEnum>;
export type ActivityType = z.infer<typeof ActivityTypeEnum>;

export type PlatformTimeSeriesInput = z.infer<typeof PlatformTimeSeriesInputSchema>;
export type PlatformTimeSeriesPoint = z.infer<typeof PlatformTimeSeriesPointSchema>;
export type PlatformTimeSeriesResponse = z.infer<typeof PlatformTimeSeriesResponseSchema>;

export type AgentTimeSeriesInput = z.infer<typeof AgentTimeSeriesInputSchema>;
export type AgentTimeSeriesPoint = z.infer<typeof AgentTimeSeriesPointSchema>;
export type AgentTimeSeriesResponse = z.infer<typeof AgentTimeSeriesResponseSchema>;

export type BreakdownsInput = z.infer<typeof BreakdownsInputSchema>;
export type BreakdownsResponse = z.infer<typeof BreakdownsResponseSchema>;

export type ActivityFeedInput = z.infer<typeof ActivityFeedInputSchema>;
export type ActivityFeedItem = z.infer<typeof ActivityFeedItemSchema>;
export type ActivityFeedResponse = z.infer<typeof ActivityFeedResponseSchema>;

export type HeatmapDimension = z.infer<typeof HeatmapDimensionEnum>;
export type ActivityHeatmapInput = z.infer<typeof ActivityHeatmapInputSchema>;
export type ActivityHeatmapCell = z.infer<typeof ActivityHeatmapCellSchema>;
export type ActivityHeatmapResponse = z.infer<typeof ActivityHeatmapResponseSchema>;

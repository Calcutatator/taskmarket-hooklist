import { router, publicProcedure } from '../trpc';
import {
  PlatformTimeSeriesInputSchema,
  PlatformTimeSeriesResponseSchema,
  AgentTimeSeriesInputSchema,
  AgentTimeSeriesResponseSchema,
  BreakdownsInputSchema,
  BreakdownsResponseSchema,
  ActivityFeedInputSchema,
  ActivityFeedResponseSchema,
} from '@taskmarket/shared';
import {
  getPlatformTimeSeries,
  getAgentTimeSeries,
  getBreakdowns,
  getActivityFeed,
} from '../services/stats';

export const statsRouter = router({
  platformTimeSeries: publicProcedure
    .meta({
      openapi: {
        method: 'GET',
        path: '/stats/platform-time-series',
        tags: ['Stats'],
        summary: 'Platform-wide chart-ready time series (tasks, rewards, agents)',
      },
    })
    .input(PlatformTimeSeriesInputSchema)
    .output(PlatformTimeSeriesResponseSchema)
    .query(({ input, ctx }) => getPlatformTimeSeries(ctx.db, input)),

  agentTimeSeries: publicProcedure
    .meta({
      openapi: {
        method: 'GET',
        path: '/stats/agent-time-series',
        tags: ['Stats'],
        summary: 'Per-agent chart-ready time series (earnings, ratings, activity)',
      },
    })
    .input(AgentTimeSeriesInputSchema)
    .output(AgentTimeSeriesResponseSchema)
    .query(({ input, ctx }) => getAgentTimeSeries(ctx.db, input)),

  breakdowns: publicProcedure
    .meta({
      openapi: {
        method: 'GET',
        path: '/stats/breakdowns',
        tags: ['Stats'],
        summary: 'Aggregate task and actor breakdown counts',
      },
    })
    .input(BreakdownsInputSchema)
    .output(BreakdownsResponseSchema)
    .query(({ ctx }) => getBreakdowns(ctx.db)),

  activityFeed: publicProcedure
    .meta({
      openapi: {
        method: 'GET',
        path: '/stats/activity-feed',
        tags: ['Stats'],
        summary: 'Recent platform activity feed (keyset paginated by timestamp)',
      },
    })
    .input(ActivityFeedInputSchema)
    .output(ActivityFeedResponseSchema)
    .query(({ input, ctx }) => getActivityFeed(ctx.db, input)),
});

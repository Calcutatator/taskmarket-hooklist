import type {
  ActivityFeedResponse,
  ActivityHeatmapResponse,
  BreakdownsResponse,
  PlatformTimeSeriesResponse,
} from '@taskmarket/shared';
import type { Metadata } from 'next';
import Link from 'next/link';

import { AgentTable } from '@/components/market/agents';
import { DashboardActivityChart } from '@/components/market/dashboard-activity-chart';
import { DashboardActivityFeed } from '@/components/market/dashboard-activity-feed';
import { DashboardDistributionChart } from '@/components/market/dashboard-distribution-chart';
import { DashboardHeatmap } from '@/components/market/dashboard-heatmap';
import { DashboardScope } from '@/components/market/dashboard-scope';
import { PromoBanner } from '@/components/market/promo-banner';
import { PromoCarousel } from '@/components/market/promo-carousel';
import { PromoSideCard } from '@/components/market/promo-side-card';
import { TaskTable } from '@/components/market/tasks';
import { SectionCards } from '@/components/section-cards';
import { Button } from '@/components/ui/button';
import {
  fetchActivityFeed,
  fetchActivityHeatmap,
  fetchAgentCount,
  fetchBreakdowns,
  fetchLeaderboard,
  fetchPlatformTimeSeries,
  fetchTasks,
  fetchTaskStats,
} from '@/lib/api/server';
import { derivePlatformKpiTrends } from '@/lib/charts/platform-trends';
import { BANNER_SLOTS, CAROUSEL_SLOTS, SIDE_CARD_SLOTS } from '@/lib/market/promo-slots';
import { buildDashboardPageMetadata } from '@/lib/seo';

export const metadata: Metadata = buildDashboardPageMetadata({
  description: 'Monitor Taskmarket tasks, agents, rewards, and recent marketplace activity.',
  path: '/dashboard',
  title: 'Console',
});

const EMPTY_BREAKDOWNS: BreakdownsResponse = { actorType: [], mode: [], status: [] };
const EMPTY_ACTIVITY: ActivityFeedResponse = { items: [], nextCursor: null };
const EMPTY_HEATMAP: ActivityHeatmapResponse = {
  rowKeys: [],
  colKeys: [],
  cells: [],
  maxCount: 0,
};

// Resolve a stats fetch to its data or a safe fallback so a single backend
// outage degrades that one visual to its empty state instead of crashing the
// whole dashboard render. The core Promise.all below still owns the page-level
// fetches that must succeed for the shell to mean anything.
async function safe<T>(promise: Promise<T>, fallback: T): Promise<T> {
  try {
    return await promise;
  } catch {
    return fallback;
  }
}

export default async function Page() {
  const [taskStats, agentCount, openTasks, recentTasks, agents] = await Promise.all([
    fetchTaskStats(),
    fetchAgentCount(),
    fetchTasks({ limit: 20, status: 'open' }),
    fetchTasks({ limit: 8 }),
    fetchLeaderboard({ limit: 8, sort: 'reputation' }),
  ]);

  const [platformSeries, breakdowns, activityFeed, activityHeatmap] = await Promise.all([
    safe<PlatformTimeSeriesResponse>(fetchPlatformTimeSeries({ bucket: 'day', range: '30d' }), []),
    safe<BreakdownsResponse>(fetchBreakdowns(), EMPTY_BREAKDOWNS),
    safe<ActivityFeedResponse>(fetchActivityFeed({ limit: 12 }), EMPTY_ACTIVITY),
    safe<ActivityHeatmapResponse>(
      fetchActivityHeatmap({ range: '30d', dimension: 'mode' }),
      EMPTY_HEATMAP
    ),
  ]);

  const trends = derivePlatformKpiTrends(platformSeries);

  const marketContent = (
    <div className="flex flex-col gap-4 md:gap-6">
      <div className="px-4 lg:px-6">
        <PromoBanner slots={BANNER_SLOTS} />
      </div>
      <SectionCards
        agentCount={agentCount}
        agentsTrend={trends.agents}
        openTaskCount={openTasks.tasks.length}
        openTasksTrend={trends.openTasks}
        rewardsTrend={trends.rewards}
        taskCount={taskStats.count}
        tasksTrend={trends.tasks}
        totalRewards={taskStats.totalRewards}
      />
      <div className="grid gap-4 px-4 md:gap-6 lg:px-6">
        <DashboardActivityChart initialData={platformSeries} initialRange="30d" />
        <DashboardHeatmap
          initialData={activityHeatmap}
          initialDimension="mode"
          initialRange="30d"
        />
        <div className="grid gap-4 md:gap-6 @4xl/main:h-[34rem] @4xl/main:grid-cols-[minmax(0,1fr)_360px]">
          <DashboardDistributionChart initialData={breakdowns} />
          <DashboardActivityFeed initialData={activityFeed} />
        </div>
      </div>
      <div className="grid gap-4 px-4 md:gap-6 lg:px-6">
        <section className="grid gap-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="font-mono text-xs uppercase text-primary">Tasks</p>
              <h2 className="mt-2 font-display text-3xl font-semibold tracking-tight">
                Latest activity
              </h2>
            </div>
            <Button asChild variant="outline">
              <Link href="/dashboard/tasks">View tasks</Link>
            </Button>
          </div>
          <TaskTable tasks={recentTasks.tasks} />
        </section>
        <section className="grid gap-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="font-mono text-xs uppercase text-primary">Agents</p>
              <h2 className="mt-2 font-display text-3xl font-semibold tracking-tight">
                Reputation leaders
              </h2>
            </div>
            <Button asChild variant="outline">
              <Link href="/dashboard/agents">View agents</Link>
            </Button>
          </div>
          <AgentTable agents={agents} />
        </section>
        <section className="grid gap-4 @4xl/main:grid-cols-[minmax(0,1fr)_320px]">
          <div className="grid gap-4">
            <div>
              <p className="font-mono text-xs uppercase text-primary">Explore</p>
              <h2 className="mt-2 font-display text-xl font-semibold tracking-tight">
                More on Taskmarket
              </h2>
            </div>
            <PromoCarousel slots={CAROUSEL_SLOTS} />
          </div>
          <PromoSideCard slots={SIDE_CARD_SLOTS} />
        </section>
      </div>
    </div>
  );

  return (
    <div className="flex flex-1 flex-col">
      <div className="@container/main flex flex-1 flex-col gap-2">
        <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6">
          <DashboardScope marketContent={marketContent} />
        </div>
      </div>
    </div>
  );
}

import type {
  ActivityFeedResponse,
  BreakdownsResponse,
  PlatformTimeSeriesResponse,
} from '@taskmarket/shared';
import type { Metadata } from 'next';
import Link from 'next/link';

import { AgentTable } from '@/components/market/agents';
import { DashboardActivityChart } from '@/components/market/dashboard-activity-chart';
import { DashboardActivityFeed } from '@/components/market/dashboard-activity-feed';
import { DashboardDistributionChart } from '@/components/market/dashboard-distribution-chart';
import { DashboardScope } from '@/components/market/dashboard-scope';
import { FirstRunChecklist } from '@/components/market/first-run-checklist';
import { TaskTable } from '@/components/market/tasks';
import { SectionCards } from '@/components/section-cards';
import { Button } from '@/components/ui/button';
import {
  fetchActivityFeed,
  fetchAgentCount,
  fetchBreakdowns,
  fetchLeaderboard,
  fetchPlatformTimeSeries,
  fetchTasks,
  fetchTaskStats,
} from '@/lib/api/server';
import { derivePlatformKpiTrends } from '@/lib/charts/platform-trends';
import { buildDashboardPageMetadata } from '@/lib/seo';

export const metadata: Metadata = buildDashboardPageMetadata({
  description: 'Monitor Taskmarket tasks, agents, rewards, and recent marketplace activity.',
  path: '/dashboard',
  title: 'Console',
});

const EMPTY_BREAKDOWNS: BreakdownsResponse = { actorType: [], mode: [], status: [] };
const EMPTY_ACTIVITY: ActivityFeedResponse = { items: [], nextCursor: null };

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

  const [platformSeries, breakdowns, activityFeed] = await Promise.all([
    safe<PlatformTimeSeriesResponse>(fetchPlatformTimeSeries({ bucket: 'day', range: '30d' }), []),
    safe<BreakdownsResponse>(fetchBreakdowns(), EMPTY_BREAKDOWNS),
    safe<ActivityFeedResponse>(fetchActivityFeed({ limit: 12 }), EMPTY_ACTIVITY),
  ]);

  const isFirstRun = taskStats.count === 0;
  const trends = derivePlatformKpiTrends(platformSeries);

  const marketContent = (
    <div className="flex flex-col gap-4 md:gap-6">
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
      {isFirstRun ? null : (
        <div className="grid gap-4 px-4 md:gap-6 lg:px-6">
          <DashboardActivityChart initialData={platformSeries} initialRange="30d" />
          <div className="grid gap-4 md:gap-6 @4xl/main:h-[34rem] @4xl/main:grid-cols-[minmax(0,1fr)_360px]">
            <DashboardDistributionChart initialData={breakdowns} />
            <DashboardActivityFeed initialData={activityFeed} />
          </div>
        </div>
      )}
      <div className="grid gap-6 px-4 lg:px-6">
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
      </div>
    </div>
  );

  return (
    <div className="flex flex-1 flex-col">
      <div className="@container/main flex flex-1 flex-col gap-2">
        <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6">
          {isFirstRun ? <FirstRunChecklist /> : null}
          <DashboardScope marketContent={marketContent} />
        </div>
      </div>
    </div>
  );
}

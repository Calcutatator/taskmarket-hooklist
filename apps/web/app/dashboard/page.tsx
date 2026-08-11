import type {
  ActivityFeedResponse,
  ActivityHeatmapResponse,
  BreakdownsResponse,
} from '@taskmarket/shared';
import type { Metadata, Route } from 'next';
import Link from 'next/link';

import { AgentTable } from '@/components/market/agents';
import { DashboardActivityChart } from '@/components/market/dashboard-activity-chart';
import { DashboardActivityFeed } from '@/components/market/dashboard-activity-feed';
import { DashboardDistributionChart } from '@/components/market/dashboard-distribution-chart';
import { DashboardHeatmap } from '@/components/market/dashboard-heatmap';
import {
  parseDashboardSection,
  type DashboardSection,
} from '@/components/market/dashboard-section-tabs';
import { DashboardScope } from '@/components/market/dashboard-scope';
import { TaskTable } from '@/components/market/tasks';
import { SectionCards } from '@/components/section-cards';
import { Button } from '@/components/ui/button';
import {
  fetchActivityFeed,
  fetchActivityHeatmap,
  fetchAgentCount,
  fetchBreakdowns,
  fetchLeaderboard,
  fetchMarketStats,
  fetchPlatformTimeSeries,
  fetchTasks,
  fetchTaskStats,
} from '@/lib/api/server';
import { derivePlatformKpiTrends } from '@/lib/charts/platform-trends';
import { buildDashboardPageMetadata } from '@/lib/seo';

export const metadata: Metadata = buildDashboardPageMetadata({
  description: 'Monitor Taskmarket tasks, agents, rewards, and recent marketplace activity.',
  ownOgImage: true,
  path: '/dashboard',
  title: 'Console',
});

type DashboardPageProps = {
  searchParams: Promise<{ section?: string }>;
};

type LoadResult<T> = { data: T; failed: false } | { data: null; failed: true };

const SECTION_TITLES: Record<DashboardSection, string> = {
  overview: 'Marketplace overview',
  activity: 'Marketplace activity',
  tasks: 'Latest tasks',
  agents: 'Reputation leaders',
};

async function load<T>(promise: Promise<T>): Promise<LoadResult<T>> {
  try {
    return { data: await promise, failed: false };
  } catch {
    return { data: null, failed: true };
  }
}

function DashboardLoadError({
  children,
  retryHref,
}: {
  children: React.ReactNode;
  retryHref: Route;
}) {
  return (
    <section
      className="grid gap-4 rounded-lg border border-destructive/40 bg-card/44 p-6"
      role="alert"
    >
      <p className="text-sm text-destructive">{children}</p>
      <Button asChild className="w-fit" variant="outline">
        <Link href={retryHref}>Reload</Link>
      </Button>
    </section>
  );
}

function SectionHeading({
  eyebrow,
  title,
  action,
}: {
  eyebrow: string;
  title: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <p className="font-mono text-xs uppercase text-primary">{eyebrow}</p>
        <h2 className="mt-2 font-display text-3xl font-semibold tracking-tight">{title}</h2>
      </div>
      {action}
    </div>
  );
}

async function OverviewSection() {
  const [taskStats, agentCount, marketStats, platformSeries] = await Promise.all([
    load(fetchTaskStats()),
    load(fetchAgentCount()),
    load(fetchMarketStats()),
    load(fetchPlatformTimeSeries({ bucket: 'day', range: '30d' })),
  ]);

  const canRenderMetrics =
    !taskStats.failed && !agentCount.failed && !marketStats.failed && !platformSeries.failed;

  return (
    <div className="flex flex-col gap-4 md:gap-6">
      {canRenderMetrics ? (
        <SectionCards
          activeAgentCount={marketStats.data.activeAgents7d}
          agentCount={agentCount.data}
          agentsTrend={derivePlatformKpiTrends(platformSeries.data).agents}
          openTaskCount={marketStats.data.openTasks}
          openTasksTrend={derivePlatformKpiTrends(platformSeries.data).openTasks}
          rewardsTrend={derivePlatformKpiTrends(platformSeries.data).rewards}
          taskCount={taskStats.data.count}
          tasksTrend={derivePlatformKpiTrends(platformSeries.data).tasks}
          totalRewards={taskStats.data.totalRewards}
        />
      ) : (
        <div className="px-4 lg:px-6">
          <DashboardLoadError retryHref="/dashboard">
            Could not load marketplace metrics right now.
          </DashboardLoadError>
        </div>
      )}
      <section className="grid gap-4 px-4 lg:px-6">
        <SectionHeading eyebrow="Explore" title="Marketplace at a glance" />
        <div className="grid gap-3 md:grid-cols-3">
          {[
            {
              description: 'See live trends, mode distribution, and recent marketplace events.',
              href: '/dashboard?section=activity' as Route,
              label: 'View activity',
            },
            {
              description: 'Review the latest work and continue into the full task marketplace.',
              href: '/dashboard?section=tasks' as Route,
              label: 'View tasks',
            },
            {
              description: 'Compare the strongest reputation signals across active agents.',
              href: '/dashboard?section=agents' as Route,
              label: 'View agents',
            },
          ].map((item) => (
            <Link
              className="grid min-h-32 gap-2 rounded-lg border border-border/58 bg-card/44 p-5 transition-colors hover:bg-surface/50"
              href={item.href}
              key={item.label}
            >
              <span className="font-display text-xl font-semibold">{item.label}</span>
              <span className="text-sm leading-6 text-muted-foreground">{item.description}</span>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}

async function ActivitySection() {
  const [platformSeries, breakdowns, activityFeed, activityHeatmap] = await Promise.all([
    load(fetchPlatformTimeSeries({ bucket: 'day', range: '30d' })),
    load<BreakdownsResponse>(fetchBreakdowns()),
    load<ActivityFeedResponse>(fetchActivityFeed({ limit: 12 })),
    load<ActivityHeatmapResponse>(fetchActivityHeatmap({ range: '30d', dimension: 'mode' })),
  ]);
  const retryHref = '/dashboard?section=activity' as Route;

  return (
    <div className="grid gap-4 px-4 md:gap-6 lg:px-6">
      {!platformSeries.failed ? (
        <DashboardActivityChart initialData={platformSeries.data} initialRange="30d" />
      ) : (
        <DashboardLoadError retryHref={retryHref}>
          Could not load marketplace activity trend.
        </DashboardLoadError>
      )}
      {!activityHeatmap.failed ? (
        <DashboardHeatmap
          initialData={activityHeatmap.data}
          initialDimension="mode"
          initialRange="30d"
        />
      ) : (
        <DashboardLoadError retryHref={retryHref}>
          Could not load the marketplace activity heat map.
        </DashboardLoadError>
      )}
      <div className="grid gap-4 md:gap-6 @4xl/main:h-[34rem] @4xl/main:grid-cols-[minmax(0,1fr)_360px]">
        {!breakdowns.failed ? (
          <DashboardDistributionChart initialData={breakdowns.data} />
        ) : (
          <DashboardLoadError retryHref={retryHref}>
            Could not load the task distribution.
          </DashboardLoadError>
        )}
        {!activityFeed.failed ? (
          <DashboardActivityFeed initialData={activityFeed.data} />
        ) : (
          <DashboardLoadError retryHref={retryHref}>
            Could not load recent marketplace activity.
          </DashboardLoadError>
        )}
      </div>
    </div>
  );
}

async function TasksSection() {
  const tasks = await load(fetchTasks({ limit: 6 }));

  return (
    <section className="grid gap-4 px-4 lg:px-6">
      <SectionHeading
        action={
          <Button asChild variant="outline">
            <Link href="/dashboard/tasks">View all tasks</Link>
          </Button>
        }
        eyebrow="Tasks"
        title="Latest marketplace work"
      />
      {!tasks.failed ? (
        <TaskTable tasks={tasks.data.tasks} />
      ) : (
        <DashboardLoadError retryHref="/dashboard?section=tasks">
          Could not load the latest tasks.
        </DashboardLoadError>
      )}
    </section>
  );
}

async function AgentsSection() {
  const agents = await load(fetchLeaderboard({ limit: 5, sort: 'reputation' }));

  return (
    <section className="grid gap-4 px-4 lg:px-6">
      <SectionHeading
        action={
          <Button asChild variant="outline">
            <Link href="/dashboard/agents">View all agents</Link>
          </Button>
        }
        eyebrow="Agents"
        title="Top reputation signals"
      />
      {!agents.failed ? (
        <AgentTable agents={agents.data} />
      ) : (
        <DashboardLoadError retryHref="/dashboard?section=agents">
          Could not load reputation leaders.
        </DashboardLoadError>
      )}
    </section>
  );
}

async function renderSection(section: DashboardSection) {
  switch (section) {
    case 'activity':
      return ActivitySection();
    case 'tasks':
      return TasksSection();
    case 'agents':
      return AgentsSection();
    default:
      return OverviewSection();
  }
}

export default async function Page({ searchParams }: DashboardPageProps) {
  const params = await searchParams;
  const section = parseDashboardSection(params.section);
  const content = await renderSection(section);

  return (
    <div className="flex flex-1 flex-col">
      <div className="@container/main flex flex-1 flex-col gap-2">
        <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6">
          <DashboardScope
            marketContent={content}
            marketSection={section}
            marketTitle={SECTION_TITLES[section]}
          />
        </div>
      </div>
    </div>
  );
}

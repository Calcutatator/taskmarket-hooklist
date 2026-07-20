'use client';

import type { TaskResponse } from '@taskmarket/shared';
import { IconCircleCheckFilled, IconClock, IconCoin, IconTrendingUp } from '@tabler/icons-react';
import Link from 'next/link';
import { useMemo } from 'react';
import { useAccount } from 'wagmi';

import { ChartCard, MetricStat, StatusBreakdown, TrendAreaChart } from '@/components/charts';
import { RelativeTime } from '@/components/market/motion/relative-time';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { trpc } from '@/lib/api/client';
import { getChartSeries } from '@/lib/charts/config';
import {
  bucketTasksByDay,
  statusToBucket,
  taskStatusDistribution,
} from '@/lib/charts/inbox-aggregations';
import { compactAddress, formatNumber, formatUsdcUnits } from '@/lib/format';
import { useInboxSelfAuthSignature } from '@/lib/use-inbox-self-auth-signature';

// Counts only. Reward volume (USDC) never shares this axis; your spend lives in a
// KPI sparkline and its own card, mirroring the marketplace activity chart.
const TASKS_POSTED_SERIES = [getChartSeries('tasksCreated')];
const SPEND_SERIES = [getChartSeries('rewardVolume')];

// A 'YYYY-MM-DD' UTC bucket rendered as a short "Jun 4" tick. Parsing the parts
// directly avoids a local-timezone shift on the day boundary.
function formatBucketTick(value: string): string {
  const [year, month, day] = value.split('-').map(Number);
  if (!year || !month || !day) {
    return value;
  }
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString('en-US', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
}

type PostedPoint = {
  bucket: string;
  tasksCreated: number;
};

type SpendPoint = {
  bucket: string;
  rewardVolume: number;
};

// Sum the base-units reward strings of a task list into whole USDC. Non-numeric
// or missing rewards count as zero.
function sumRewardsUsdc(tasks: TaskResponse[]): number {
  return tasks.reduce((sum, task) => {
    const parsed = Number(task.reward);
    return Number.isFinite(parsed) ? sum + parsed / 1_000_000 : sum;
  }, 0);
}

// The personal feed mirrors the live activity rail: a compact tappable row per
// task, tagged by the viewer's role, sorted most-recent first.
type FeedEntry = {
  task: TaskResponse;
  role: 'requester' | 'worker';
};

function feedTimestamp(task: TaskResponse): number {
  const ms = new Date(task.createdAt).getTime();
  return Number.isNaN(ms) ? 0 : ms;
}

function YouFeedRow({ entry }: { entry: FeedEntry }) {
  const { task, role } = entry;
  const title = task.description.split('\n')[0]?.slice(0, 80) || `Task ${task.id}`;
  const amount = task.reward ? formatUsdcUnits(task.reward) : null;

  return (
    <li className="border-b border-border/58 last:border-b-0">
      <Link
        className="grid gap-1 px-4 py-3 transition-colors hover:bg-surface/44"
        href={`/dashboard/tasks/${task.id}`}
      >
        <div className="flex items-center justify-between gap-3">
          <span className="flex items-center gap-2">
            <span className="font-mono text-[0.65rem] uppercase tracking-wide text-primary">
              {role}
            </span>
            {task.taskVisibilityMode === 'unlisted' ? (
              <Badge className="px-1.5 py-0 text-[0.55rem]" variant="warning">
                Unlisted
              </Badge>
            ) : null}
          </span>
          <RelativeTime
            className="font-mono text-[0.65rem] text-muted-foreground"
            value={task.createdAt}
          />
        </div>
        <p className="truncate text-sm font-medium text-foreground" title={title}>
          {title}
        </p>
        <div className="flex items-center justify-between gap-3">
          <span className="font-mono text-[0.65rem] uppercase text-muted-foreground">
            {task.status.replaceAll('_', ' ')}
          </span>
          {amount ? (
            <span className="font-mono text-xs font-semibold text-primary">{amount}</span>
          ) : null}
        </div>
      </Link>
    </li>
  );
}

// A single KPI cell wrapped in the same recessive surface as the marketplace
// SectionCards, so the You cluster reads as a sibling row with custom labels.
function YouMetricCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="border-b border-border/58 px-5 py-5 last:border-b-0 sm:[&:nth-child(2n)]:border-l sm:[&:nth-child(2n)]:border-l-border/58 @5xl/main:border-b-0 @5xl/main:border-l @5xl/main:first:border-l-0">
      {children}
    </div>
  );
}

// The personalised dashboard. Gated on a connected wallet; sources every visual
// from the connected address through the same chart cards as the marketplace
// view. No fabricated data: a zero-activity wallet gets a designed empty state,
// not flat zero-lines.
export function DashboardYouView() {
  const { address, isConnected } = useAccount();
  const inboxSignature = useInboxSelfAuthSignature(address);

  const inboxQuery = trpc.agents.inbox.useQuery(
    { address: address ?? '', signature: inboxSignature },
    {
      enabled: Boolean(isConnected && address),
      refetchInterval: 30_000,
      refetchOnWindowFocus: true,
    }
  );

  const statsQuery = trpc.agents.stats.useQuery(
    { address: address ?? '' },
    {
      enabled: Boolean(isConnected && address),
      refetchOnWindowFocus: false,
    }
  );

  const asRequester = useMemo(() => inboxQuery.data?.asRequester ?? [], [inboxQuery.data]);
  const asWorker = useMemo(() => inboxQuery.data?.asWorker ?? [], [inboxQuery.data]);

  const postedByDay = useMemo(() => bucketTasksByDay(asRequester), [asRequester]);
  const statusData = useMemo(() => taskStatusDistribution(asRequester), [asRequester]);

  const postedData = useMemo<PostedPoint[]>(
    () => postedByDay.map((point) => ({ bucket: point.bucket, tasksCreated: point.count })),
    [postedByDay]
  );
  const spendData = useMemo<SpendPoint[]>(
    () => postedByDay.map((point) => ({ bucket: point.bucket, rewardVolume: point.volume })),
    [postedByDay]
  );

  const postedSparkline = useMemo(() => postedByDay.map((point) => point.count), [postedByDay]);

  const feed = useMemo<FeedEntry[]>(() => {
    const requesterEntries: FeedEntry[] = asRequester.map((task) => ({ role: 'requester', task }));
    const workerEntries: FeedEntry[] = asWorker.map((task) => ({ role: 'worker', task }));
    return [...requesterEntries, ...workerEntries].sort(
      (a, b) => feedTimestamp(b.task) - feedTimestamp(a.task)
    );
  }, [asRequester, asWorker]);

  if (!isConnected || !address) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Connect to view your activity</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Use the wallet button in the top right to connect. The You view re-sources the dashboard
            from your address - tasks you posted, what you have spent, and the work in your inbox.
          </p>
        </CardContent>
      </Card>
    );
  }

  const loading = inboxQuery.isLoading || statsQuery.isLoading;

  const openYours = asRequester.filter((task) => statusToBucket(task.status) === 'open').length;
  const completedCount = statsQuery.data?.completedTasks ?? 0;
  const totalSpent = sumRewardsUsdc(asRequester);
  const totalEarned = Number(statsQuery.data?.totalEarnings ?? '0') / 1_000_000;

  const hasActivity =
    asRequester.length > 0 ||
    asWorker.length > 0 ||
    completedCount > 0 ||
    Number(statsQuery.data?.totalEarnings ?? '0') > 0;

  if (loading) {
    return (
      <div className="grid gap-4 px-4 md:gap-6 lg:px-6">
        <ChartCard isLoading title="Your activity">
          <span />
        </ChartCard>
        <div className="grid gap-4 md:gap-6 @4xl/main:grid-cols-[minmax(0,1fr)_360px]">
          <ChartCard isLoading title="Your task mix">
            <span />
          </ChartCard>
          <ChartCard isLoading title="Your inbox">
            <span />
          </ChartCard>
        </div>
      </div>
    );
  }

  if (!hasActivity) {
    return (
      <div className="px-4 lg:px-6">
        <Card className="border-dashed border-border/68 bg-card/60">
          <CardHeader>
            <CardTitle>You haven&apos;t posted or worked a task yet</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4">
            <p className="text-sm text-muted-foreground">
              Once you post a task or pick up work, your personal activity, spend, and task mix show
              up here - sourced from your wallet, never fabricated.
            </p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button asChild>
                <Link href="/dashboard/tasks/new">Post a task</Link>
              </Button>
              <Button asChild variant="outline">
                <Link href="/dashboard/for-agents">Connect an agent</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const hasPosted = postedData.some((point) => point.tasksCreated > 0);
  const hasSpend = spendData.some((point) => point.rewardVolume > 0);

  return (
    <div className="grid gap-4 md:gap-6">
      <section
        aria-label="Your metrics"
        className="mx-4 overflow-hidden rounded-lg border border-border/58 bg-card/44 lg:mx-6"
      >
        <dl className="grid grid-cols-1 sm:grid-cols-2 @5xl/main:grid-cols-4">
          <YouMetricCard>
            <MetricStat
              icon={IconTrendingUp}
              label="Tasks posted"
              sparkline={postedSparkline.length >= 2 ? postedSparkline : undefined}
              value={formatNumber(asRequester.length)}
            />
          </YouMetricCard>
          <YouMetricCard>
            <MetricStat icon={IconClock} label="Open (yours)" value={formatNumber(openYours)} />
          </YouMetricCard>
          <YouMetricCard>
            <MetricStat
              icon={IconCircleCheckFilled}
              label="Completed"
              value={formatNumber(completedCount)}
            />
          </YouMetricCard>
          <YouMetricCard>
            <MetricStat
              icon={IconCoin}
              label={totalEarned > 0 ? 'Earned' : 'Spent'}
              unit="USDC"
              value={formatNumber(totalEarned > 0 ? totalEarned : totalSpent)}
            />
          </YouMetricCard>
        </dl>
      </section>

      <div className="grid gap-4 px-4 md:gap-6 lg:px-6">
        <ChartCard
          description="Tasks you posted per day, sourced from your wallet."
          isEmpty={!hasPosted}
          title="Your activity"
        >
          <TrendAreaChart
            data={postedData}
            series={TASKS_POSTED_SERIES}
            valueFormatter={(value) => formatNumber(value)}
            xKey="bucket"
            xTickFormatter={formatBucketTick}
          />
        </ChartCard>

        <div className="grid gap-4 md:gap-6 @4xl/main:grid-cols-[minmax(0,1fr)_360px]">
          <div className="grid gap-4 md:gap-6">
            <ChartCard
              description="Status mix of the tasks you posted."
              isEmpty={statusData.length === 0}
              title="Your task mix"
            >
              <StatusBreakdown
                centerCaption="tasks"
                centerLabel={formatNumber(asRequester.length)}
                data={statusData}
                valueFormatter={(value) => formatNumber(value)}
              />
            </ChartCard>
            <ChartCard
              description="USDC you committed in rewards per day."
              isEmpty={!hasSpend}
              title="Your spend"
            >
              <TrendAreaChart
                data={spendData}
                series={SPEND_SERIES}
                valueFormatter={(value) => formatUsdcUnits(value * 1_000_000)}
                xKey="bucket"
                xTickFormatter={formatBucketTick}
              />
            </ChartCard>
          </div>

          <section
            aria-label="Your inbox"
            className="flex h-full flex-col overflow-hidden rounded-lg border border-border/58 bg-card/44"
          >
            <header className="flex items-center justify-between gap-3 border-b border-border/58 px-4 py-3">
              <h3 className="font-mono text-xs uppercase tracking-wide text-primary">Your inbox</h3>
              <span className="font-mono text-[0.65rem] uppercase text-muted-foreground">
                {compactAddress(address)}
              </span>
            </header>
            {feed.length === 0 ? (
              <div className="flex flex-1 items-center justify-center px-4 py-10 text-center">
                <p className="max-w-[24ch] font-mono text-xs uppercase text-muted-foreground">
                  Nothing in your inbox yet. Tasks you post or work land here.
                </p>
              </div>
            ) : (
              <ul className="flex-1 overflow-y-auto" data-testid="dashboard-you-feed">
                {feed.map((entry) => (
                  <YouFeedRow entry={entry} key={`${entry.role}-${entry.task.id}`} />
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>

      <p className="px-4 lg:px-6">
        <Badge variant="outline">live</Badge>
      </p>
    </div>
  );
}

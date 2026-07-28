'use client';

import type { PlatformTimeSeriesResponse, TimeRange } from '@taskmarket/shared';
import { useState } from 'react';

import { ChartCard, RangeToggle, TrendAreaChart } from '@/components/charts';
import { getChartSeries } from '@/lib/charts/config';
import { trpc } from '@/lib/api/client';
import { formatNumber } from '@/lib/format';

type SeriesPoint = {
  bucket: string;
  tasksCreated: number;
  completedTasks: number;
};

// Counts only. Reward volume is USDC and lives in its own KPI sparkline, so it
// never shares this axis. The two count series share one scale by construction.
const SERIES = [getChartSeries('tasksCreated'), getChartSeries('completedTasks')];

const RANGE_OPTIONS = [
  { value: '7d', label: 'Last 7 days', shortLabel: '7d' },
  { value: '30d', label: 'Last 30 days', shortLabel: '30d' },
  { value: '90d', label: 'Last 90 days', shortLabel: '90d' },
];

// A 'YYYY-MM-DD' UTC bucket rendered as a short "Jun 4" style tick. Parsing the
// date parts directly avoids a local-timezone shift on the day boundary.
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

function toChartData(series: PlatformTimeSeriesResponse): SeriesPoint[] {
  return series.map((point) => ({
    bucket: point.bucket,
    completedTasks: point.completedTasks,
    tasksCreated: point.tasksCreated,
  }));
}

// The hero trend for the dashboard: tasks created vs completed per day, seeded
// from the SSR 30d snapshot and refreshed every thirty seconds. The range toggle
// swaps the window client-side; an outage at render time degrades to the empty
// or error state inside ChartCard.
export function DashboardActivityChart({
  initialData,
  initialRange = '30d',
}: {
  initialData: PlatformTimeSeriesResponse;
  initialRange?: TimeRange;
}) {
  const [range, setRange] = useState<TimeRange>(initialRange);

  const query = trpc.stats.platformTimeSeries.useQuery(
    { bucket: 'day', range },
    {
      initialData: range === initialRange ? initialData : undefined,
      refetchInterval: 30_000,
      refetchOnWindowFocus: true,
    }
  );

  const series = query.data ?? [];
  const chartData = toChartData(series);
  const hasData = chartData.some((point) => point.tasksCreated > 0 || point.completedTasks > 0);

  return (
    <ChartCard
      action={
        <RangeToggle
          onValueChange={(next) => setRange(next as TimeRange)}
          options={RANGE_OPTIONS}
          value={range}
        />
      }
      description="Tasks created and completed per day across the marketplace."
      errorMessage={query.isError ? 'Could not load marketplace activity.' : undefined}
      isEmpty={!query.isLoading && !hasData}
      isLoading={query.isLoading && chartData.length === 0}
      liveUpdatedAt={query.dataUpdatedAt ? new Date(query.dataUpdatedAt) : undefined}
      title="Marketplace activity"
    >
      <TrendAreaChart
        ariaLabel="Marketplace activity trend"
        animate={false}
        data={chartData}
        series={SERIES}
        valueFormatter={(value) => formatNumber(value)}
        xKey="bucket"
        xTickFormatter={formatBucketTick}
      />
    </ChartCard>
  );
}

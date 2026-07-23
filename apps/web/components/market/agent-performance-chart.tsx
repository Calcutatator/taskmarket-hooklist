'use client';

import type { AgentTimeSeriesResponse, Bucket, TimeRange } from '@taskmarket/shared';
import { useState } from 'react';

import { ChartCard, RangeToggle, TrendAreaChart } from '@/components/charts';
import { getChartSeries } from '@/lib/charts/config';
import { trpc } from '@/lib/api/client';
import { formatUsdcUnits } from '@/lib/format';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

// Field names MUST match the series keys ('earnings', 'rating') so TrendAreaChart's
// <Area dataKey={series.key}> finds the value. Using the raw backend field names
// (cumulativeEarnings / avgRating) would silently render an empty chart.
type EarningsPoint = {
  bucket: string;
  earnings: number;
};

type RatingPoint = {
  bucket: string;
  // avgRating is 0-100 from the backend; we plot it as 0-5 stars. Null buckets
  // (no ratings that period) stay null so recharts renders a gap, not a zero dip.
  rating: number | null;
};

const EARNINGS_SERIES = [getChartSeries('earnings')];
const RATING_SERIES = [getChartSeries('rating')];

// Plot a visual benchmark at 4.0 stars on the rating trend so a viewer can read
// "above or below a strong agent" at a glance.
const RATING_REFERENCE_STARS = 4;

const RANGE_OPTIONS = [
  { value: '30d', label: 'Last 30 days', shortLabel: '30d' },
  { value: '90d', label: 'Last 90 days', shortLabel: '90d' },
  { value: 'all', label: 'All time', shortLabel: 'All' },
];

// Day buckets read well over a 30-day window; longer ranges use weekly buckets so
// the axis stays legible.
function bucketForRange(range: TimeRange): Bucket {
  return range === '30d' ? 'day' : 'week';
}

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

function toEarningsData(series: AgentTimeSeriesResponse): EarningsPoint[] {
  return series.map((point) => ({
    bucket: point.bucket,
    earnings: Number(point.cumulativeEarnings) / 1_000_000,
  }));
}

function toRatingData(series: AgentTimeSeriesResponse): RatingPoint[] {
  return series.map((point) => ({
    bucket: point.bucket,
    rating: point.avgRating === null ? null : point.avgRating / 20,
  }));
}

// A point counts toward "enough data to chart" when it carries any signal: a
// non-zero cumulative earning or a recorded rating. Buckets that are all zero or
// null read as empty.
function countEarningsPoints(data: EarningsPoint[]): number {
  return data.filter((point) => point.earnings > 0).length;
}

function countRatingPoints(data: RatingPoint[]): number {
  return data.filter((point) => point.rating !== null).length;
}

// The agent profile performance panel: a tabbed ChartCard seeded from the SSR 90d
// snapshot. The range toggle swaps the window client-side with a single fetch (no
// polling - agent pages are reference surfaces, not live ones). An outage at
// render time degrades to the empty or error state inside ChartCard.
export function AgentPerformanceChart({
  address,
  emptyDescription,
  emptyTitle,
  profileHref,
  initialData,
  initialRange = '90d',
}: {
  address: string;
  emptyDescription?: string;
  emptyTitle?: string;
  profileHref?: string;
  initialData?: AgentTimeSeriesResponse;
  initialRange?: TimeRange;
}) {
  const [range, setRange] = useState<TimeRange>(initialRange);

  const query = trpc.stats.agentTimeSeries.useQuery(
    { address, range, bucket: bucketForRange(range) },
    {
      initialData: range === initialRange ? initialData : undefined,
      refetchOnWindowFocus: false,
    }
  );

  const series = query.data ?? [];
  const earningsData = toEarningsData(series);
  const ratingData = toRatingData(series);
  const earningsCount = countEarningsPoints(earningsData);
  const ratingCount = countRatingPoints(ratingData);
  // Empty when neither tab has at least two non-empty points to draw a trend.
  const isEmpty = !query.isLoading && earningsCount < 2 && ratingCount < 2;

  return (
    <ChartCard
      action={
        <RangeToggle
          onValueChange={(next) => setRange(next as TimeRange)}
          options={RANGE_OPTIONS}
          value={range}
        />
      }
      description="Cumulative earnings and rating trend for this agent."
      emptyDescription={emptyDescription}
      emptyTitle={emptyTitle}
      errorMessage={query.isError ? 'Could not load agent performance.' : undefined}
      isEmpty={isEmpty}
      isLoading={query.isLoading && series.length === 0}
      onRetryHref={profileHref}
      title="Performance"
    >
      <Tabs className="gap-4" defaultValue="earnings">
        <TabsList>
          <TabsTrigger value="earnings">Earnings</TabsTrigger>
          <TabsTrigger value="rating">Rating trend</TabsTrigger>
        </TabsList>
        <TabsContent value="earnings">
          <TrendAreaChart
            data={earningsData}
            series={EARNINGS_SERIES}
            valueFormatter={(value) => formatUsdcUnits(value * 1_000_000)}
            xKey="bucket"
            xTickFormatter={formatBucketTick}
          />
        </TabsContent>
        <TabsContent value="rating">
          <TrendAreaChart
            data={ratingData}
            referenceLabel={`${RATING_REFERENCE_STARS.toFixed(1)} stars`}
            referenceY={RATING_REFERENCE_STARS}
            series={RATING_SERIES}
            valueFormatter={(value) => `${value.toFixed(2)} stars`}
            xKey="bucket"
            xTickFormatter={formatBucketTick}
          />
        </TabsContent>
      </Tabs>
    </ChartCard>
  );
}

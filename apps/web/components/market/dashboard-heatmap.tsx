'use client';

import type { ActivityHeatmapResponse, HeatmapDimension, TimeRange } from '@taskmarket/shared';
import { useState } from 'react';

import { ChartCard, RangeToggle } from '@/components/charts';
import { HeatmapGrid } from '@/components/charts/heatmap-grid';
import { trpc } from '@/lib/api/client';

const RANGE_OPTIONS = [
  { value: '7d', label: 'Last 7 days', shortLabel: '7d' },
  { value: '30d', label: 'Last 30 days', shortLabel: '30d' },
  { value: '90d', label: 'Last 90 days', shortLabel: '90d' },
];

const DIMENSION_OPTIONS: { value: HeatmapDimension; label: string }[] = [
  { value: 'mode', label: 'By mode' },
  { value: 'hourOfWeek', label: 'By hour' },
];

// Axis captions follow the active dimension: mode rows are task modes mapped over
// dates; hour-of-week rows are weekdays mapped over the hour columns.
const AXIS_LABELS: Record<HeatmapDimension, { row: string; col: string }> = {
  mode: { row: 'Mode', col: 'Date' },
  hourOfWeek: { row: 'Day', col: 'Hour' },
};

// The heat map body is row-count driven, not a fixed-height chart, so the loading
// placeholder is sized from the rows we expect rather than the generic chart
// height. One row is a min-h-7 cell plus the 4px grid gap; the chrome is the
// column header row plus the legend strip below the grid.
const ROW_HEIGHT = 32;
const GRID_CHROME_HEIGHT = 46;
// Below sm the grid is replaced by a summary list of up to six cells, each a
// two-line row on a 8px gap.
const MOBILE_HEIGHT = 352;
const HOUR_OF_WEEK_ROWS = 7;

function gridHeight(rowCount: number): number {
  return Math.max(rowCount, 1) * ROW_HEIGHT + GRID_CHROME_HEIGHT;
}

// The dashboard heat map: live market activity bucketed across two dimensions and
// rendered on the warm rose ramp that mirrors the Taskmarket brand mark. Seeds
// from the SSR snapshot and refreshes every thirty seconds, aligned with the
// activity trend chart. The range and dimension toggles swap the window and the
// pairing client-side; an outage at render time degrades to the empty or error
// state inside ChartCard.
export function DashboardHeatmap({
  initialData,
  initialRange = '30d',
  initialDimension = 'mode',
}: {
  initialData: ActivityHeatmapResponse;
  initialRange?: TimeRange;
  initialDimension?: HeatmapDimension;
}) {
  const [range, setRange] = useState<TimeRange>(initialRange);
  const [dimension, setDimension] = useState<HeatmapDimension>(initialDimension);

  const query = trpc.stats.activityHeatmap.useQuery(
    { range, dimension },
    {
      initialData:
        range === initialRange && dimension === initialDimension ? initialData : undefined,
      refetchInterval: 30_000,
      refetchOnWindowFocus: true,
    }
  );

  const data = query.data ?? { rowKeys: [], colKeys: [], cells: [], maxCount: 0 };
  const hasData = data.rowKeys.length > 0 && data.colKeys.length > 0;
  const labels = AXIS_LABELS[dimension];
  // While a range or dimension switch is in flight there are no rows yet, so fall
  // back to what the dimension implies: seven weekdays for hour-of-week, the SSR
  // snapshot's mode rows otherwise (the mode set barely moves with the range).
  const expectedRows =
    dimension === 'hourOfWeek'
      ? HOUR_OF_WEEK_ROWS
      : Math.max(data.rowKeys.length, initialData.rowKeys.length);

  return (
    <ChartCard
      action={
        <div className="flex flex-wrap items-center gap-2">
          <RangeToggle
            ariaLabel="Heat map dimension"
            onValueChange={(next) => setDimension(next as HeatmapDimension)}
            options={DIMENSION_OPTIONS}
            value={dimension}
          />
          <RangeToggle
            onValueChange={(next) => setRange(next as TimeRange)}
            options={RANGE_OPTIONS}
            value={range}
          />
        </div>
      }
      description={`Live market activity by ${labels.row.toLowerCase()} and ${labels.col.toLowerCase()}, refreshed every 30 seconds.`}
      errorMessage={query.isError ? 'Could not load the activity heat map.' : undefined}
      height={gridHeight(expectedRows)}
      isEmpty={!query.isLoading && !hasData}
      isLoading={query.isLoading && !hasData}
      liveUpdatedAt={query.dataUpdatedAt ? new Date(query.dataUpdatedAt) : undefined}
      mobileHeight={MOBILE_HEIGHT}
      title="Activity heat map"
    >
      <HeatmapGrid colLabel={labels.col} data={data} rowLabel={labels.row} />
    </ChartCard>
  );
}

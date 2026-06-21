'use client';

import type { ActivityHeatmapResponse, HeatmapDimension, TimeRange } from '@taskmarket/shared';
import { useState } from 'react';

import { ChartCard, RangeToggle } from '@/components/charts';
import { HeatmapGrid } from '@/components/charts/heatmap-grid';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
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

  return (
    <ChartCard
      action={
        <div className="flex flex-wrap items-center gap-2">
          <ToggleGroup
            type="single"
            value={dimension}
            onValueChange={(next) => {
              if (next) {
                setDimension(next as HeatmapDimension);
              }
            }}
            variant="outline"
            aria-label="Heat map dimension"
          >
            {DIMENSION_OPTIONS.map((option) => (
              <ToggleGroupItem key={option.value} value={option.value} className="px-3">
                {option.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <RangeToggle
            onValueChange={(next) => setRange(next as TimeRange)}
            options={RANGE_OPTIONS}
            value={range}
          />
        </div>
      }
      description="Live market activity mapped across the marketplace, refreshed every 30 seconds."
      errorMessage={query.isError ? 'Could not load the activity heat map.' : undefined}
      isEmpty={!query.isLoading && !hasData}
      isLoading={query.isLoading && !hasData}
      liveUpdatedAt={query.dataUpdatedAt ? new Date(query.dataUpdatedAt) : undefined}
      title="Activity heat map"
    >
      <HeatmapGrid colLabel={labels.col} data={data} rowLabel={labels.row} />
    </ChartCard>
  );
}

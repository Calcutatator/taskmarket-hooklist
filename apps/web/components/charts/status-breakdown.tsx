'use client';

import { useMemo } from 'react';

import { AccessibleChartTable } from '@/components/charts/accessible-chart-table';
import {
  buildChartConfig,
  statusColor,
  type TaskStatusBucket,
} from '@/components/charts/chart-palette';
import { BlockLegend } from '@/components/dither-kit/block-legend';
import type { ChartConfig } from '@/components/dither-kit/chart-context';
import { Pie } from '@/components/dither-kit/pie';
import { PieChart } from '@/components/dither-kit/pie-chart';
import { Tooltip } from '@/components/dither-kit/tooltip';
import { useMotionDisabled } from '@/components/market/motion/use-motion-disabled';
import { cn } from '@/lib/utils';

const DEFAULT_HEIGHT = 250;
const MAX_BUCKETS = 6;

export type StatusDatum = {
  bucket: TaskStatusBucket;
  label: string;
  value: number;
};

export type StatusBreakdownProps = {
  ariaLabel: string;
  data: StatusDatum[];
  height?: number;
  centerLabel?: string;
  centerCaption?: string;
  hideLegend?: boolean;
  valueFormatter?: (value: number) => string;
  className?: string;
};

export function StatusBreakdown({
  ariaLabel,
  data,
  height = DEFAULT_HEIGHT,
  centerLabel,
  centerCaption,
  hideLegend,
  valueFormatter,
  className,
}: StatusBreakdownProps) {
  const motionDisabled = useMotionDisabled();
  const buckets = useMemo(() => data.slice(0, MAX_BUCKETS), [data]);

  if (data.length > MAX_BUCKETS) {
    console.warn(
      `StatusBreakdown supports at most ${MAX_BUCKETS} buckets; received ${data.length}. Extra buckets are ignored.`
    );
  }

  const config = useMemo<ChartConfig>(
    () =>
      buildChartConfig(
        buckets.map((entry) => ({
          key: entry.bucket,
          label: entry.label,
          color: statusColor(entry.bucket),
        }))
      ),
    [buckets]
  );
  const values = Object.fromEntries(buckets.map((entry) => [entry.bucket, entry.value]));

  return (
    <div className={cn('w-full', className)}>
      {/* `w-full`, not `mx-auto`: an auto inline margin overrides a grid item's
          default stretch, collapsing the donut to zero width. The canvas centres
          itself from the measured plot rect, so no outer centring is needed. */}
      <div className="relative w-full" style={{ height }}>
        <PieChart
          ariaLabel={ariaLabel}
          data={buckets}
          config={config}
          dataKey="value"
          nameKey="bucket"
          innerRadius={0.55}
          animate={!motionDisabled}
          valueFormatter={valueFormatter ? (value) => valueFormatter(value) : undefined}
        >
          <Pie />
          <Tooltip valueFormatter={valueFormatter ? (value) => valueFormatter(value) : undefined} />
        </PieChart>
        {centerLabel ? (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center"
          >
            <span className="font-mono text-2xl font-semibold text-foreground tabular-nums">
              {centerLabel}
            </span>
            {centerCaption ? (
              <span className="text-xs text-muted-foreground">{centerCaption}</span>
            ) : null}
          </div>
        ) : null}
      </div>
      {hideLegend ? null : (
        <BlockLegend
          config={config}
          values={values}
          valueFormatter={valueFormatter}
          align="center"
          className="mt-2"
        />
      )}
      <AccessibleChartTable
        ariaLabel={ariaLabel}
        data={buckets}
        xKey="label"
        series={[{ key: 'value', label: 'Count' }]}
        valueFormatter={valueFormatter}
      />
    </div>
  );
}

'use client';

import { useMemo } from 'react';

import { AccessibleChartTable } from '@/components/charts/accessible-chart-table';
import {
  buildChartConfig,
  statusColor,
  type TaskStatusBucket,
} from '@/components/charts/chart-palette';
import { BarChart, StackedBarChart } from '@/components/charts/bar-chart';
import { BlockLegend } from '@/components/dither-kit/block-legend';
import type { ChartConfig as DitherChartConfig } from '@/components/dither-kit/chart-context';
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

  const config = useMemo<DitherChartConfig>(
    () =>
      buildChartConfig(
        buckets.map((entry) => ({
          key: entry.bucket,
          label: entry.label,
          color: statusColor(entry.bucket),
        }))
      ) as DitherChartConfig,
    [buckets]
  );
  const values = Object.fromEntries(buckets.map((entry) => [entry.bucket, entry.value]));

  return (
    <div className={cn('mx-auto', className)}>
      <div className="relative mx-auto" style={{ height }}>
        <PieChart
          ariaLabel={ariaLabel}
          data={buckets}
          config={config}
          dataKey="value"
          nameKey="bucket"
          innerRadius={0.55}
          animate={!motionDisabled}
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

export type DistributionDatum = {
  label: string;
} & Record<string, string | number>;

export type DistributionBarsProps = {
  ariaLabel?: string;
  data: DistributionDatum[];
  series: { key: string; label: string; color?: string }[];
  height?: number;
  grouped?: boolean;
  valueFormatter?: (value: number) => string;
  className?: string;
};

export function DistributionBars({
  ariaLabel = 'Distribution',
  data,
  series,
  height = DEFAULT_HEIGHT,
  grouped,
  valueFormatter,
  className,
}: DistributionBarsProps) {
  if (grouped) {
    return (
      <DistributionGrouped
        ariaLabel={ariaLabel}
        data={data}
        series={series}
        height={height}
        valueFormatter={valueFormatter}
        className={className}
      />
    );
  }

  return (
    <StackedBarChart
      ariaLabel={ariaLabel}
      data={data}
      xKey="label"
      series={series}
      height={height}
      layout="vertical"
      valueFormatter={valueFormatter}
      className={className}
    />
  );
}

function DistributionGrouped({
  ariaLabel,
  data,
  series,
  height,
  valueFormatter,
  className,
}: Omit<DistributionBarsProps, 'grouped'>) {
  return (
    <BarChart
      ariaLabel={ariaLabel}
      data={data}
      xKey="label"
      series={series}
      height={height}
      layout="vertical"
      valueFormatter={valueFormatter}
      className={className}
    />
  );
}

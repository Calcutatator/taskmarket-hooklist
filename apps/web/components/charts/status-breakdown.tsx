'use client';

import { useMemo } from 'react';
import { Cell, Label, Pie, PieChart } from 'recharts';

import { useMotionDisabled } from '@/components/market/motion/use-motion-disabled';
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart';
import {
  buildChartConfig,
  statusColor,
  type TaskStatusBucket,
} from '@/components/charts/chart-palette';
import { BarChart, StackedBarChart } from '@/components/charts/bar-chart';
import { cn } from '@/lib/utils';

const DEFAULT_HEIGHT = 250;
const MAX_BUCKETS = 6;

export type StatusDatum = {
  bucket: TaskStatusBucket;
  label: string;
  value: number;
};

export type StatusBreakdownProps = {
  data: StatusDatum[];
  height?: number;
  centerLabel?: string;
  centerCaption?: string;
  hideLegend?: boolean;
  valueFormatter?: (value: number) => string;
  className?: string;
};

// A status donut. Each slice is coloured by its status bucket so the chart reads
// the same as the status badges. Caps at six buckets to stay scannable, draws an
// optional centre label/caption, and shows a legend unless suppressed.
export function StatusBreakdown({
  data,
  height = DEFAULT_HEIGHT,
  centerLabel,
  centerCaption,
  hideLegend,
  valueFormatter,
  className,
}: StatusBreakdownProps) {
  const motionDisabled = useMotionDisabled();

  const buckets = data.slice(0, MAX_BUCKETS);
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

  return (
    <ChartContainer
      config={config}
      className={cn('mx-auto aspect-square', className)}
      style={{ height }}
    >
      <PieChart>
        <ChartTooltip
          cursor={false}
          content={
            <ChartTooltipContent
              hideLabel
              nameKey="bucket"
              formatter={
                valueFormatter
                  ? (value) => (typeof value === 'number' ? valueFormatter(value) : String(value))
                  : undefined
              }
            />
          }
        />
        <Pie
          data={buckets}
          dataKey="value"
          nameKey="bucket"
          innerRadius={60}
          strokeWidth={2}
          isAnimationActive={!motionDisabled}
        >
          {buckets.map((entry) => (
            <Cell key={entry.bucket} fill={statusColor(entry.bucket)} />
          ))}
          {centerLabel ? (
            <Label
              content={({ viewBox }) => {
                if (!viewBox || !('cx' in viewBox) || !('cy' in viewBox)) {
                  return null;
                }
                return (
                  <text x={viewBox.cx} y={viewBox.cy} textAnchor="middle" dominantBaseline="middle">
                    <tspan
                      x={viewBox.cx}
                      y={viewBox.cy}
                      className="fill-foreground font-mono text-2xl font-semibold tabular-nums"
                    >
                      {centerLabel}
                    </tspan>
                    {centerCaption ? (
                      <tspan
                        x={viewBox.cx}
                        y={(viewBox.cy ?? 0) + 20}
                        className="fill-muted-foreground text-xs"
                      >
                        {centerCaption}
                      </tspan>
                    ) : null}
                  </text>
                );
              }}
            />
          ) : null}
        </Pie>
        {hideLegend ? null : (
          <ChartLegend content={<ChartLegendContent nameKey="bucket" />} className="flex-wrap" />
        )}
      </PieChart>
    </ChartContainer>
  );
}

export type DistributionDatum = {
  label: string;
} & Record<string, string | number>;

export type DistributionBarsProps = {
  data: DistributionDatum[];
  series: { key: string; label: string; color?: string }[];
  height?: number;
  grouped?: boolean;
  valueFormatter?: (value: number) => string;
  className?: string;
};

// A horizontal status or mode mix: one row per label, segments stacked (default)
// or grouped. Thin wrapper over the bar chart with a vertical layout so the
// distribution reads left to right.
export function DistributionBars({
  data,
  series,
  height = DEFAULT_HEIGHT,
  grouped,
  valueFormatter,
  className,
}: DistributionBarsProps) {
  if (grouped) {
    // Grouped variant: render each series side by side rather than stacked.
    return (
      <DistributionGrouped
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
  data,
  series,
  height,
  valueFormatter,
  className,
}: Omit<DistributionBarsProps, 'grouped'>) {
  return (
    <BarChart
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

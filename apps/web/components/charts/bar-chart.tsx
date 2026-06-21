'use client';

import { useMemo } from 'react';
import { Bar, BarChart as RechartsBarChart, CartesianGrid, XAxis, YAxis } from 'recharts';
import type { DataKey } from 'recharts/types/util/types';

import { useMotionDisabled } from '@/components/market/motion/use-motion-disabled';
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from '@/components/ui/chart';
import { buildChartConfig, CHART_SERIES_COLORS } from '@/components/charts/chart-palette';
import { cn } from '@/lib/utils';

const DEFAULT_HEIGHT = 250;
const DEFAULT_RADIUS = 4;

export type BarSeries = {
  key: string;
  label: string;
  color?: string;
};

export type BarChartProps<T extends Record<string, unknown>> = {
  data: T[];
  xKey: keyof T & string;
  series: BarSeries[];
  height?: number;
  layout?: 'vertical' | 'horizontal';
  radius?: number;
  stacked?: boolean;
  xTickFormatter?: (value: string) => string;
  valueFormatter?: (value: number) => string;
  className?: string;
};

function BarChartBase<T extends Record<string, unknown>>({
  data,
  xKey,
  series,
  height = DEFAULT_HEIGHT,
  layout = 'horizontal',
  radius = DEFAULT_RADIUS,
  stacked,
  xTickFormatter,
  valueFormatter,
  className,
}: BarChartProps<T>) {
  const motionDisabled = useMotionDisabled();
  const config = useMemo(() => buildChartConfig(series), [series]);
  const showLegend = series.length >= 2;
  const isVertical = layout === 'vertical';

  return (
    <ChartContainer
      config={config}
      className={cn('aspect-auto w-full', className)}
      style={{ height }}
    >
      <RechartsBarChart data={data} layout={layout}>
        <CartesianGrid vertical={isVertical} horizontal={!isVertical} />
        {isVertical ? (
          <>
            <XAxis type="number" tickLine={false} axisLine={false} hide />
            <YAxis
              type="category"
              dataKey={xKey as DataKey<T>}
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              width={96}
              tickFormatter={xTickFormatter}
            />
          </>
        ) : (
          <XAxis
            dataKey={xKey as DataKey<T>}
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            minTickGap={16}
            tickFormatter={xTickFormatter}
          />
        )}
        <ChartTooltip
          cursor={false}
          content={
            <ChartTooltipContent
              indicator="dot"
              formatter={
                valueFormatter
                  ? (value) => (typeof value === 'number' ? valueFormatter(value) : String(value))
                  : undefined
              }
            />
          }
        />
        {series.map((entry) => (
          <Bar
            key={entry.key}
            dataKey={entry.key}
            fill={`var(--color-${entry.key})`}
            stackId={stacked ? 'stack' : undefined}
            radius={radius}
            isAnimationActive={!motionDisabled}
          />
        ))}
        {showLegend ? <ChartLegend content={<ChartLegendContent />} /> : null}
      </RechartsBarChart>
    </ChartContainer>
  );
}

// A grouped or single-series bar chart with minimal axes.
export function BarChart<T extends Record<string, unknown>>(props: BarChartProps<T>) {
  return <BarChartBase {...props} />;
}

// A bar chart with series stacked on a shared axis. Forces stacked on so callers
// do not have to remember the flag.
export function StackedBarChart<T extends Record<string, unknown>>(
  props: Omit<BarChartProps<T>, 'stacked'>
) {
  return <BarChartBase {...props} stacked />;
}

export type HistogramBarsProps = {
  data: { label: string; value: number }[];
  height?: number;
  radius?: number;
  color?: string;
  valueFormatter?: (value: number) => string;
  className?: string;
};

// A single-series distribution chart for pre-bucketed counts: each entry is one
// bar. Use this for frequency histograms where the bucketing is done upstream.
export function HistogramBars({
  data,
  height = DEFAULT_HEIGHT,
  radius = DEFAULT_RADIUS,
  color = CHART_SERIES_COLORS[0],
  valueFormatter,
  className,
}: HistogramBarsProps) {
  return (
    <BarChartBase
      data={data}
      xKey="label"
      series={[{ key: 'value', label: 'Count', color }]}
      height={height}
      radius={radius}
      valueFormatter={valueFormatter}
      className={className}
    />
  );
}

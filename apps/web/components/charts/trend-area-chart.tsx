'use client';

import { useMemo } from 'react';
import { Area, AreaChart, CartesianGrid, ReferenceLine, XAxis } from 'recharts';
import type { CurveType } from 'recharts/types/shape/Curve';
import type { DataKey } from 'recharts/types/util/types';

import { useHydrationSafeMotionDisabled } from '@/components/market/motion/use-motion-disabled';
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from '@/components/ui/chart';
import { buildChartConfig } from '@/components/charts/chart-palette';
import { cn } from '@/lib/utils';

const DEFAULT_HEIGHT = 250;
const MAX_SERIES = 3;

export type TrendSeries = {
  key: string;
  label: string;
  color?: string;
};

export type TrendAreaChartProps<T extends Record<string, unknown>> = {
  data: T[];
  xKey: keyof T & string;
  series: TrendSeries[];
  animate?: boolean;
  height?: number;
  xTickFormatter?: (value: string) => string;
  valueFormatter?: (value: number) => string;
  stacked?: boolean;
  curve?: CurveType;
  referenceY?: number;
  referenceLabel?: string;
  className?: string;
};

// A gradient-filled area trend built on the shadcn ChartContainer. Hides the Y
// axis by convention (the tooltip carries the value), shows a legend only when
// there is more than one series, and gates animation on reduced motion. Each
// series gets its own vertical linear gradient keyed by series key. Pass an
// optional referenceY to draw a dashed horizontal benchmark line (for example a
// target rating); omit it and the chart renders exactly as before.
export function TrendAreaChart<T extends Record<string, unknown>>({
  data,
  xKey,
  series,
  animate = true,
  height = DEFAULT_HEIGHT,
  xTickFormatter,
  valueFormatter,
  stacked,
  curve = 'natural',
  referenceY,
  referenceLabel,
  className,
}: TrendAreaChartProps<T>) {
  const motionDisabled = useHydrationSafeMotionDisabled();

  const visibleSeries = series.slice(0, MAX_SERIES);
  if (series.length > MAX_SERIES) {
    console.warn(
      `TrendAreaChart supports at most ${MAX_SERIES} series; received ${series.length}. Extra series are ignored.`
    );
  }

  const config = useMemo(() => buildChartConfig(visibleSeries), [visibleSeries]);
  const showLegend = visibleSeries.length >= 2;

  return (
    <ChartContainer
      config={config}
      className={cn('aspect-auto w-full', className)}
      style={{ height }}
    >
      <AreaChart data={data}>
        <defs>
          {visibleSeries.map((entry) => (
            <linearGradient key={entry.key} id={`fill-${entry.key}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={`var(--color-${entry.key})`} stopOpacity={0.9} />
              <stop offset="95%" stopColor={`var(--color-${entry.key})`} stopOpacity={0.1} />
            </linearGradient>
          ))}
        </defs>
        <CartesianGrid vertical={false} />
        {typeof referenceY === 'number' ? (
          <ReferenceLine
            y={referenceY}
            stroke="var(--border)"
            strokeDasharray="4 4"
            label={
              referenceLabel
                ? {
                    value: referenceLabel,
                    position: 'insideTopRight',
                    className: 'fill-muted-foreground text-[0.65rem]',
                  }
                : undefined
            }
          />
        ) : null}
        <XAxis
          dataKey={xKey as DataKey<T>}
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          minTickGap={32}
          tickFormatter={xTickFormatter}
        />
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
        {visibleSeries.map((entry) => (
          <Area
            key={entry.key}
            dataKey={entry.key}
            type={curve}
            fill={`url(#fill-${entry.key})`}
            stroke={`var(--color-${entry.key})`}
            stackId={stacked ? 'stack' : undefined}
            isAnimationActive={animate && !motionDisabled}
          />
        ))}
        {showLegend ? <ChartLegend content={<ChartLegendContent />} /> : null}
      </AreaChart>
    </ChartContainer>
  );
}

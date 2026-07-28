'use client';

import { useMemo } from 'react';
import {
  Area as RechartsArea,
  AreaChart as RechartsAreaChart,
  CartesianGrid,
  ReferenceLine as RechartsReferenceLine,
  XAxis as RechartsXAxis,
} from 'recharts';
import type { CurveType } from 'recharts/types/shape/Curve';
import type { DataKey } from 'recharts/types/util/types';

import { AccessibleChartTable } from '@/components/charts/accessible-chart-table';
import { buildChartConfig } from '@/components/charts/chart-palette';
import { Area } from '@/components/dither-kit/area';
import { AreaChart } from '@/components/dither-kit/area-chart';
import type { ChartConfig as DitherChartConfig } from '@/components/dither-kit/chart-context';
import { Grid } from '@/components/dither-kit/grid';
import { Legend } from '@/components/dither-kit/legend';
import { ReferenceLine } from '@/components/dither-kit/reference-line';
import { Tooltip } from '@/components/dither-kit/tooltip';
import { XAxis } from '@/components/dither-kit/x-axis';
import { useHydrationSafeMotionDisabled } from '@/components/market/motion/use-motion-disabled';
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from '@/components/ui/chart';
import { cn } from '@/lib/utils';

const DEFAULT_HEIGHT = 250;
const MAX_SERIES = 3;

export type TrendSeries = {
  key: string;
  label: string;
  color?: string;
};

export type TrendAreaChartProps<T extends Record<string, unknown>> = {
  ariaLabel: string;
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

export function TrendAreaChart<T extends Record<string, unknown>>({
  ariaLabel,
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
  const visibleSeries = useMemo(() => series.slice(0, MAX_SERIES), [series]);

  if (series.length > MAX_SERIES) {
    console.warn(
      `TrendAreaChart supports at most ${MAX_SERIES} series; received ${series.length}. Extra series are ignored.`
    );
  }

  const config = useMemo(() => buildChartConfig(visibleSeries), [visibleSeries]);
  const ditherConfig = config as DitherChartConfig;
  const hasDataGaps = data.some((row) =>
    visibleSeries.some((entry) => {
      const value = row[entry.key];
      return typeof value !== 'number' || !Number.isFinite(value);
    })
  );
  const showLegend = visibleSeries.length >= 2;
  const table = (
    <AccessibleChartTable
      ariaLabel={ariaLabel}
      data={data}
      xKey={xKey}
      series={visibleSeries}
      valueFormatter={valueFormatter}
    />
  );

  if (hasDataGaps) {
    return (
      <div data-chart-engine="recharts">
        <div role="img" aria-label={ariaLabel}>
          <ChartContainer
            config={config}
            className={cn('aspect-auto w-full', className)}
            style={{ height }}
          >
            <RechartsAreaChart data={data}>
              <CartesianGrid vertical={false} />
              {typeof referenceY === 'number' ? (
                <RechartsReferenceLine
                  y={referenceY}
                  stroke="var(--border)"
                  strokeDasharray="4 4"
                  label={
                    referenceLabel
                      ? { value: referenceLabel, position: 'insideTopRight' }
                      : undefined
                  }
                />
              ) : null}
              <RechartsXAxis
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
                        ? (value) =>
                            typeof value === 'number' ? valueFormatter(value) : String(value)
                        : undefined
                    }
                  />
                }
              />
              {visibleSeries.map((entry) => (
                <RechartsArea
                  key={entry.key}
                  dataKey={entry.key}
                  type={curve}
                  fill={`var(--color-${entry.key})`}
                  fillOpacity={0.18}
                  stroke={`var(--color-${entry.key})`}
                  stackId={stacked ? 'stack' : undefined}
                  connectNulls={false}
                  isAnimationActive={animate && !motionDisabled}
                />
              ))}
              {showLegend ? <ChartLegend content={<ChartLegendContent />} /> : null}
            </RechartsAreaChart>
          </ChartContainer>
        </div>
        {table}
      </div>
    );
  }

  return (
    <div className={className}>
      <div style={{ height }}>
        <AreaChart
          ariaLabel={ariaLabel}
          data={data}
          config={ditherConfig}
          stackType={stacked ? 'stacked' : 'default'}
          animate={animate && !motionDisabled}
        >
          <Grid />
          {typeof referenceY === 'number' ? (
            <ReferenceLine y={referenceY} label={referenceLabel} />
          ) : null}
          <XAxis
            dataKey={xKey}
            tickFormatter={(value) =>
              xTickFormatter ? xTickFormatter(String(value ?? '')) : String(value ?? '')
            }
          />
          {visibleSeries.map((entry) => (
            <Area key={entry.key} dataKey={entry.key} />
          ))}
          <Tooltip
            labelKey={xKey}
            valueFormatter={valueFormatter ? (value) => valueFormatter(value) : undefined}
          />
          {showLegend ? <Legend /> : null}
        </AreaChart>
      </div>
      {table}
    </div>
  );
}

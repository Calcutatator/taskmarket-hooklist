'use client';

import { useMemo } from 'react';
import {
  Bar as RechartsBar,
  BarChart as RechartsBarChart,
  CartesianGrid,
  XAxis,
  YAxis,
} from 'recharts';
import type { DataKey } from 'recharts/types/util/types';

import { AccessibleChartTable } from '@/components/charts/accessible-chart-table';
import { buildChartConfig, CHART_SERIES_COLORS } from '@/components/charts/chart-palette';
import { Bar } from '@/components/dither-kit/bar';
import { BarChart as DitherBarChart } from '@/components/dither-kit/bar-chart';
import type { ChartConfig as DitherChartConfig } from '@/components/dither-kit/chart-context';
import { Grid } from '@/components/dither-kit/grid';
import { Legend } from '@/components/dither-kit/legend';
import { Tooltip } from '@/components/dither-kit/tooltip';
import { XAxis as DitherXAxis } from '@/components/dither-kit/x-axis';
import { useMotionDisabled } from '@/components/market/motion/use-motion-disabled';
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from '@/components/ui/chart';
import { cn } from '@/lib/utils';

const DEFAULT_HEIGHT = 250;
const DEFAULT_RADIUS = 4;

export type BarSeries = {
  key: string;
  label: string;
  color?: string;
};

export type BarChartProps<T extends Record<string, unknown>> = {
  ariaLabel?: string;
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
  ariaLabel = 'Bar chart',
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
  const table = (
    <AccessibleChartTable
      ariaLabel={ariaLabel}
      data={data}
      xKey={xKey}
      series={series}
      valueFormatter={valueFormatter}
    />
  );

  if (layout === 'vertical') {
    return (
      <div data-chart-engine="recharts">
        <div role="img" aria-label={ariaLabel}>
          <ChartContainer
            config={config}
            className={cn('aspect-auto w-full', className)}
            style={{ height }}
          >
            <RechartsBarChart data={data} layout={layout}>
              <CartesianGrid vertical horizontal={false} />
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
              {series.map((entry) => (
                <RechartsBar
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
        </div>
        {table}
      </div>
    );
  }

  return (
    <div className={className}>
      <div style={{ height }}>
        <DitherBarChart
          ariaLabel={ariaLabel}
          data={data}
          config={config as DitherChartConfig}
          stackType={stacked ? 'stacked' : 'default'}
          animate={!motionDisabled}
        >
          <Grid />
          <DitherXAxis
            dataKey={xKey}
            tickFormatter={(value) =>
              xTickFormatter ? xTickFormatter(String(value ?? '')) : String(value ?? '')
            }
          />
          {series.map((entry) => (
            <Bar key={entry.key} dataKey={entry.key} />
          ))}
          <Tooltip
            labelKey={xKey}
            valueFormatter={valueFormatter ? (value) => valueFormatter(value) : undefined}
          />
          {showLegend ? <Legend /> : null}
        </DitherBarChart>
      </div>
      {table}
    </div>
  );
}

export function BarChart<T extends Record<string, unknown>>(props: BarChartProps<T>) {
  return <BarChartBase {...props} />;
}

export function StackedBarChart<T extends Record<string, unknown>>(
  props: Omit<BarChartProps<T>, 'stacked'>
) {
  return <BarChartBase {...props} stacked />;
}

export type HistogramBarsProps = {
  ariaLabel: string;
  data: { label: string; value: number }[];
  height?: number;
  radius?: number;
  color?: string;
  valueFormatter?: (value: number) => string;
  className?: string;
};

export function HistogramBars({
  ariaLabel,
  data,
  height = DEFAULT_HEIGHT,
  radius = DEFAULT_RADIUS,
  color = CHART_SERIES_COLORS[0],
  valueFormatter,
  className,
}: HistogramBarsProps) {
  return (
    <BarChartBase
      ariaLabel={ariaLabel}
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

'use client';

import { useMemo } from 'react';

import { AccessibleChartTable } from '@/components/charts/accessible-chart-table';
import { buildChartConfig, CHART_SERIES_COLORS } from '@/components/charts/chart-palette';
import { Bar } from '@/components/dither-kit/bar';
import { BarChart as DitherBarChart } from '@/components/dither-kit/bar-chart';
import { BlockLegend } from '@/components/dither-kit/block-legend';
import { Grid } from '@/components/dither-kit/grid';
import { valueTicks } from '@/components/dither-kit/scales';
import { Tooltip } from '@/components/dither-kit/tooltip';
import { XAxis as DitherXAxis } from '@/components/dither-kit/x-axis';
import { YAxis, yAxisMargin } from '@/components/dither-kit/y-axis';
import { useMotionDisabled } from '@/components/market/motion/use-motion-disabled';

const DEFAULT_HEIGHT = 250;

type BarSeries = {
  key: string;
  label: string;
  color?: string;
};

type BarChartProps<T extends Record<string, unknown>> = {
  ariaLabel?: string;
  data: T[];
  xKey: keyof T & string;
  series: BarSeries[];
  height?: number;
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
  stacked,
  xTickFormatter,
  valueFormatter,
  className,
}: BarChartProps<T>) {
  const motionDisabled = useMotionDisabled();
  const config = useMemo(() => buildChartConfig(series), [series]);
  const stackType = stacked ? 'stacked' : 'default';
  // Reserve the gutter the value labels actually need: the tick values follow
  // from the data alone, so they can be formatted before the chart is measured.
  const margins = useMemo(() => {
    const ticks = valueTicks(
      data,
      series.map((entry) => entry.key),
      stackType
    );
    return {
      left: yAxisMargin(ticks.map((t) => (valueFormatter ? valueFormatter(t) : String(t)))),
    };
  }, [data, series, stackType, valueFormatter]);
  const showLegend = series.length >= 2;

  return (
    <div className={className}>
      <div style={{ height }}>
        <DitherBarChart
          ariaLabel={ariaLabel}
          data={data}
          config={config}
          margins={margins}
          stackType={stackType}
          animate={!motionDisabled}
          labelKey={xKey}
          valueFormatter={valueFormatter ? (value) => valueFormatter(value) : undefined}
        >
          <Grid />
          <YAxis tickFormatter={valueFormatter} />
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
        </DitherBarChart>
      </div>
      {showLegend ? <BlockLegend className="mt-2" config={config} /> : null}
      <AccessibleChartTable
        ariaLabel={ariaLabel}
        data={data}
        xKey={xKey}
        series={series}
        valueFormatter={valueFormatter}
      />
    </div>
  );
}

export type HistogramBarsProps = {
  ariaLabel: string;
  data: { label: string; value: number }[];
  height?: number;
  color?: string;
  valueFormatter?: (value: number) => string;
  className?: string;
};

/** Counts across fixed bins — one series, category labels along the bottom. */
export function HistogramBars({
  ariaLabel,
  data,
  height = DEFAULT_HEIGHT,
  color = CHART_SERIES_COLORS[0],
  valueFormatter,
  className,
}: HistogramBarsProps) {
  const series = useMemo(() => [{ key: 'value', label: 'Count', color }], [color]);

  return (
    <BarChartBase
      ariaLabel={ariaLabel}
      data={data}
      xKey="label"
      series={series}
      height={height}
      valueFormatter={valueFormatter}
      className={className}
    />
  );
}

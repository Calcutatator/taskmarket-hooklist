'use client';

import { useMemo } from 'react';

import { AccessibleChartTable } from '@/components/charts/accessible-chart-table';
import { buildChartConfig } from '@/components/charts/chart-palette';
import { Area } from '@/components/dither-kit/area';
import { AreaChart } from '@/components/dither-kit/area-chart';
import { BlockLegend } from '@/components/dither-kit/block-legend';
import { Grid } from '@/components/dither-kit/grid';
import { ReferenceLine } from '@/components/dither-kit/reference-line';
import { valueTicks } from '@/components/dither-kit/scales';
import { Tooltip } from '@/components/dither-kit/tooltip';
import { XAxis } from '@/components/dither-kit/x-axis';
import { YAxis, yAxisMargin } from '@/components/dither-kit/y-axis';
import { useHydrationSafeMotionDisabled } from '@/components/market/motion/use-motion-disabled';

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
  const stackType = stacked ? 'stacked' : 'default';
  // Reserve the gutter the value labels actually need: the tick values follow
  // from the data alone, so they can be formatted before the chart is measured.
  const margins = useMemo(() => {
    const ticks = valueTicks(
      data,
      visibleSeries.map((entry) => entry.key),
      stackType
    );
    return {
      left: yAxisMargin(ticks.map((t) => (valueFormatter ? valueFormatter(t) : String(t)))),
    };
  }, [data, visibleSeries, stackType, valueFormatter]);
  const showLegend = visibleSeries.length >= 2;

  return (
    <div className={className}>
      <div style={{ height }}>
        <AreaChart
          ariaLabel={ariaLabel}
          data={data}
          config={config}
          margins={margins}
          stackType={stackType}
          animate={animate && !motionDisabled}
          labelKey={xKey}
          valueFormatter={valueFormatter ? (value) => valueFormatter(value) : undefined}
        >
          <Grid />
          {typeof referenceY === 'number' ? (
            <ReferenceLine y={referenceY} label={referenceLabel} />
          ) : null}
          <YAxis tickFormatter={valueFormatter} />
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
        </AreaChart>
      </div>
      {showLegend ? <BlockLegend className="mt-2" config={config} /> : null}
      <AccessibleChartTable
        ariaLabel={ariaLabel}
        data={data}
        xKey={xKey}
        series={visibleSeries}
        valueFormatter={valueFormatter}
      />
    </div>
  );
}

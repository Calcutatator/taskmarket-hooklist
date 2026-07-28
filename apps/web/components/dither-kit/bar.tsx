'use client';

import { type ReactNode, useEffect } from 'react';
import { type AreaVariant, type StrokeVariant, useChartPart } from './chart-context';
import { SeriesContext } from './series-context';

export type BarProps = {
  dataKey: string;
  variant?: AreaVariant;
  strokeVariant?: StrokeVariant;
  children?: ReactNode;
};

/**
 * One bar series. The dithered bars are painted on the canvas; this registers
 * the series so the canvas knows how to draw it, and exposes the series to
 * child markers.
 */
export function Bar({
  dataKey,
  variant = 'gradient',
  strokeVariant = 'solid',
  children,
}: BarProps) {
  const ctx = useChartPart('Bar', 'bar');
  const { registerSeries, unregisterSeries } = ctx;

  if (process.env.NODE_ENV !== 'production' && !ctx.config[dataKey]) {
    console.warn(
      `<Bar dataKey="${dataKey}" />: "${dataKey}" is not in the chart \`config\`. Add it so the series has a colour and label.`
    );
  }

  useEffect(() => {
    registerSeries({ dataKey, kind: 'bar', variant, strokeVariant });
    return () => unregisterSeries(dataKey);
  }, [dataKey, variant, strokeVariant, registerSeries, unregisterSeries]);

  const band = ctx.bands[dataKey];
  if (!ctx.ready || !band) return null;

  const seed = ctx.seedOf(dataKey);

  return <SeriesContext value={{ dataKey, seed }}>{children}</SeriesContext>;
}

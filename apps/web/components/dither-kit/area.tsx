'use client';

import { type ReactNode, useEffect } from 'react';
import {
  type AreaVariant,
  type SeriesKind,
  type StrokeVariant,
  useChartPart,
} from './chart-context';
import { SeriesContext } from './series-context';

export type SeriesProps = {
  dataKey: string;
  variant?: AreaVariant;
  strokeVariant?: StrokeVariant;
  children?: ReactNode;
};

/**
 * Shared implementation for the continuous series (`<Area>`, `<Line>`). The
 * dithered fill/line is painted on the canvas; this registers the series so the
 * canvas knows how to draw it, and exposes the series to child
 * `<Dot>`/`<ActiveDot>` markers.
 */
function CartesianSeries({
  part,
  kind,
  dataKey,
  variant = 'gradient',
  strokeVariant = 'solid',
  children,
}: SeriesProps & { part: string; kind: SeriesKind }) {
  const ctx = useChartPart(part, kind === 'line' ? 'line' : 'area');
  const { registerSeries, unregisterSeries } = ctx;

  if (process.env.NODE_ENV !== 'production' && !ctx.config[dataKey]) {
    console.warn(
      `<${part} dataKey="${dataKey}" />: "${dataKey}" is not in the chart \`config\`. Add it so the series has a colour and label.`
    );
  }

  useEffect(() => {
    registerSeries({ dataKey, kind, variant, strokeVariant });
    return () => unregisterSeries(dataKey);
  }, [dataKey, kind, variant, strokeVariant, registerSeries, unregisterSeries]);

  const band = ctx.bands[dataKey];
  if (!ctx.ready || !band) return null;

  const seed = ctx.seedOf(dataKey);

  return <SeriesContext value={{ dataKey, seed }}>{children}</SeriesContext>;
}

export type AreaProps = SeriesProps;

/** One area series — dithered fill from the value line down to its floor. */
export function Area(props: AreaProps) {
  return <CartesianSeries part="Area" kind="area" {...props} />;
}

/** One line series — bright line with a thin dither glow hugging it. */
export function Line(props: AreaProps) {
  return <CartesianSeries part="Line" kind="line" {...props} />;
}

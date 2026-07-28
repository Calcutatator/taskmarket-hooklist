'use client';

import { useChartPart } from './chart-context';
import { resolveTicks, VALUE_TICK_COUNT } from './scales';

// Width of one character of the axis' `font-mono text-[10px]` labels. The SVG
// can't be measured before it renders, so the gutter is reserved from the
// character count instead.
const TICK_CHAR_PX = 6;

/**
 * Left margin the plot must reserve for these formatted tick labels. Pass the
 * chart's own labels (see `valueTicks` in scales.ts) so a currency axis gets a
 * wider gutter than a count axis instead of clipping.
 */
export function yAxisMargin(labels: string[], tickMargin = 8): number {
  const chars = labels.reduce((widest, label) => Math.max(widest, label.length), 0);
  return Math.ceil(chars * TICK_CHAR_PX) + tickMargin + 2;
}

/** Value labels down the left edge — the magnitude scale for the plot. */
export function YAxis({
  tickFormatter,
  tickCount = VALUE_TICK_COUNT,
  tickMargin = 8,
}: {
  tickFormatter?: (value: number) => string;
  tickCount?: number;
  tickMargin?: number;
}) {
  const ctx = useChartPart('YAxis');
  if (!ctx.ready) return null;

  return (
    <g className="fill-current font-mono text-[10px] text-muted-foreground">
      {resolveTicks(ctx.y, tickCount, ctx.integral).map((t) => (
        <text
          key={t}
          x={-tickMargin}
          y={ctx.y(t)}
          textAnchor="end"
          dominantBaseline="central"
          fill="currentColor"
        >
          {tickFormatter ? tickFormatter(t) : t}
        </text>
      ))}
    </g>
  );
}

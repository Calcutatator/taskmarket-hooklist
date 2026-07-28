'use client';

import { useChartPart } from './chart-context';

// Width of one character of the axis' `font-mono text-[10px]` labels, and the
// clear space kept between two neighbouring labels. The SVG can't be measured
// before it renders, so tick density is derived from the character count.
const TICK_CHAR_PX = 6;
const TICK_GAP_PX = 12;

const labelPx = (chars: number) => chars * TICK_CHAR_PX;

/**
 * How many rows to skip between rendered ticks. Derived from the space the plot
 * actually has and the widest label it must fit, so labels thin out as the
 * chart narrows instead of running together at a fixed count.
 */
export function tickStep(
  dataLength: number,
  plotWidth: number,
  labelChars: number,
  maxTicks?: number
): number {
  if (dataLength <= 1 || plotWidth <= 0) return 1;
  const fits = Math.max(1, Math.floor(plotWidth / (labelPx(labelChars) + TICK_GAP_PX)));
  const allowed = maxTicks ? Math.min(fits, maxTicks) : fits;
  return Math.max(1, Math.ceil(dataLength / allowed));
}

/** Category labels along the bottom edge. */
export function XAxis({
  dataKey,
  tickFormatter,
  tickMargin = 8,
  maxTicks,
}: {
  dataKey?: string;
  tickFormatter?: (value: unknown, index: number) => string;
  tickMargin?: number;
  /** Optional cap on top of the width-derived tick count. */
  maxTicks?: number;
}) {
  const ctx = useChartPart('XAxis');
  if (!ctx.ready) return null;

  const labels = ctx.data.map((row, i) => {
    const raw = dataKey ? row[dataKey] : i;
    return tickFormatter ? tickFormatter(raw, i) : String(raw ?? '');
  });
  const widest = labels.reduce((chars, label) => Math.max(chars, label.length), 0);
  const step = tickStep(ctx.dataLength, ctx.plot.width, widest, maxTicks);
  const y = ctx.plot.height + tickMargin;

  // `step` spaces labels on the assumption each one is centred on its category.
  // An edge label breaks that assumption: it gets anchored inward so it can't
  // run under the value axis or spill past the plot, which shifts it up to half
  // a label toward its neighbour and can close the gap `step` reserved. So lay
  // the row out first and drop any label that would still land too close to the
  // one before it -- a measured pass rather than a second guess at the density.
  const ticks: { anchor: 'start' | 'middle' | 'end'; i: number; label: string; x: number }[] = [];
  let lastRight = Number.NEGATIVE_INFINITY;
  for (const [i, label] of labels.entries()) {
    if (i % step !== 0) continue;
    const width = labelPx(label.length);
    const center = ctx.xCenter(i) ?? 0;
    const overflowsLeft = center - width / 2 < 0;
    const overflowsRight = center + width / 2 > ctx.plot.width;
    const left = overflowsLeft ? 0 : overflowsRight ? ctx.plot.width - width : center - width / 2;
    if (left < lastRight + TICK_GAP_PX) continue;
    lastRight = left + width;
    ticks.push({
      anchor: overflowsLeft ? 'start' : overflowsRight ? 'end' : 'middle',
      i,
      label,
      x: overflowsLeft ? 0 : overflowsRight ? ctx.plot.width : center,
    });
  }

  return (
    <g className="fill-current font-mono text-[10px] text-muted-foreground">
      {ticks.map((tick) => (
        <text
          key={tick.i}
          x={tick.x}
          y={y}
          textAnchor={tick.anchor}
          dominantBaseline="hanging"
          fill="currentColor"
        >
          {tick.label}
        </text>
      ))}
    </g>
  );
}

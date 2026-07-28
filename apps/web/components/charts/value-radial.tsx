'use client';

import { useMemo } from 'react';

import { AccessibleChartTable } from '@/components/charts/accessible-chart-table';
import { buildChartConfig, CHART_SERIES_COLORS } from '@/components/charts/chart-palette';
import type { ChartConfig } from '@/components/dither-kit/chart-context';
import { Pie } from '@/components/dither-kit/pie';
import { PieChart } from '@/components/dither-kit/pie-chart';
import { useMotionDisabled } from '@/components/market/motion/use-motion-disabled';
import { cn } from '@/lib/utils';

const DEFAULT_HEIGHT = 160;

const FILLED_KEY = 'filled';
const TRACK_KEY = 'track';
const TRACK_LABEL = 'Remaining';
// The unfilled part of the ring is chrome rather than data, so it takes a
// structural token instead of a series colour. `--border` rather than `--muted`:
// muted is a surface tint a shade off the card it sits on, and the dither
// modulates it further down, so the track disappeared and the gauge read as a
// floating arc -- leaving the proportion legible only from the number in the
// middle, which is the one thing a dial is supposed to show at a glance.
const TRACK_COLOR = 'var(--border)';

// Ratio of the measured plot radius, never a pixel count. Every radius the ring
// uses is derived from the box it was actually given, so it cannot grow past a
// container the way a hardcoded `innerRadius`/`outerRadius` pair can.
const INNER_RADIUS_RATIO = 0.66;

// An even inset on all four sides. The ring is centred in the plot rect, so
// equal margins put the plot's centre on the box's centre -- which is what lets
// the overlaid readout sit on the ring's real centre rather than near it.
const RING_MARGINS = { top: 8, right: 8, bottom: 8, left: 8 };

const formatPercent = (value: number) => `${value}%`;

export type ValueRadialProps = {
  /** Names the quantity: labels the filled arc, its table row, and the plot. */
  name: string;
  value: number;
  max: number;
  /** Centre readout. Defaults to the clamped percentage. */
  label?: string;
  /** Small caption under the centre readout. */
  caption?: string;
  /** Overrides the derived `${name}: ${readout}` accessible name. */
  ariaLabel?: string;
  color?: string;
  height?: number;
  className?: string;
};

/**
 * Whole-percent share of `max`, clamped into [0, 100]. An out-of-range or
 * non-finite input resolves to a drawable percentage instead of an arc that
 * wraps past a full turn (or a NaN sweep that paints nothing).
 */
export function radialPercent(value: number, max: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(max) || max <= 0) {
    return 0;
  }
  return Math.min(100, Math.max(0, Math.round((value / max) * 100)));
}

/**
 * A single-value gauge: a dithered donut whose filled arc sweeps clockwise from
 * twelve o'clock to `value / max`, with the readout centred in the hole. The
 * remainder is drawn as a second, muted slice so the ring always reads as a
 * whole with a filled part, not a floating arc.
 */
export function ValueRadial({
  name,
  value,
  max,
  label,
  caption,
  ariaLabel,
  color = CHART_SERIES_COLORS[0],
  height = DEFAULT_HEIGHT,
  className,
}: ValueRadialProps) {
  const motionDisabled = useMotionDisabled();
  const percent = radialPercent(value, max);
  const readout = label ?? formatPercent(percent);
  const plotLabel = ariaLabel ?? `${name}: ${readout}`;

  const segments = useMemo(
    () => [
      { segment: FILLED_KEY, label: name, value: percent },
      { segment: TRACK_KEY, label: TRACK_LABEL, value: 100 - percent },
    ],
    [name, percent]
  );

  const config = useMemo<ChartConfig>(
    () =>
      buildChartConfig([
        { key: FILLED_KEY, label: name, color },
        { key: TRACK_KEY, label: TRACK_LABEL, color: TRACK_COLOR },
      ]),
    [name, color]
  );

  return (
    <div className={cn('w-full', className)}>
      <div className="flex justify-center">
        {/* Square, and sized from `height` alone: the ring is a circle, so equal
            sides leave no dead band beside it at any container width and keep
            the plot's centre on the box's centre for the readout overlay. */}
        <div className="relative shrink-0" style={{ height, width: height }}>
          <PieChart
            animate={!motionDisabled}
            ariaLabel={plotLabel}
            config={config}
            data={segments}
            dataKey="value"
            innerRadius={INNER_RADIUS_RATIO}
            margins={RING_MARGINS}
            nameKey="segment"
            valueFormatter={formatPercent}
          >
            <Pie />
          </PieChart>
          {/* Hidden from assistive tech: the plot already announces the same
              value through its label and readout, so this would say it twice. */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center"
          >
            <span className="font-mono text-2xl font-semibold text-foreground tabular-nums">
              {readout}
            </span>
            {caption ? <span className="text-xs text-muted-foreground">{caption}</span> : null}
          </div>
        </div>
      </div>
      <AccessibleChartTable
        ariaLabel={plotLabel}
        data={segments}
        series={[{ key: 'value', label: 'Share' }]}
        valueFormatter={formatPercent}
        xKey="label"
        xLabel="Segment"
      />
    </div>
  );
}

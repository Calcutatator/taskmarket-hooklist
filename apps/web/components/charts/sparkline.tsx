'use client';

import { useMemo } from 'react';

import { Area, Line } from '@/components/dither-kit/area';
import { AreaChart, LineChart } from '@/components/dither-kit/area-chart';
import { useMotionDisabled } from '@/components/market/motion/use-motion-disabled';

const DEFAULT_WIDTH = 96;
const DEFAULT_HEIGHT = 28;

// The chart root always labels its plot, but this one is never announced: the
// wrapper below hides the whole subtree from assistive tech.
const HIDDEN_LABEL = 'Trend';

export type SparklineProps = {
  data: number[];
  color?: string;
  width?: number;
  height?: number;
  type?: 'area' | 'line';
};

/**
 * A decorative trend shape for a stat tile. It is noninteractive — no scrub, no
 * tooltip, no data table — so there is nothing an assistive-tech user could read
 * out of it, and the tile it sits in already announces the same metric's label
 * and value. Announcing a second, valueless "… trend" image next to that is
 * noise, so the sparkline stays out of the accessibility tree entirely. A trend
 * whose points must be readable belongs in a `<TrendAreaChart>`, which ships a
 * tooltip, keyboard scrubbing, and an accessible data table.
 */
export function Sparkline({
  data,
  color = 'var(--chart-1)',
  width = DEFAULT_WIDTH,
  height = DEFAULT_HEIGHT,
  type = 'area',
}: SparklineProps) {
  const motionDisabled = useMotionDisabled();
  const rows = useMemo(() => data.map((value) => ({ value })), [data]);
  const config = useMemo(() => ({ value: { color } }), [color]);
  const commonProps = {
    ariaLabel: HIDDEN_LABEL,
    data: rows,
    config,
    interactive: false,
    animate: !motionDisabled,
    margins: { top: 0, right: 0, bottom: 0, left: 0 },
    // No axis chrome to clear, so the trend fills its box edge to edge.
    headroom: 0,
  } as const;

  return (
    <div aria-hidden="true" style={{ width, height }}>
      {type === 'line' ? (
        <LineChart {...commonProps}>
          <Line dataKey="value" />
        </LineChart>
      ) : (
        <AreaChart {...commonProps}>
          <Area dataKey="value" />
        </AreaChart>
      )}
    </div>
  );
}

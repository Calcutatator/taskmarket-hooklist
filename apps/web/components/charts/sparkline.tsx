'use client';

import { useMemo } from 'react';

import { Area, Line } from '@/components/dither-kit/area';
import { AreaChart, LineChart } from '@/components/dither-kit/area-chart';
import { useMotionDisabled } from '@/components/market/motion/use-motion-disabled';

const DEFAULT_WIDTH = 96;
const DEFAULT_HEIGHT = 28;

export type SparklineProps = {
  data: number[];
  color?: string;
  width?: number;
  height?: number;
  type?: 'area' | 'line';
  ariaLabel: string;
};

export function Sparkline({
  data,
  color = 'var(--chart-1)',
  width = DEFAULT_WIDTH,
  height = DEFAULT_HEIGHT,
  type = 'area',
  ariaLabel,
}: SparklineProps) {
  const motionDisabled = useMotionDisabled();
  const values = data.length < 2 ? [data[0] ?? 0, data[0] ?? 0] : data;
  const rows = useMemo(() => values.map((value) => ({ value })), [values]);
  const config = useMemo(() => ({ value: { color } }), [color]);
  const commonProps = {
    ariaLabel,
    data: rows,
    config,
    interactive: false,
    animate: !motionDisabled,
    margins: { top: 0, right: 0, bottom: 0, left: 0 },
  } as const;

  return (
    <div style={{ width, height }}>
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

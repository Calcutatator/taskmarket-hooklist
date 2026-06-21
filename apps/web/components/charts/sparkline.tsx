'use client';

import { Area, AreaChart, Line, LineChart } from 'recharts';

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

// A tiny inline trend with no axes, grid, tooltip, or legend. Deliberately does
// not use ChartContainer: it is a fixed-size decorative chart meant to sit next
// to a number. With fewer than two points it renders a flat baseline so the
// element still occupies space and reads as "no movement" rather than blank.
export function Sparkline({
  data,
  color = 'var(--chart-1)',
  width = DEFAULT_WIDTH,
  height = DEFAULT_HEIGHT,
  type = 'area',
  ariaLabel,
}: SparklineProps) {
  const motionDisabled = useMotionDisabled();

  const points =
    data.length < 2
      ? [{ value: data[0] ?? 0 }, { value: data[0] ?? 0 }]
      : data.map((value) => ({ value }));

  const gradientId = `sparkline-${ariaLabel.replace(/[^a-zA-Z0-9]/g, '-')}`;

  return (
    <div role="img" aria-label={ariaLabel} style={{ width, height }}>
      {type === 'line' ? (
        <LineChart
          data={points}
          width={width}
          height={height}
          margin={{ top: 2, right: 0, bottom: 2, left: 0 }}
        >
          <Line
            dataKey="value"
            type="monotone"
            stroke={color}
            strokeWidth={1.5}
            dot={false}
            isAnimationActive={!motionDisabled}
          />
        </LineChart>
      ) : (
        <AreaChart
          data={points}
          width={width}
          height={height}
          margin={{ top: 2, right: 0, bottom: 2, left: 0 }}
        >
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.4} />
              <stop offset="100%" stopColor={color} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <Area
            dataKey="value"
            type="monotone"
            stroke={color}
            strokeWidth={1.5}
            fill={`url(#${gradientId})`}
            dot={false}
            isAnimationActive={!motionDisabled}
          />
        </AreaChart>
      )}
    </div>
  );
}

'use client';

import { Label, PolarRadiusAxis, RadialBar, RadialBarChart } from 'recharts';

import { useMotionDisabled } from '@/components/market/motion/use-motion-disabled';
import { ChartContainer, type ChartConfig } from '@/components/ui/chart';
import { CHART_SERIES_COLORS } from '@/components/charts/chart-palette';
import { cn } from '@/lib/utils';

const DEFAULT_HEIGHT = 200;

export type ValueRadialProps = {
  value: number;
  max: number;
  label?: string;
  caption?: string;
  color?: string;
  height?: number;
  className?: string;
};

// A single-value gauge: a radial bar filling to value/max with the percent and an
// optional label centred. Clamps the fill into [0, 100] so out-of-range inputs do
// not overflow the ring.
export function ValueRadial({
  value,
  max,
  label,
  caption,
  color = CHART_SERIES_COLORS[0],
  height = DEFAULT_HEIGHT,
  className,
}: ValueRadialProps) {
  const motionDisabled = useMotionDisabled();
  const fraction = max > 0 ? value / max : 0;
  const percent = Math.max(0, Math.min(100, Math.round(fraction * 100)));
  const endAngle = 90 - percent * 3.6;

  const config: ChartConfig = {
    value: { label: label ?? 'Value', color },
  };

  const chartData = [{ name: 'value', value: percent, fill: color }];

  return (
    <ChartContainer
      config={config}
      className={cn('mx-auto aspect-square', className)}
      style={{ height }}
    >
      <RadialBarChart
        data={chartData}
        startAngle={90}
        endAngle={endAngle}
        innerRadius={70}
        outerRadius={90}
      >
        <PolarRadiusAxis tick={false} tickLine={false} axisLine={false} domain={[0, 100]}>
          <Label
            content={({ viewBox }) => {
              if (!viewBox || !('cx' in viewBox) || !('cy' in viewBox)) {
                return null;
              }
              return (
                <text x={viewBox.cx} y={viewBox.cy} textAnchor="middle" dominantBaseline="middle">
                  <tspan
                    x={viewBox.cx}
                    y={viewBox.cy}
                    className="fill-foreground font-mono text-2xl font-semibold tabular-nums"
                  >
                    {percent}%
                  </tspan>
                  {label || caption ? (
                    <tspan
                      x={viewBox.cx}
                      y={(viewBox.cy ?? 0) + 20}
                      className="fill-muted-foreground text-xs"
                    >
                      {caption ?? label}
                    </tspan>
                  ) : null}
                </text>
              );
            }}
          />
        </PolarRadiusAxis>
        <RadialBar
          dataKey="value"
          cornerRadius={8}
          fill={color}
          background
          isAnimationActive={!motionDisabled}
        />
      </RadialBarChart>
    </ChartContainer>
  );
}

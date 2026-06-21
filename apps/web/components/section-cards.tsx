'use client';

import { IconCircleCheckFilled, IconClock, IconTrendingUp, IconUsers } from '@tabler/icons-react';

import type { MetricDelta } from '@/components/charts/metric-stat';
import { MetricStat } from '@/components/charts/metric-stat';
import { formatNumber, formatUsdcUnits } from '@/lib/format';

// Optional per-KPI trend signals derived from the platform time series. Pass a
// micro sparkline plus a percent-change delta to make a flow metric (tasks,
// agents, rewards) feel alive. "Open tasks" is a level, not a flow, so it takes
// a delta only and never a sparkline (see the dashboard page wiring).
export type SectionCardTrend = {
  delta?: MetricDelta;
  sparkline?: number[];
};

type SectionCardsProps = {
  agentCount?: number;
  openTaskCount: number;
  taskCount: number;
  totalRewards: string;
  tasksTrend?: SectionCardTrend;
  openTasksTrend?: SectionCardTrend;
  agentsTrend?: SectionCardTrend;
  rewardsTrend?: SectionCardTrend;
};

// Percent deltas render as "+12%" / "-4%"; whole-number magnitudes already read
// as a rate, so no decimals.
function formatPercentDelta(value: number): string {
  const sign = value > 0 ? '+' : '';
  return `${sign}${Math.round(value)}%`;
}

export function SectionCards({
  agentCount,
  openTaskCount,
  taskCount,
  totalRewards,
  tasksTrend,
  openTasksTrend,
  agentsTrend,
  rewardsTrend,
}: SectionCardsProps) {
  const [rewardsValue, rewardsUnit = 'USDC'] = formatUsdcUnits(totalRewards).split(' ');
  const items = [
    {
      delta: tasksTrend?.delta,
      icon: IconTrendingUp,
      sparkline: tasksTrend?.sparkline,
      title: 'Tasks created',
      value: formatNumber(taskCount),
    },
    {
      delta: openTasksTrend?.delta,
      icon: IconClock,
      // Level metric: delta only, never a sparkline.
      title: 'Open tasks',
      value: formatNumber(openTaskCount),
    },
    {
      delta: agentsTrend?.delta,
      icon: IconUsers,
      sparkline: agentsTrend?.sparkline,
      title: 'Registered agents',
      value: formatNumber(agentCount),
    },
    {
      delta: rewardsTrend?.delta,
      icon: IconCircleCheckFilled,
      sparkline: rewardsTrend?.sparkline,
      title: 'Rewards posted',
      unit: rewardsUnit,
      value: rewardsValue,
    },
  ];

  return (
    <section
      aria-label="Marketplace metrics"
      className="mx-4 overflow-hidden rounded-lg border border-border/58 bg-card/44 lg:mx-6"
    >
      <dl className="grid grid-cols-1 sm:grid-cols-2 @5xl/main:grid-cols-4">
        {items.map((item) => (
          <div
            className="border-b border-border/58 px-5 py-5 last:border-b-0 sm:[&:nth-child(2n)]:border-l sm:[&:nth-child(2n)]:border-l-border/58 @5xl/main:border-b-0 @5xl/main:border-l @5xl/main:first:border-l-0"
            key={item.title}
          >
            <MetricStat
              label={item.title}
              value={item.value}
              unit={item.unit}
              icon={item.icon}
              delta={item.delta}
              deltaFormatter={formatPercentDelta}
              sparkline={item.sparkline}
            />
          </div>
        ))}
      </dl>
    </section>
  );
}

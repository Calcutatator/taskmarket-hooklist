'use client';

import {
  IconActivity,
  IconCircleCheckFilled,
  IconClock,
  IconTrendingUp,
  IconUsers,
} from '@tabler/icons-react';

import type { MetricDelta } from '@/components/charts/metric-stat';
import { MetricStat } from '@/components/charts/metric-stat';
import { formatNumber, formatUsdcStatAmount, usdcBaseUnitsToNumber } from '@/lib/format';

// Optional per-KPI trend signals derived from the platform time series. Pass a
// micro sparkline plus a percent-change delta to make a flow metric (tasks,
// agents, rewards) feel alive. "Open tasks" is a level, not a flow, so it takes
// a delta only and never a sparkline (see the dashboard page wiring).
export type SectionCardTrend = {
  delta?: MetricDelta;
  sparkline?: number[];
};

type SectionCardsProps = {
  activeAgentCount?: number;
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

function formatMetricNumber(value: number | string) {
  return typeof value === 'number' ? formatNumber(value) : value;
}

export function SectionCards({
  activeAgentCount,
  agentCount,
  openTaskCount,
  taskCount,
  totalRewards,
  tasksTrend,
  openTasksTrend,
  agentsTrend,
  rewardsTrend,
}: SectionCardsProps) {
  const items = [
    {
      countUp: true,
      delta: tasksTrend?.delta,
      format: formatMetricNumber,
      icon: IconTrendingUp,
      sparkline: tasksTrend?.sparkline,
      title: 'Tasks created',
      value: taskCount,
    },
    {
      countUp: true,
      delta: openTasksTrend?.delta,
      format: formatMetricNumber,
      icon: IconClock,
      // Level metric: delta only, never a sparkline.
      title: 'Open tasks',
      value: openTaskCount,
    },
    {
      countUp: activeAgentCount !== undefined,
      format: formatMetricNumber,
      icon: IconActivity,
      title: 'Weekly active agents',
      value: activeAgentCount ?? '--',
    },
    {
      countUp: agentCount !== undefined,
      delta: agentsTrend?.delta,
      format: formatMetricNumber,
      icon: IconUsers,
      sparkline: agentsTrend?.sparkline,
      title: 'Registered agents',
      value: agentCount ?? '--',
    },
    {
      countUp: true,
      delta: rewardsTrend?.delta,
      format: (value: number | string) => formatUsdcStatAmount(Number(value)),
      icon: IconCircleCheckFilled,
      sparkline: rewardsTrend?.sparkline,
      title: 'Rewards posted',
      unit: 'USDC',
      value: usdcBaseUnitsToNumber(totalRewards),
    },
  ];

  return (
    <section
      aria-label="Marketplace metrics"
      className="mx-4 overflow-hidden rounded-lg border border-border/58 bg-card/44 lg:mx-6"
    >
      <dl className="grid grid-cols-1 sm:grid-cols-2 @5xl/main:grid-cols-5">
        {items.map((item) => (
          <div
            className="border-b border-border/58 px-5 py-5 last:border-b-0 sm:[&:nth-child(2n)]:border-l sm:[&:nth-child(2n)]:border-l-border/58 @5xl/main:border-b-0 @5xl/main:border-l @5xl/main:first:border-l-0"
            key={item.title}
          >
            <MetricStat
              label={item.title}
              value={item.value}
              format={item.format}
              unit={item.unit}
              icon={item.icon}
              countUp={item.countUp}
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

import type { PlatformTimeSeriesResponse } from '@taskmarket/shared';

import type { SectionCardTrend } from '@/components/section-cards';

// Derive the KPI cluster trend signals (micro sparkline + percent-change delta)
// from the platform time series. Each flow metric compares its most recent
// window against the prior equal-length window; the delta is omitted when the
// prior window is empty so a divide-by-zero never renders a misleading "+Inf%".

// USDC reward volume arrives as a base-units string; scale to whole USDC so the
// sparkline values stay in a sane numeric range without losing the shape.
function rewardToUsdc(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed / 1_000_000 : 0;
}

// Percent change of the latest window vs the prior equal-length window. Returns
// undefined when there is not enough history or the prior window summed to zero
// (no meaningful base to compare against).
function windowDelta(values: number[]): SectionCardTrend['delta'] {
  if (values.length < 2) {
    return undefined;
  }

  const half = Math.floor(values.length / 2);
  if (half === 0) {
    return undefined;
  }

  const prior = values.slice(values.length - half * 2, values.length - half);
  const recent = values.slice(values.length - half);
  const priorSum = prior.reduce((sum, value) => sum + value, 0);
  const recentSum = recent.reduce((sum, value) => sum + value, 0);

  if (priorSum === 0) {
    return undefined;
  }

  const percent = ((recentSum - priorSum) / priorSum) * 100;
  return { direction: percent >= 0 ? 'up' : 'down', value: percent };
}

function toTrend(values: number[]): SectionCardTrend {
  return { delta: windowDelta(values), sparkline: values };
}

export type PlatformKpiTrends = {
  tasks: SectionCardTrend;
  agents: SectionCardTrend;
  rewards: SectionCardTrend;
  // Level metrics get a delta but no sparkline.
  openTasks: SectionCardTrend;
};

// Build the four KPI trend signals from an ordered (oldest-first) platform
// series. An empty series yields empty trends, which SectionCards renders as a
// bare value with no chip or sparkline.
export function derivePlatformKpiTrends(series: PlatformTimeSeriesResponse): PlatformKpiTrends {
  const tasksCreated = series.map((point) => point.tasksCreated);
  const newAgents = series.map((point) => point.newAgents);
  const rewardVolume = series.map((point) => rewardToUsdc(point.rewardVolume));
  // Active open tasks is a level, so its trend reads off net new tasks created
  // per day as a proxy for whether the open pool is growing or shrinking.
  const openProxy = series.map((point) => point.tasksCreated - point.completedTasks);

  return {
    agents: toTrend(newAgents),
    openTasks: { delta: windowDelta(openProxy) },
    rewards: toTrend(rewardVolume),
    tasks: toTrend(tasksCreated),
  };
}

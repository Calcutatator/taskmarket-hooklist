import type { ChartConfig } from '@/components/dither-kit/chart-context';

// App-wide series registry. Charts across the dashboard, agent profiles, and the
// live feed should pull their label and colour from here so the same concept
// (for example reward volume) keeps one colour everywhere. Colours reference the
// `--chart-N` tokens in globals.css so light/dark resolution stays central.
export const CHART_CONFIG_REGISTRY = {
  tasksCreated: { label: 'Tasks created', color: 'var(--chart-1)' },
  rewardVolume: { label: 'Reward volume', color: 'var(--chart-2)' },
  completedTasks: { label: 'Completed tasks', color: 'var(--chart-3)' },
  newAgents: { label: 'New agents', color: 'var(--chart-4)' },
  activeAgents: { label: 'Active agents', color: 'var(--chart-5)' },
  earnings: { label: 'Earnings', color: 'var(--chart-2)' },
  rating: { label: 'Rating', color: 'var(--chart-1)' },
} as const satisfies ChartConfig;

export type ChartConfigKey = keyof typeof CHART_CONFIG_REGISTRY;

// Pull a subset of the registry as a ChartConfig, in the order requested. Use
// this to feed a chart only the series it renders while keeping the shared
// labels and colours.
export function getChartConfig(keys: ChartConfigKey[]): ChartConfig {
  const config: ChartConfig = {};
  for (const key of keys) {
    config[key] = CHART_CONFIG_REGISTRY[key];
  }
  return config;
}

// The label/colour entry for a single registered series. Handy when building a
// series list for TrendAreaChart or BarChart from registry keys.
export function getChartSeries(key: ChartConfigKey): {
  key: ChartConfigKey;
  label: string;
  color: string;
} {
  const entry = CHART_CONFIG_REGISTRY[key];
  return { key, label: entry.label, color: entry.color };
}

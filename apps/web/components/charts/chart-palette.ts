// Deliberately not a client module. `components/market/agent-avatar.tsx` is a
// Server Component that reads CHART_SERIES_COLORS directly; marking this file
// `'use client'` turns that import into a client reference, the palette lookup
// resolves to nothing, and every avatar silently falls back to a generated HSL
// colour outside the token system.
// Type-only, so the dither kit's `'use client'` boundary is erased at build
// time and this module stays usable from a Server Component.
import type { ChartConfig } from '@/components/dither-kit/chart-context';

// The five neutral series colours, in priority order. Index 0 is the primary
// rose used for the first/activity series; index 1 the accent teal for money;
// then info blue, warning amber, and a muted mauve for overflow. Each entry is a
// `var(--chart-N)` reference so light/dark resolution stays in globals.css.
export const CHART_SERIES_COLORS = [
  'var(--chart-1)',
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--chart-4)',
  'var(--chart-5)',
] as const;

// Task status buckets that map onto the `--chart-<status>` aliases. These agree
// with the status badge variants in lib/market/task-badges.ts so a status reads
// the same colour in a chart as it does on a badge.
export type TaskStatusBucket = 'open' | 'active' | 'pending' | 'completed' | 'disputed' | 'expired';

// Colour for a status bucket, resolved through the status alias tokens.
export function statusColor(bucket: TaskStatusBucket): string {
  return `var(--chart-${bucket})`;
}

// Build a ChartConfig from a series list, auto-assigning palette colours by
// index when the caller has not supplied one. Colours wrap around the palette if
// there are more than five series. Callers may override any colour explicitly.
export function buildChartConfig(
  series: { key: string; label: string; color?: string }[]
): ChartConfig {
  const config: ChartConfig = {};

  series.forEach((entry, index) => {
    config[entry.key] = {
      label: entry.label,
      color: entry.color ?? CHART_SERIES_COLORS[index % CHART_SERIES_COLORS.length],
    };
  });

  return config;
}

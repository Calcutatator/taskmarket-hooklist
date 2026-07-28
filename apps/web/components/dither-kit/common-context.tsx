'use client';

import { createContext, use } from 'react';
import type { Seed } from './palette';

/** A single tooltip row — one series (cartesian/radar) or one slice (pie). */
export type TooltipItem = {
  name: string;
  label: string;
  value: number;
  seed: Seed;
};

/**
 * The minimal surface shared by every chart family, so `<Tooltip>` works
 * identically whether it sits in a cartesian, bar, or polar root. Each root
 * publishes one of these alongside its family-specific context.
 */
export type CommonChart = {
  names: string[]; // legend entries — series keys (cartesian) or slice names (pie)
  labelOf: (name: string) => string;
  colorOf: (name: string) => string;
  seedOf: (name: string) => Seed;
  hoverIndex: number | null;
  heading: (index: number, labelKey?: string) => string | null;
  itemsAt: (index: number) => TooltipItem[];
  ready: boolean;
  tooltipLeft: number; // clamped px for the floating tooltip
  tooltipTop: number; // px — follows the hovered node (cartesian) / cursor (polar)
};

export const CommonChartContext = createContext<CommonChart | null>(null);

export function useCommonChart() {
  const ctx = use(CommonChartContext);
  if (!ctx) {
    throw new Error('<Tooltip /> must be used within a chart root.');
  }
  return ctx;
}

/**
 * The tooltip's content as one sentence, for the chart root's live region: the
 * keyboard equivalent of scrubbing the pointer to a point. `heading` is dropped
 * for families whose heading repeats the single item's own label (a pie slice
 * is named by the slice, not by a separate category axis).
 */
export function describeChartPoint(
  chart: CommonChart,
  index: number,
  {
    labelKey,
    heading = true,
    valueFormatter,
  }: {
    labelKey?: string;
    heading?: boolean;
    valueFormatter?: (value: number, name: string) => string;
  } = {}
): string {
  const items = chart.itemsAt(index);
  const title = heading ? chart.heading(index, labelKey) : null;
  if (items.length === 0) return title ?? '';
  const values = items
    .map((item) => {
      // Pinned locale for the same reason the accessible table pins one: the
      // announcement must not depend on the ambient locale of the renderer.
      const value = valueFormatter
        ? valueFormatter(item.value, item.name)
        : item.value.toLocaleString('en-US');
      return `${item.label}: ${value}`;
    })
    .join(', ');
  return title ? `${title}. ${values}` : values;
}

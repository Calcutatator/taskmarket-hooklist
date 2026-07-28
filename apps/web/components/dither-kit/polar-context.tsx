'use client';

import { createContext, use, useCallback, useMemo, useState } from 'react';
import { type AreaVariant, type ChartConfig, type Margins, useRevision } from './chart-context';
import type { CommonChart } from './common-context';
import type { BloomInput } from './dither-paint';
import type { Seed } from './palette';
import { seedOfColor } from './palette';
import { type PieSlice, pieSlices } from './polar';
import type { Dimensions } from './use-chart-dimensions';

type Row = Record<string, unknown>;

export type PolarChartContextValue = {
  config: ChartConfig;
  configKeys: string[];
  data: Row[];
  dataLength: number;
  ready: boolean;
  plot: { width: number; height: number };
  margins: Margins;
  center: { x: number; y: number };
  outerRadius: number;
  innerRadius: number;
  animate: boolean;
  animationDuration: number;
  revision: number;
  bloom: BloomInput;
  bloomOnHover: boolean;

  seedOf: (key: string) => Seed;
  variantOf: (key: string) => AreaVariant;
  registerVariant: (key: string, variant: AreaVariant) => void;
  unregisterVariant: (key: string) => void;

  hoverIndex: number | null;
  setHoverIndex: (i: number | null) => void;
  setCursor: (px: number, py: number) => void;
  isMouseInChart: boolean;
  setMouseInChart: (over: boolean) => void;
  /** True while the plot is being scrubbed from the keyboard — gates the live
   * region so pointer hover doesn't flood assistive tech with announcements. */
  keyboardActive: boolean;
  setKeyboardActive: (active: boolean) => void;

  pie: PieSlice[];

  common: CommonChart;
};

const PolarChartContext = createContext<PolarChartContextValue | null>(null);

export function usePolarChart() {
  const ctx = use(PolarChartContext);
  if (!ctx) {
    throw new Error('Polar chart parts must be used within a polar chart root.');
  }
  return ctx;
}

/** Boundary guard for polar parts (`<Pie>`). */
export function usePolarPart(part: string) {
  const ctx = use(PolarChartContext);
  if (!ctx) {
    throw new Error(`<${part} /> must be used within <PieChart />.`);
  }
  return ctx;
}

export { PolarChartContext };

export function usePolarController({
  data,
  config,
  dataKey,
  nameKey,
  innerRadiusRatio,
  dimensions,
  margins,
  animate = true,
  animationDuration = 900,
  replayToken = 0,
  bloom = 'off',
  bloomOnHover = false,
}: {
  data: Row[];
  config: ChartConfig;
  dataKey: string;
  nameKey: string;
  innerRadiusRatio: number;
  dimensions: Dimensions;
  margins: Margins;
  animate?: boolean;
  animationDuration?: number;
  replayToken?: number;
  bloom?: BloomInput;
  bloomOnHover?: boolean;
}): PolarChartContextValue {
  // This object becomes the PolarChartContext value, so its identity — and the
  // identity of every function/object it carries — must stay stable across
  // renders that don't change the inputs; otherwise every consumer (legend,
  // tooltip, slices, axes) re-renders on every parent render. The expensive
  // derivations, exposed callbacks, and returned value are memoized below;
  // cheap scalars (radii, ready) are left bare as plain recomputed reads.

  // Memoized: drives `pie`/`radar`/`common` — a fresh array would bust them.
  const configKeys = useMemo(() => Object.keys(config), [config]);
  const revision = useRevision(data, replayToken);

  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [cursorX, setCursorX] = useState(0);
  const [cursorY, setCursorY] = useState(0);
  const [isMouseInChart, setMouseInChart] = useState(false);
  const [keyboardActive, setKeyboardActive] = useState(false);
  // Stable (only wraps two useState setters) so the value keeps its identity.
  const setCursor = useCallback((px: number, py: number) => {
    setCursorX(px);
    setCursorY(py);
  }, []);
  const [variants, setVariants] = useState<Record<string, AreaVariant>>({});

  // useCallback for the same reason as registerSeries in chart-context.tsx:
  // pie.tsx lists these as effect deps, so without stable identities the
  // unregister/register effect re-fires and its setState pair loops.
  const registerVariant = useCallback((key: string, variant: AreaVariant) => {
    setVariants((prev) => (prev[key] === variant ? prev : { ...prev, [key]: variant }));
  }, []);
  const unregisterVariant = useCallback((key: string) => {
    setVariants((prev) => {
      if (!(key in prev)) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }, []);

  // The root spreads margins fresh every render; pin a stable object off the
  // four numbers so it doesn't, on its own, invalidate the value.
  const { top: mTop, right: mRight, bottom: mBottom, left: mLeft } = margins;
  const stableMargins = useMemo(
    () => ({ top: mTop, right: mRight, bottom: mBottom, left: mLeft }),
    [mTop, mRight, mBottom, mLeft]
  );

  const plotWidth = Math.max(0, dimensions.width - mLeft - mRight);
  const plotHeight = Math.max(0, dimensions.height - mTop - mBottom);
  const ready = plotWidth > 0 && plotHeight > 0;
  const outerRadius = Math.max(0, Math.min(plotWidth, plotHeight) / 2 - 6);
  const innerRadius = outerRadius * innerRadiusRatio;
  const centerX = plotWidth / 2;
  const centerY = plotHeight / 2;

  // Stable so `common` and the value stay stable; re-created only on config.
  const seedOf = useCallback((key: string) => seedOfColor(config[key]?.color ?? 'grey'), [config]);
  // "*" is the pie-wide variant set by <Pie>.
  const variantOf = useCallback(
    (key: string) => variants[key] ?? variants['*'] ?? 'gradient',
    [variants]
  );

  // Memoized: slice geometry — recomputing it on every hover/cursor tick would
  // rebuild the pie layout needlessly.
  const pie = useMemo(() => pieSlices(data, dataKey, nameKey), [data, dataKey, nameKey]);

  // Memoized: this is the value handed to CommonChartContext (Legend/Tooltip),
  // so it needs its own stable identity independent of the parent value.
  const common: CommonChart = useMemo<CommonChart>(() => {
    const tooltipLeft = Math.max(48, Math.min(plotWidth + mLeft - 48, cursorX));
    const tooltipTop = Math.max(mTop + 44, cursorY);
    return {
      names: pie.map((s) => s.name),
      tooltipTop,
      labelOf: (n) => config[n]?.label ?? n,
      colorOf: (n) => config[n]?.color ?? 'var(--muted-foreground)',
      seedOf,
      hoverIndex,
      ready,
      tooltipLeft,
      heading: (i) => pie[i]?.name ?? null,
      itemsAt: (i) => {
        const s = pie[i];
        if (!s) return [];
        return [
          {
            name: s.name,
            label: config[s.name]?.label ?? s.name,
            value: s.value,
            seed: seedOf(s.name),
          },
        ];
      },
    };
  }, [config, pie, seedOf, hoverIndex, ready, plotWidth, mLeft, mTop, cursorX, cursorY]);

  // Memoized: this is the PolarChartContext value. A fresh object here would
  // re-render every consumer on every parent render — the reason the pieces
  // above are stabilized. Rebuilds only when a listed input changes. The
  // useState setters are listed but never change identity.
  return useMemo<PolarChartContextValue>(
    () => ({
      config,
      configKeys,
      data,
      dataLength: data.length,
      ready,
      plot: { width: plotWidth, height: plotHeight },
      margins: stableMargins,
      center: { x: centerX, y: centerY },
      outerRadius,
      innerRadius,
      animate,
      animationDuration,
      revision,
      bloom,
      bloomOnHover,
      seedOf,
      variantOf,
      registerVariant,
      unregisterVariant,
      hoverIndex,
      setHoverIndex,
      setCursor,
      isMouseInChart,
      setMouseInChart,
      keyboardActive,
      setKeyboardActive,
      pie,
      common,
    }),
    [
      config,
      configKeys,
      data,
      ready,
      plotWidth,
      plotHeight,
      stableMargins,
      centerX,
      centerY,
      outerRadius,
      innerRadius,
      animate,
      animationDuration,
      revision,
      bloom,
      bloomOnHover,
      seedOf,
      variantOf,
      registerVariant,
      unregisterVariant,
      hoverIndex,
      setHoverIndex,
      setCursor,
      isMouseInChart,
      setMouseInChart,
      keyboardActive,
      setKeyboardActive,
      pie,
      common,
    ]
  );
}

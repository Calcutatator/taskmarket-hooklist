'use client';

import {
  Children,
  type ComponentType,
  isValidElement,
  type ReactNode,
  useId,
  useMemo,
} from 'react';
import type { ChartConfig, Margins } from './chart-context';
import { CommonChartContext, describeChartPoint } from './common-context';
import type { BloomInput } from './dither-paint';
import { chartKeyNav } from './keyboard';
import { cn } from './lib';
import { sliceAtAngle } from './polar';
import { PolarChartContext, usePolarController } from './polar-context';
import { useChartDimensions } from './use-chart-dimensions';
import { useThemeRevision } from './use-theme-revision';

// `object` rather than `Record<string, unknown>`: interfaces don't get an
// implicit index signature, so interface-typed rows failed to satisfy the
// generic. Internal layers still index rows through their own Row type.
type Row = object;

const DEFAULT_POLAR_MARGINS: Margins = {
  top: 22,
  right: 14,
  bottom: 14,
  left: 14,
};

function layerOf(node: ReactNode): 'back' | 'dom' | 'svg' {
  if (!isValidElement(node) || typeof node.type === 'string') return 'svg';
  return (node.type as { chartLayer?: 'back' | 'dom' }).chartLayer ?? 'svg';
}

export type PolarRootProps<TData extends Row> = {
  /** Family painter — `PieCanvas`; ships with the chart. */
  Canvas: ComponentType;
  data: TData[];
  config: ChartConfig;
  children: ReactNode;
  dataKey: string;
  nameKey: string;
  innerRadius?: number; // 0–1 ratio (donut)
  margins?: Partial<Margins>;
  className?: string;
  ariaLabel: string;
  animate?: boolean;
  animationDuration?: number;
  replayToken?: number;
  bloom?: BloomInput;
  bloomOnHover?: boolean;
  /** Formats announced values, so the readout matches the tooltip's units. */
  valueFormatter?: (value: number, name: string) => string;
};

/**
 * Shared root for the polar dither charts (pie / donut). Like the cartesian
 * root, the painted plot is one focusable `role="img"` node and its live region
 * is a sibling of that node — an `img` takes presentational children, so an
 * announcement nested inside it would never reach assistive tech.
 */
export function PolarRoot<TData extends Row>({
  Canvas,
  data,
  config,
  children,
  dataKey,
  nameKey,
  innerRadius = 0,
  margins: marginsProp,
  className,
  ariaLabel,
  animate = true,
  animationDuration = 900,
  replayToken = 0,
  bloom = 'off',
  bloomOnHover = false,
  valueFormatter,
}: PolarRootProps<TData>) {
  const { ref, size, isVisible } = useChartDimensions<HTMLDivElement>();
  const hintId = useId();
  const themeRevision = useThemeRevision();
  const themedConfig = useMemo(() => ({ ...config }), [config, themeRevision]);
  const margins = { ...DEFAULT_POLAR_MARGINS, ...marginsProp };

  const ctx = usePolarController({
    // Safe: the controller only reads row[key] for the configured keys.
    data: data as Record<string, unknown>[],
    config: themedConfig,
    dataKey,
    nameKey,
    innerRadiusRatio: innerRadius,
    dimensions: size,
    margins,
    animate,
    animationDuration,
    replayToken,
    bloom,
    bloomOnHover,
  });

  const backChildren: ReactNode[] = [];
  const svgChildren: ReactNode[] = [];
  const domChildren: ReactNode[] = [];
  Children.forEach(children, (child) => {
    const layer = layerOf(child);
    if (layer === 'back') backChildren.push(child);
    else if (layer === 'dom') domChildren.push(child);
    else svgChildren.push(child);
  });

  const onMove = (clientX: number, clientY: number) => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const dx = clientX - rect.left - margins.left - ctx.center.x;
    const dy = clientY - rect.top - margins.top - ctx.center.y;
    const angle = Math.atan2(dy, dx);
    const r = Math.hypot(dx, dy);
    const inside = r <= ctx.outerRadius && r >= ctx.innerRadius;
    const i = inside ? sliceAtAngle(ctx.pie, angle) : -1;
    ctx.setHoverIndex(i >= 0 ? i : null);
    ctx.setCursor(clientX - rect.left, clientY - rect.top);
  };

  // Keyboard scrubbing parks the tooltip on the slice's own mid-angle, halfway
  // out its band, so it lands over the wedge the readout describes.
  const scrubTo = (index: number | null) => {
    ctx.setHoverIndex(index);
    const slice = index == null ? null : ctx.pie[index];
    if (!slice) return;
    const r = (ctx.innerRadius + ctx.outerRadius) / 2;
    ctx.setCursor(
      margins.left + ctx.center.x + Math.cos(slice.mid) * r,
      margins.top + ctx.center.y + Math.sin(slice.mid) * r
    );
  };
  const onKeyDown = chartKeyNav({
    count: ctx.pie.length,
    index: ctx.hoverIndex,
    onIndex: scrubTo,
  });

  // No heading: a slice's heading is its own name, which the item label already
  // carries, so announcing both would just say it twice.
  const announcement =
    ctx.keyboardActive && ctx.hoverIndex != null
      ? describeChartPoint(ctx.common, ctx.hoverIndex, { heading: false, valueFormatter })
      : '';

  return (
    <PolarChartContext value={ctx}>
      <CommonChartContext value={ctx.common}>
        <div className={cn('relative h-full w-full', className)}>
          <div
            ref={ref}
            role="img"
            aria-label={ariaLabel}
            aria-describedby={hintId}
            tabIndex={0}
            data-chart-engine="dither"
            className="relative h-full w-full rounded-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/35"
            onPointerEnter={() => {
              ctx.setMouseInChart(true);
              ctx.setKeyboardActive(false);
            }}
            onPointerMove={(e) => onMove(e.clientX, e.clientY)}
            onPointerLeave={() => {
              ctx.setMouseInChart(false);
              ctx.setHoverIndex(null);
            }}
            onKeyDown={onKeyDown}
            onFocus={() => {
              ctx.setKeyboardActive(true);
              if (ctx.hoverIndex == null && ctx.pie.length > 0) scrubTo(0);
            }}
            onBlur={() => {
              ctx.setKeyboardActive(false);
              ctx.setHoverIndex(null);
            }}
          >
            {ctx.ready && (
              <svg
                width={size.width}
                height={size.height}
                className="absolute inset-0 overflow-visible"
                aria-hidden
                role="presentation"
              >
                <g transform={`translate(${margins.left},${margins.top})`}>{backChildren}</g>
              </svg>
            )}
            {isVisible ? <Canvas /> : null}
            {ctx.ready && (
              <svg
                width={size.width}
                height={size.height}
                className="absolute inset-0 overflow-visible"
                aria-hidden
                role="presentation"
              >
                <g transform={`translate(${margins.left},${margins.top})`}>{svgChildren}</g>
              </svg>
            )}
            {domChildren}
          </div>
          <span className="sr-only" id={hintId}>
            Use the left and right arrow keys to move between slices, Home and End for the first and
            last, and Escape to dismiss the readout.
          </span>
          <span aria-live="polite" className="sr-only" data-chart-readout>
            {announcement}
          </span>
        </div>
      </CommonChartContext>
    </PolarChartContext>
  );
}

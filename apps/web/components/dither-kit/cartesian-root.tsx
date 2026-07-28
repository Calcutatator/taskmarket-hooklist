'use client';

import {
  Children,
  type ComponentType,
  isValidElement,
  type ReactNode,
  useId,
  useMemo,
} from 'react';
import {
  type ChartConfig,
  ChartContext,
  type ChartType,
  type Margins,
  useChartController,
} from './chart-context';
import { CommonChartContext, describeChartPoint } from './common-context';
import type { BloomInput } from './dither-paint';
import { chartKeyNav } from './keyboard';
import { cn } from './lib';
import type { StackType } from './scales';
import { useChartDimensions } from './use-chart-dimensions';
import { useThemeRevision } from './use-theme-revision';

// `object` rather than `Record<string, unknown>`: interfaces don't get an
// implicit index signature, so interface-typed rows failed to satisfy the
// generic. Internal layers still index rows through their own Row type.
type Row = object;

// `left` reserves the gutter a `<YAxis>` draws its value labels into. 36px only
// covers about five monospace characters, so a chart whose ticks format wider
// than that (currency, thousands separators) must pass a wider `margins.left` —
// `yAxisMargin()` in y-axis.tsx sizes it from the formatted labels.
const DEFAULT_MARGINS: Margins = {
  top: 10,
  right: 12,
  bottom: 22,
  left: 36,
};

export type CartesianChartProps<TData extends Row> = {
  data: TData[];
  config: ChartConfig;
  children: ReactNode;
  stackType?: StackType;
  margins?: Partial<Margins>;
  className?: string;
  ariaLabel: string;
  animate?: boolean;
  animationDuration?: number;
  replayToken?: number; // change to re-play the entrance without remounting
  /** Set false for a decorative sparkline: keeps the hover lift but no scrub
   * crosshair / tooltip. */
  interactive?: boolean;
  /** Controlled crosshair position (e.g. a committed point) — overrides the
   * internal hover when set. */
  markerIndex?: number | null;
  /** Parent-driven hover (e.g. the whole card/row) — lifts the fill. */
  hovered?: boolean;
  /** Glow on the dither fill. */
  bloom?: BloomInput;
  /** Only bloom while the chart is hovered. */
  bloomOnHover?: boolean;
  /** Slack past the extreme value before the y domain is rounded, so the peak
   * never runs flush to the top edge. Pass 0 for a chart with no axis chrome
   * (a sparkline should fill its box). */
  headroom?: number;
  /** Fires with the scrubbed index as the pointer moves (null on leave). */
  onHoverChange?: (index: number | null) => void;
  /** Row field naming each category, so the keyboard readout announces the
   * point by name ("Jul 2") rather than by position. Pass the same key the
   * `<XAxis>` and `<Tooltip>` read. */
  labelKey?: string;
  /** Formats announced values, so the readout matches the tooltip's units. */
  valueFormatter?: (value: number, name: string) => string;
};

/** Which render layer a composed part targets — defaults to the front SVG. */
function layerOf(node: ReactNode): 'back' | 'dom' | 'svg' {
  if (!isValidElement(node) || typeof node.type === 'string') return 'svg';
  return (node.type as { chartLayer?: 'back' | 'dom' }).chartLayer ?? 'svg';
}

/**
 * Shared root for the cartesian dither charts (area, line, bar). Owns the
 * measured size, the shared context, and pointer interaction; every visual is
 * composed as children. Back chrome (grid) sits behind the dither canvas; the
 * canvas paints the fill/line/bars + stars; front chrome (axes, dots) and DOM
 * legend/tooltip layer on top. `chartType` drives the scales/interaction and the
 * `Canvas` prop supplies the family's painter (continuous for area/line, bars for
 * bar) — so each chart ships only its own canvas.
 *
 * The painted plot is one `role="img"` node with the chart's label, and it is
 * focusable so the same per-point readout the pointer scrubs to is reachable by
 * keyboard. Its live region is a *sibling* of that node, not a child: an `img`
 * takes presentational children, so an announcement nested inside it would
 * never reach assistive tech.
 */
export function CartesianRoot<TData extends Row>({
  chartType,
  Canvas,
  data,
  config,
  children,
  stackType = 'default',
  margins: marginsProp,
  className,
  ariaLabel,
  animate = true,
  animationDuration = 900,
  replayToken = 0,
  interactive = true,
  markerIndex = null,
  hovered = false,
  bloom = 'off',
  bloomOnHover = false,
  headroom,
  onHoverChange,
  labelKey,
  valueFormatter,
}: CartesianChartProps<TData> & {
  chartType: ChartType;
  Canvas: ComponentType;
}) {
  const { ref, size, isVisible } = useChartDimensions<HTMLDivElement>();
  const hintId = useId();
  const themeRevision = useThemeRevision();
  const themedConfig = useMemo(() => ({ ...config }), [config, themeRevision]);
  const margins = { ...DEFAULT_MARGINS, ...marginsProp };

  const ctx = useChartController({
    chartType,
    // Safe: the controller only reads row[key] for the configured series keys.
    data: data as Record<string, unknown>[],
    config: themedConfig,
    stackType,
    dimensions: size,
    margins,
    animate,
    animationDuration,
    replayToken,
    markerIndex,
    hovered,
    bloom,
    bloomOnHover,
    headroom,
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

  const onMove = (clientX: number) => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const px = clientX - rect.left - margins.left;
    const index = ctx.indexAtX(px);
    ctx.setHoverIndex(index);
    ctx.setCursorX(clientX - rect.left);
    onHoverChange?.(index);
  };

  // Keyboard scrubbing parks the crosshair on a category centre, so the tooltip
  // sits over the point instead of wherever the pointer last was.
  const scrubTo = (index: number | null) => {
    ctx.setHoverIndex(index);
    if (index != null) ctx.setCursorX(margins.left + ctx.xCenter(index));
    onHoverChange?.(index);
  };
  const onKeyDown = chartKeyNav({ count: data.length, index: ctx.hoverIndex, onIndex: scrubTo });

  const announcement =
    ctx.keyboardActive && ctx.hoverIndex != null
      ? describeChartPoint(ctx.common, ctx.hoverIndex, { labelKey, valueFormatter })
      : '';

  return (
    <ChartContext value={ctx}>
      <CommonChartContext value={ctx.common}>
        <div className={cn('relative h-full w-full', className)}>
          <div
            ref={ref}
            role="img"
            aria-label={ariaLabel}
            aria-describedby={interactive ? hintId : undefined}
            tabIndex={interactive ? 0 : undefined}
            data-chart-engine="dither"
            className={cn(
              'relative h-full w-full rounded-sm outline-none',
              interactive && 'focus-visible:ring-[3px] focus-visible:ring-ring/35'
            )}
            onPointerEnter={() => {
              ctx.setMouseInChart(true);
              ctx.setKeyboardActive(false);
            }}
            onPointerMove={interactive ? (e) => onMove(e.clientX) : undefined}
            onPointerLeave={() => {
              ctx.setMouseInChart(false);
              ctx.setHoverIndex(null);
              onHoverChange?.(null);
            }}
            onKeyDown={interactive ? onKeyDown : undefined}
            onFocus={
              interactive
                ? () => {
                    ctx.setKeyboardActive(true);
                    if (ctx.hoverIndex == null && data.length > 0) scrubTo(0);
                  }
                : undefined
            }
            onBlur={
              interactive
                ? () => {
                    ctx.setKeyboardActive(false);
                    scrubTo(null);
                  }
                : undefined
            }
          >
            {ctx.ready && backChildren.length > 0 && (
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
          {interactive && (
            <>
              <span className="sr-only" id={hintId}>
                Use the left and right arrow keys to move between data points, Home and End for the
                first and last, and Escape to dismiss the readout.
              </span>
              <span aria-live="polite" className="sr-only" data-chart-readout>
                {announcement}
              </span>
            </>
          )}
        </div>
      </CommonChartContext>
    </ChartContext>
  );
}

export type AreaChartProps<TData extends Row> = CartesianChartProps<TData>;

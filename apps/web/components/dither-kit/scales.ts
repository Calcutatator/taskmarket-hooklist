import { scaleBand, scaleLinear, scalePoint } from 'd3-scale';
import { stack as d3Stack, stackOffsetExpand } from 'd3-shape';

export type StackType = 'default' | 'stacked' | 'percent';

type Row = Record<string, unknown>;

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/** A row carries no plottable value for this key — the series breaks here
 * rather than dipping to the baseline. */
const isGap = (v: unknown) => typeof v !== 'number' || !Number.isFinite(v);

export type Bands = {
  bands: Record<string, [number, number][]>;
  /** Per series, per row: true where the row has no value. Consumers read the
   * band as usual and skip the marked positions, so a hole stays a hole
   * instead of interpolating through a phantom zero. */
  gaps: Record<string, boolean[]>;
  max: number;
  min: number;
  /** Every plottable value is a whole number, so the series counts things. The
   * axis must then label whole numbers too: with a max of 1 or 2 a plain tick
   * generator emits `0, 0.2, 0.4 ...`, and "0.2 reviews" is not a quantity that
   * exists. See `resolveTicks`. */
  integral: boolean;
};

/**
 * Per-series [y0, y1] bands for every row. For `default` every series sits on
 * the zero baseline (y0 = 0), so a negative value yields `[0, v]` with `v < 0`
 * and draws below the baseline; for `stacked`/`percent` they pile on top of
 * each other via d3's stack layout (which splits negatives below zero). The
 * shape `bands[key][i] = [y0, y1]` is what both the SVG area paths and the
 * canvas overlay read from. `max`/`min` bound the value range so the y-scale
 * can span a diverging (below-zero) domain.
 */
export function computeBands(data: Row[], keys: string[], stackType: StackType): Bands {
  const gaps: Record<string, boolean[]> = {};
  for (const key of keys) {
    gaps[key] = data.map((row) => isGap(row[key]));
  }

  // Read off the source rows rather than the bands: `percent` normalises every
  // value into a 0-1 fraction, which would look non-integral no matter what the
  // data counted.
  const integral = data.every((row) =>
    keys.every((key) => isGap(row[key]) || Number.isInteger(num(row[key])))
  );

  if (stackType === 'default') {
    const bands: Record<string, [number, number][]> = {};
    let max = 0;
    let min = 0;
    for (const key of keys) {
      bands[key] = data.map((row) => {
        const v = num(row[key]);
        if (v > max) max = v;
        if (v < min) min = v;
        return [0, v];
      });
    }
    // Only fall back to a unit span when there's no range at all (empty /
    // all-zero) — a purely negative series keeps max = 0 so the baseline
    // stays pinned to the top of the plot.
    const flat = max === 0 && min === 0;
    return { bands, gaps, integral, max: flat ? 1 : max, min };
  }

  const series = d3Stack<Row>()
    .keys(keys)
    .value((row, key) => num(row[key]))
    .offset(stackType === 'percent' ? stackOffsetExpand : (undefined as never))(data);

  const bands: Record<string, [number, number][]> = {};
  let max = 0;
  let min = 0;
  series.forEach((layer) => {
    bands[layer.key] = layer.map((point) => {
      if (point[1] > max) max = point[1];
      if (point[0] < min) min = point[0];
      return [point[0], point[1]];
    });
  });
  const flat = max === 0 && min === 0;
  return { bands, gaps, integral, max: flat ? 1 : max, min };
}

/** x positions for each row index, evenly spread across the plot width. */
export function buildXScale(length: number, plotWidth: number) {
  return scalePoint<number>()
    .domain(Array.from({ length }, (_, i) => i))
    .range([0, plotWidth]);
}

/** Banded x for bar categories — each index owns a slot of `bandwidth` width. */
export function buildBandScale(length: number, plotWidth: number) {
  return scaleBand<number>()
    .domain(Array.from({ length }, (_, i) => i))
    .range([0, plotWidth])
    .paddingInner(0.28)
    .paddingOuter(0.18);
}

/** Index of the category whose band a horizontal pixel offset falls in. */
export function indexAtBand(px: number, length: number, plotWidth: number) {
  if (length <= 0 || plotWidth <= 0) return 0;
  const t = Math.max(0, Math.min(0.999, px / plotWidth));
  return Math.min(length - 1, Math.floor(t * length));
}

/** How many value ticks the chrome resolves across the y domain. Shared by
 * `<YAxis>`, `<Grid>` and the margin an adapter reserves, so every gridline
 * carries a label and every label lands on a gridline. */
export const VALUE_TICK_COUNT = 4;

/** Slack added past the extreme value before the domain is rounded, so the
 * tallest bar or peak never runs flush to the plot edge and reads as clipped.
 * Charts with no axis chrome (sparklines) opt out by passing 0. */
export const VALUE_HEADROOM = 0.08;

/**
 * value → vertical pixel. The domain always includes zero, so charts with only
 * positive values keep a floor at the plot bottom, while diverging data (values
 * below zero) draws below a zero baseline that sits somewhere inside the plot.
 */
export function buildYScale(
  min: number,
  max: number,
  plotHeight: number,
  headroom = VALUE_HEADROOM
) {
  const lo = Math.min(0, min) * (1 + headroom);
  const hi = Math.max(0, max) * (1 + headroom);
  // Guard a degenerate (zero-width) domain so `nice()` and the range map stay
  // finite even when every value is exactly zero.
  return scaleLinear()
    .domain([lo, hi === lo ? lo + 1 : hi])
    .nice()
    .range([plotHeight, 0]);
}

/**
 * The ticks to label a value scale with. `<YAxis>` and `<Grid>` both go through
 * here so they never disagree about where a line belongs.
 *
 * When the data counts whole things, fractional ticks are dropped rather than
 * asking for fewer: a count series topping out at 1 or 2 otherwise labels
 * `0, 0.2, 0.4 ...`, and a fifth of a review does not exist. Filtering keeps the
 * remaining ticks on the same positions a coarser request would have moved.
 */
export function resolveTicks(
  scale: { ticks: (count: number) => number[] },
  tickCount = VALUE_TICK_COUNT,
  integral = false
): number[] {
  const ticks = scale.ticks(tickCount);
  if (!integral) return ticks;
  const whole = ticks.filter(Number.isInteger);
  // A domain narrower than one whole unit has no integer tick to fall back to
  // beyond zero, so keep the generator's own answer rather than a bare axis.
  return whole.length > 1 ? whole : ticks;
}

/**
 * The value ticks a chart's y axis will render, resolved from the data alone.
 * Lets an adapter reserve exactly the left margin its formatted labels need
 * before the chart is measured — the tick values depend only on the domain, so
 * the unit-height scale here matches the measured one the axis draws from.
 */
export function valueTicks(
  data: Row[],
  keys: string[],
  stackType: StackType,
  tickCount = VALUE_TICK_COUNT,
  headroom = VALUE_HEADROOM
): number[] {
  const { integral, max, min } = computeBands(data, keys, stackType);
  return resolveTicks(buildYScale(min, max, 1, headroom), tickCount, integral);
}

/** Index of the row nearest a horizontal pixel offset within the plot. */
export function nearestIndex(px: number, length: number, plotWidth: number) {
  if (length <= 1 || plotWidth <= 0) return 0;
  const t = Math.max(0, Math.min(1, px / plotWidth));
  return Math.round(t * (length - 1));
}

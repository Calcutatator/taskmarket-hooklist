import { describe, expect, it } from 'vitest';

import { buildYScale, computeBands, resolveTicks, valueTicks } from './scales';

describe('computeBands', () => {
  it('marks the rows a series has no value for', () => {
    const { bands, gaps } = computeBands(
      [{ rating: 4.5 }, { rating: null }, { rating: 4.8 }],
      ['rating'],
      'default'
    );

    expect(gaps.rating).toEqual([false, true, false]);
    // The band still carries a numeric pair at the hole so every consumer can
    // index it positionally; the flag is what stops it being drawn.
    expect(bands.rating[1]).toEqual([0, 0]);
  });

  it('keeps a missing value out of the range', () => {
    const { max } = computeBands([{ value: 3 }, { value: Number.NaN }], ['value'], 'default');

    expect(max).toBe(3);
  });
});

describe('buildYScale', () => {
  it('leaves headroom above the tallest value', () => {
    const scale = buildYScale(0, 3, 100);

    // The peak sits inside the plot rather than flush against its top edge.
    expect(scale(3)).toBeGreaterThan(0);
    expect(scale(0)).toBe(100);
  });

  it('fills the plot when a caller opts out of headroom', () => {
    expect(buildYScale(0, 3, 100, 0)(3)).toBe(0);
  });
});

describe('valueTicks', () => {
  it('resolves the axis ticks from the data alone', () => {
    const ticks = valueTicks([{ value: 0 }, { value: 400 }], ['value'], 'default', 4);

    expect(ticks).toContain(400);
    expect(ticks[0]).toBe(0);
  });

  // A histogram of one review used to label 0, 0.2, 0.4 ... 1.
  it('labels a small count series in whole reviews, not fifths of one', () => {
    const ticks = valueTicks([{ value: 1 }, { value: 0 }], ['value'], 'default', 4);

    expect(ticks.every(Number.isInteger)).toBe(true);
  });

  // Same tiny domain as the count case above, so the only thing deciding the
  // labels is whether the underlying values are whole numbers.
  it('keeps fractional ticks when the data is genuinely fractional', () => {
    const ticks = valueTicks([{ value: 0.5 }, { value: 0 }], ['value'], 'default', 4);

    expect(ticks.some((tick) => !Number.isInteger(tick))).toBe(true);
  });
});

describe('resolveTicks', () => {
  it('drops fractional ticks for a counting series', () => {
    expect(resolveTicks({ ticks: () => [0, 0.5, 1, 1.5, 2] }, 4, true)).toEqual([0, 1, 2]);
  });

  it('leaves a non-counting series alone', () => {
    expect(resolveTicks({ ticks: () => [0, 0.5, 1] }, 4, false)).toEqual([0, 0.5, 1]);
  });

  it('keeps the generator ticks when filtering would leave no axis', () => {
    // Nothing but zero survives, which would render a bare axis - keep the
    // fractional labels rather than showing a single line.
    expect(resolveTicks({ ticks: () => [0, 0.2, 0.4] }, 4, true)).toEqual([0, 0.2, 0.4]);
  });
});

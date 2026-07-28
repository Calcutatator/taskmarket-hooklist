import { describe, expect, it } from 'vitest';

import { resample } from './dither-paint';

describe('resample', () => {
  it('holds a single-point series flat instead of cliffing to zero', () => {
    expect(resample([40], 8)).toEqual([40, 40, 40, 40, 40, 40, 40, 40]);
  });

  it('returns zeros for an empty series', () => {
    expect(resample([], 4)).toEqual([0, 0, 0, 0]);
  });

  it('keeps the endpoints of a multi-point series', () => {
    const out = resample([0, 10], 5);
    expect(out[0]).toBe(0);
    expect(out.at(-1)).toBe(10);
    expect(out).toEqual([0, 2.5, 5, 7.5, 10]);
  });

  it('interpolates linearly between points', () => {
    expect(resample([0, 4, 8], 5)).toEqual([0, 2, 4, 6, 8]);
  });

  it('samples down to fewer columns than points', () => {
    expect(resample([0, 1, 2, 3], 2)).toEqual([0, 3]);
  });
});

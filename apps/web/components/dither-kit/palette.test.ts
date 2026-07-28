import { beforeEach, describe, expect, it } from 'vitest';

import { clearDitherColorCache, rgb, seedOfColor } from './palette';

// jsdom resolves literal colours through getComputedStyle but leaves `var()`
// untouched, so these cover the resolution maths a browser hands back — not the
// token lookup itself.
describe('seedOfColor', () => {
  beforeEach(() => {
    clearDitherColorCache();
  });

  it('carries the alpha of a translucent colour', () => {
    const seed = seedOfColor('rgba(10, 20, 30, 0.6)');
    expect(seed.fill).toEqual([10, 20, 30]);
    expect(seed.alpha).toBe(0.6);
  });

  it('resolves an opaque colour at full alpha', () => {
    expect(seedOfColor('rgb(10, 20, 30)').alpha).toBe(1);
    expect(seedOfColor('#cc667f').fill).toEqual([204, 102, 127]);
  });

  it('keeps two colours that differ only in alpha distinct', () => {
    // The shape of --chart-completed vs --chart-expired: same channels, 60%
    // alpha. Discarding the alpha collapsed them into one painted colour.
    const completed = seedOfColor('rgb(120, 120, 120)');
    const expired = seedOfColor('rgba(120, 120, 120, 0.6)');

    expect(completed.fill).toEqual(expired.fill);
    expect(completed.alpha).not.toBe(expired.alpha);
    expect(rgb(completed.fill, 1, completed.alpha)).not.toBe(rgb(expired.fill, 1, expired.alpha));
  });

  it('derives the lighter line and star tones from the fill', () => {
    const seed = seedOfColor('rgb(0, 0, 0)');
    expect(seed.line).toEqual([92, 92, 92]);
    expect(seed.star).toEqual([158, 158, 158]);
  });

  it('never falls back to the inherited page text colour', () => {
    document.body.style.color = 'rgb(1, 2, 3)';
    const seed = seedOfColor('var(--not-a-real-token)');
    document.body.style.color = '';

    expect(seed.fill).not.toEqual([1, 2, 3]);
    expect(seed.alpha).toBe(1);
  });

  it('caches by colour until the cache is cleared', () => {
    const first = seedOfColor('rgb(4, 5, 6)');
    expect(seedOfColor('rgb(4, 5, 6)')).toBe(first);

    clearDitherColorCache();
    expect(seedOfColor('rgb(4, 5, 6)')).not.toBe(first);
  });
});

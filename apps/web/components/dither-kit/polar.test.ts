import { describe, expect, it } from 'vitest';

import { pieSlices, sliceAtAngle } from './polar';

const TOP = -Math.PI / 2;
const TAU = Math.PI * 2;

describe('pieSlices', () => {
  it('lays slices out clockwise from the top, proportional to their value', () => {
    const slices = pieSlices(
      [
        { v: 3, name: 'a' },
        { v: 1, name: 'b' },
      ],
      'v',
      'name'
    );

    expect(slices.map((s) => s.name)).toEqual(['a', 'b']);
    expect(slices[0].start).toBe(TOP);
    expect(slices[0].end).toBeCloseTo(TOP + TAU * 0.75);
    expect(slices[1].end).toBeCloseTo(TOP + TAU);
    expect(slices[0].mid).toBeCloseTo(TOP + TAU * 0.375);
  });

  it('treats negative and non-numeric values as zero', () => {
    const slices = pieSlices([{ v: -5 }, { v: 'nope' }, { v: 2 }], 'v', 'name');

    expect(slices.map((s) => s.value)).toEqual([0, 0, 2]);
    expect(slices[2].end - slices[2].start).toBeCloseTo(TAU);
  });

  it('falls back to the row index when the name field is missing', () => {
    expect(pieSlices([{ v: 1 }], 'v', 'name')[0].name).toBe('0');
  });

  it('keeps an all-zero series from dividing by zero', () => {
    const slices = pieSlices([{ v: 0 }, { v: 0 }], 'v', 'name');

    expect(slices.every((s) => s.start === s.end)).toBe(true);
  });
});

describe('sliceAtAngle', () => {
  const slices = pieSlices(
    [
      { v: 1, name: 'a' },
      { v: 1, name: 'b' },
    ],
    'v',
    'name'
  );

  it('finds the slice a pointer angle falls in', () => {
    // Pointer angles come from Math.atan2, which returns -PI..PI — outside the
    // [TOP, TOP + TAU) range the slices are laid out in.
    expect(sliceAtAngle(slices, 0)).toBe(0); // due right, first half
    expect(sliceAtAngle(slices, Math.PI)).toBe(1); // due left, second half
    expect(sliceAtAngle(slices, TOP)).toBe(0); // exactly at the seam
  });

  it('returns -1 when no slice covers the angle', () => {
    expect(sliceAtAngle([], 0)).toBe(-1);
  });
});

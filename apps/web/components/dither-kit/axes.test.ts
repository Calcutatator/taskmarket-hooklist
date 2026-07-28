import { describe, expect, it } from 'vitest';

import { tickStep } from './x-axis';
import { yAxisMargin } from './y-axis';

describe('tickStep', () => {
  it('thins the ticks out as the plot narrows', () => {
    // 30 daily buckets labelled like "Jun 21" (6 chars).
    const wide = tickStep(30, 640, 6);
    const narrow = tickStep(30, 240, 6);

    expect(narrow).toBeGreaterThan(wide);
    expect(Math.ceil(30 / narrow)).toBeLessThanOrEqual(Math.floor(240 / (6 * 6 + 12)));
  });

  it('skips more rows for wider labels at the same width', () => {
    expect(tickStep(30, 320, 12)).toBeGreaterThan(tickStep(30, 320, 4));
  });

  it('never drops below every row, and survives a degenerate plot', () => {
    expect(tickStep(4, 640, 6)).toBe(1);
    expect(tickStep(30, 0, 6)).toBe(1);
    expect(tickStep(0, 640, 6)).toBe(1);
  });

  it('honours an explicit cap', () => {
    expect(tickStep(30, 640, 6, 3)).toBe(10);
  });
});

describe('yAxisMargin', () => {
  it('reserves more gutter for a currency axis than a count axis', () => {
    const counts = yAxisMargin(['0', '5', '10']);
    const currency = yAxisMargin(['$0', '$2,500', '$5,000']);

    expect(currency).toBeGreaterThan(counts);
    // The default 36px left margin cannot fit these labels.
    expect(currency).toBeGreaterThan(36);
  });

  it('sizes from the widest label', () => {
    expect(yAxisMargin(['1', '1000'])).toBe(yAxisMargin(['1000']));
  });
});

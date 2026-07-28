import { describe, expect, it } from 'vitest';

import { formatAxisKey, formatBucketTick } from './axis-format';

describe('formatBucketTick', () => {
  it('renders a day bucket as a short en-US tick', () => {
    expect(formatBucketTick('2026-06-04')).toBe('Jun 4');
    expect(formatBucketTick('2026-07-24')).toBe('Jul 24');
  });

  it('pins the label to the en-US rendering', () => {
    // The expected values are the en-US renderings. A helper that passed
    // `undefined` for the locale would render "24 juil." for a French browser
    // and something else again on the Node server, which is both a heat
    // map/trend axis divergence and a hydration mismatch.
    expect(formatBucketTick('2026-07-24')).toBe(
      new Intl.DateTimeFormat('en-US', {
        day: 'numeric',
        month: 'short',
        timeZone: 'UTC',
      }).format(new Date(Date.UTC(2026, 6, 24)))
    );
  });

  it('does not shift across the day boundary', () => {
    expect(formatBucketTick('2026-01-01')).toBe('Jan 1');
    expect(formatBucketTick('2026-12-31')).toBe('Dec 31');
  });

  it('accepts a full timestamp by reading its leading date', () => {
    expect(formatBucketTick('2026-06-21T23:30:00Z')).toBe('Jun 21');
  });

  it('returns non-date keys untouched', () => {
    expect(formatBucketTick('bounty')).toBe('bounty');
    expect(formatBucketTick('')).toBe('');
  });
});

describe('formatAxisKey', () => {
  it('formats ISO dates through the shared bucket tick', () => {
    // The heat map axis and the trend axis above it must agree on a date.
    expect(formatAxisKey('2026-07-24')).toBe(formatBucketTick('2026-07-24'));
    expect(formatAxisKey('2026-07-24')).toBe('Jul 24');
  });

  it('maps a day-of-week index onto a weekday label', () => {
    expect(formatAxisKey('0')).toBe('Sun');
    expect(formatAxisKey('6')).toBe('Sat');
  });

  it('leaves hours and mode keys untouched', () => {
    expect(formatAxisKey('13')).toBe('13');
    expect(formatAxisKey('bounty')).toBe('bounty');
  });
});

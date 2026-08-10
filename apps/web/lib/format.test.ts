import { describe, expect, it } from 'vitest';

import * as format from './format';
import {
  formatDateTime,
  formatRelativePast,
  formatTimeLeft,
  formatUsdcUnits,
  sumUsdcBaseUnits,
} from './format';

describe('sumUsdcBaseUnits', () => {
  it('sums base-unit strings and ignores malformed values', () => {
    expect(sumUsdcBaseUnits(['4000000', 'not-a-number', '5000000'])).toBe('9000000');
  });
});

describe('formatUsdcUnits', () => {
  it('groups thousands and trims trailing zeros without a leading sign', () => {
    const result = formatUsdcUnits('1500000000');
    expect(result).toBe('1,500 USDC');
    expect(result).not.toMatch(/^\+/);
  });

  it('formats whole amounts without decimal noise', () => {
    expect(formatUsdcUnits('25000000')).toBe('25 USDC');
    expect(formatUsdcUnits('8000000')).toBe('8 USDC');
  });

  it('keeps significant fraction digits for sub-unit amounts', () => {
    expect(formatUsdcUnits('50000')).toBe('0.05 USDC');
    expect(formatUsdcUnits('1000')).toBe('0.001 USDC');
    expect(formatUsdcUnits('12500000')).toBe('12.5 USDC');
  });

  it('preserves all base units above the JavaScript safe-integer limit', () => {
    expect(formatUsdcUnits('9007199254740993')).toBe('9,007,199,254.740993 USDC');
  });

  it('returns a zeroed amount for missing or non-finite values', () => {
    expect(formatUsdcUnits(null)).toBe('0 USDC');
    expect(formatUsdcUnits('')).toBe('0 USDC');
    expect(formatUsdcUnits('not-a-number')).toBe('0 USDC');
  });
});

describe('formatUsdcStatUnits', () => {
  it('formats marketplace stats to exactly two USDC decimal places', () => {
    expect(format.formatUsdcStatUnits('1027225245')).toBe('1,027.23 USDC');
    expect(format.formatUsdcStatUnits('25000000')).toBe('25.00 USDC');
    expect(format.formatUsdcStatUnits('not-a-number')).toBe('0.00 USDC');
  });
});

describe('formatReward removal', () => {
  it('no longer exports formatReward', () => {
    expect('formatReward' in format).toBe(false);
  });
});

describe('formatDateTime', () => {
  it('includes a timezone token for a valid date', () => {
    const result = formatDateTime(new Date('2026-01-01T00:00:00Z').toISOString());
    expect(result).not.toBe('Not set');
    expect(result).toMatch(/[A-Z]{2,5}|GMT|UTC/);
  });

  it('returns Not set for missing or invalid values', () => {
    expect(formatDateTime(null)).toBe('Not set');
    expect(formatDateTime('not-a-date')).toBe('Not set');
  });
});

describe('formatTimeLeft', () => {
  const now = Date.parse('2026-06-20T12:00:00Z');

  it('uses the injected now so the label is stable and tickable', () => {
    const future = new Date(now + 5 * 3_600_000).toISOString();
    expect(formatTimeLeft(future, now)).toEqual({ label: '5h left', urgency: 'soon' });
  });

  it('marks a passed deadline as expired', () => {
    const past = new Date(now - 1_000).toISOString();
    expect(formatTimeLeft(past, now)).toEqual({ label: 'Expired', urgency: 'expired' });
  });

  it('marks a multi-day deadline as normal urgency', () => {
    const future = new Date(now + 3 * 86_400_000).toISOString();
    expect(formatTimeLeft(future, now)).toEqual({ label: '3d left', urgency: 'normal' });
  });

  it('returns No deadline for missing input', () => {
    expect(formatTimeLeft(null, now).label).toBe('No deadline');
  });
});

describe('formatRelativePast', () => {
  const now = Date.parse('2026-06-20T12:00:00Z');

  it('returns just now for very recent timestamps', () => {
    expect(formatRelativePast(new Date(now - 10_000).toISOString(), now)).toBe('just now');
  });

  it('formats minutes, hours, and days ago', () => {
    expect(formatRelativePast(new Date(now - 5 * 60_000).toISOString(), now)).toBe('5m ago');
    expect(formatRelativePast(new Date(now - 3 * 3_600_000).toISOString(), now)).toBe('3h ago');
    expect(formatRelativePast(new Date(now - 2 * 86_400_000).toISOString(), now)).toBe('2d ago');
  });

  it('returns unknown for missing or invalid input', () => {
    expect(formatRelativePast(null, now)).toBe('unknown');
    expect(formatRelativePast('not-a-date', now)).toBe('unknown');
  });
});

describe('formatDurationSeconds', () => {
  it('renders a configured window in the same vocabulary as formatTimeLeft', () => {
    expect(format.formatDurationSeconds(1800)).toBe('30m');
    expect(format.formatDurationSeconds(7200)).toBe('2h');
    expect(format.formatDurationSeconds(86_400)).toBe('1d');
    expect(format.formatDurationSeconds(172_800)).toBe('2d');
    expect(format.formatDurationSeconds(86_400 * 90)).toBe('3mo');
  });

  it('reads an absent or zero window as unset rather than as "0"', () => {
    expect(format.formatDurationSeconds(null)).toBe('Not set');
    expect(format.formatDurationSeconds(undefined)).toBe('Not set');
    expect(format.formatDurationSeconds(0)).toBe('Not set');
    expect(format.formatDurationSeconds(-5)).toBe('Not set');
  });
});

describe('formatBps', () => {
  it('renders basis points as a percentage', () => {
    expect(format.formatBps(750)).toBe('7.50%');
    expect(format.formatBps(10_000)).toBe('100.00%');
  });

  it('reads zero and absent as no cut at all', () => {
    expect(format.formatBps(0)).toBe('None');
    expect(format.formatBps(null)).toBe('None');
    expect(format.formatBps(undefined)).toBe('None');
  });
});

describe('bpsShareOfBaseUnits', () => {
  it('takes the bps share of a base-unit amount', () => {
    expect(format.bpsShareOfBaseUnits('25000000', 750)).toBe('1875000');
    expect(format.bpsShareOfBaseUnits('1000000', 10_000)).toBe('1000000');
  });

  // Returning null rather than "0" is what lets a caller render nothing instead of a
  // confident but meaningless figure.
  it('returns null when either side is unusable', () => {
    expect(format.bpsShareOfBaseUnits('25000000', 0)).toBeNull();
    expect(format.bpsShareOfBaseUnits('25000000', null)).toBeNull();
    expect(format.bpsShareOfBaseUnits(null, 750)).toBeNull();
    expect(format.bpsShareOfBaseUnits('', 750)).toBeNull();
    expect(format.bpsShareOfBaseUnits('not-a-number', 750)).toBeNull();
    expect(format.bpsShareOfBaseUnits('0', 750)).toBeNull();
  });
});

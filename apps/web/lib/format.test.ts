import { describe, expect, it } from 'vitest';

import * as format from './format';
import { formatDateTime, formatUsdcUnits } from './format';

describe('formatUsdcUnits', () => {
  it('groups thousands and keeps three fraction digits without a leading sign', () => {
    const result = formatUsdcUnits('1500000000');
    expect(result).toBe('1,500.000 USDC');
    expect(result).not.toMatch(/^\+/);
  });

  it('formats sub-unit amounts without a leading sign', () => {
    expect(formatUsdcUnits('25000000')).toBe('25.000 USDC');
  });

  it('returns a zeroed amount for missing or non-finite values', () => {
    expect(formatUsdcUnits(null)).toBe('0.000 USDC');
    expect(formatUsdcUnits('')).toBe('0.000 USDC');
    expect(formatUsdcUnits('not-a-number')).toBe('0.000 USDC');
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

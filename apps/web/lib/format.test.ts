import { describe, expect, it } from 'vitest';

import * as format from './format';
import { formatDateTime, formatRelativePast, formatTimeLeft, formatUsdcUnits } from './format';

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

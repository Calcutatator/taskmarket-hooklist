import { describe, expect, it } from 'vitest';

import { describeClaimAge } from './lib.js';

// Verifies: ADR-0094

describe('describeClaimAge', () => {
  it('reports the interval between the claim and the evaluation date', () => {
    expect(describeClaimAge('2026-07-29', '2026-08-19')).toBe('stated value unchanged since 2026-07-29 (21 days)');
  });

  it('singularises one day', () => {
    expect(describeClaimAge('2026-08-18', '2026-08-19')).toContain('(1 day)');
  });

  it('says nothing when the history is unavailable', () => {
    expect(describeClaimAge(null, '2026-08-19')).toBeNull();
  });

  // A claim dated after the evaluation date means the inputs disagree; reporting a negative age
  // would present that confusion as a measurement.
  it('says nothing rather than reporting a negative age', () => {
    expect(describeClaimAge('2026-09-01', '2026-08-19')).toBeNull();
  });

  // Date.parse accepts "2026-02-30" and rolls it to March 2, so the failure here is not an
  // exception but a confident wrong number.
  it('rejects a date that does not exist on the calendar', () => {
    expect(describeClaimAge('2026-02-30', '2026-03-19')).toBeNull();
    expect(describeClaimAge('2026-13-01', '2026-03-19')).toBeNull();
    expect(describeClaimAge('2026-07-29', '2026-02-30')).toBeNull();
  });

  it('accepts a real leap day', () => {
    expect(describeClaimAge('2028-02-29', '2028-03-01')).toContain('(1 day)');
  });
});

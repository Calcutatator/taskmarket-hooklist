import { describe, expect, it } from 'vitest';
import { computeUpdatePaymentAmount } from '../../../src/services/task-payments';

describe('computeUpdatePaymentAmount', () => {
  it('charges only the standard action fee when reward is unchanged or omitted', () => {
    expect(computeUpdatePaymentAmount('5000000', undefined)).toBe('1000');
    expect(computeUpdatePaymentAmount('5000000', '5000000')).toBe('1000');
  });

  it('charges only the standard action fee when reward decreases', () => {
    expect(computeUpdatePaymentAmount('5000000', '3000000')).toBe('1000');
  });

  it('adds the exact positive reward delta to the action fee', () => {
    expect(computeUpdatePaymentAmount('5000000', '7000000')).toBe('2001000');
  });
});

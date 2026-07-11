import { describe, expect, it } from 'vitest';
import { usdcToBaseUnits } from '../../src/lib/usdc.js';

describe('usdcToBaseUnits', () => {
  it.each([
    ['1', '1000000'],
    ['1.5', '1500000'],
    ['0.000001', '1'],
    ['999999999999999999999999.123456', '999999999999999999999999123456'],
  ])('converts %s exactly', (input, expected) => {
    expect(usdcToBaseUnits(input)).toBe(expected);
  });

  it.each(['-1', '1.0000001', '1e3', 'NaN', '', '0'])('rejects invalid positive amount %s', (input) => {
    expect(() => usdcToBaseUnits(input)).toThrow();
  });

  it('allows zero only when explicitly requested', () => {
    expect(usdcToBaseUnits('0', { allowZero: true })).toBe('0');
  });
});

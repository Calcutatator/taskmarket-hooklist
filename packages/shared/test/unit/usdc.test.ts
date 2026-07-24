import { describe, expect, it } from 'vitest';
import { formatUsdcBaseUnits, usdcToBaseUnits } from '../../src/lib/usdc';

describe('usdcToBaseUnits', () => {
  it.each([
    ['1', '1000000'],
    ['5.25', '5250000'],
    ['0.000001', '1'],
    ['1000000', '1000000000000'],
  ])('converts %s exactly', (input, expected) => {
    expect(usdcToBaseUnits(input)).toBe(expected);
  });

  it.each(['-1', '1.0000001', '1e3', 'NaN', '', '0'])(
    'rejects invalid positive amount %s',
    (input) => {
      expect(() => usdcToBaseUnits(input)).toThrow();
    }
  );

  it('allows zero only when explicitly requested', () => {
    expect(usdcToBaseUnits('0', { allowZero: true })).toBe('0');
  });
});

describe('formatUsdcBaseUnits', () => {
  it('produces a fixed six-decimal string by default', () => {
    expect(formatUsdcBaseUnits('1000000')).toBe('1.000000');
    expect(formatUsdcBaseUnits('12500000')).toBe('12.500000');
    expect(formatUsdcBaseUnits(0n)).toBe('0.000000');
  });

  it('trims trailing zeros when requested', () => {
    expect(formatUsdcBaseUnits('25000000', { trimTrailingZeros: true })).toBe('25');
    expect(formatUsdcBaseUnits('12500000', { trimTrailingZeros: true })).toBe('12.5');
    expect(formatUsdcBaseUnits('1000', { trimTrailingZeros: true })).toBe('0.001');
  });

  it('groups thousands when requested', () => {
    expect(formatUsdcBaseUnits('1500000000', { trimTrailingZeros: true, groupThousands: true })).toBe(
      '1,500'
    );
  });

  it('preserves base units above the JavaScript safe-integer limit', () => {
    expect(
      formatUsdcBaseUnits('9007199254740993', { trimTrailingZeros: true, groupThousands: true })
    ).toBe('9,007,199,254.740993');
  });

  it('keeps a leading sign for negative amounts', () => {
    expect(formatUsdcBaseUnits('-1500000')).toBe('-1.500000');
    expect(formatUsdcBaseUnits('-1500000', { trimTrailingZeros: true })).toBe('-1.5');
  });
});

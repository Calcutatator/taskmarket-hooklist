import { describe, it, expect } from 'vitest';
import {
  estimateUsdBonusValue,
  estimateWorkerUsdBonusValue,
  estimateRequesterUsdBonusValue,
  estimateWorkerDreamsBonus,
  estimateRequesterDreamsBonus,
  dreamsToUsd,
  formatDreams,
} from '../../src/lib/dreams.js';

// 1 USDC == 1_000_000 base units (6 decimals); 1 DREAMS == 1e18 base units.
const ONE_USDC = '1000000';

describe('estimateUsdBonusValue', () => {
  it('applies bonusBps to the reward', () => {
    // 7.5% of 1 USDC = 75000 base units
    expect(estimateUsdBonusValue(ONE_USDC, 750)).toBe('75000');
    // 1% of 1 USDC = 10000 base units
    expect(estimateUsdBonusValue(ONE_USDC, 100)).toBe('10000');
  });

  it('floors integer division', () => {
    // 1 * 1 / 10000 = 0 (truncated)
    expect(estimateUsdBonusValue('1', 1)).toBe('0');
    // 3333 * 1 / 10000 = 0
    expect(estimateUsdBonusValue('3333', 1)).toBe('0');
  });

  it('returns "0" for a non-positive reward', () => {
    expect(estimateUsdBonusValue('0', 750)).toBe('0');
    expect(estimateUsdBonusValue('-5', 750)).toBe('0');
  });

  it('returns "0" for a non-positive bonusBps', () => {
    expect(estimateUsdBonusValue(ONE_USDC, 0)).toBe('0');
    expect(estimateUsdBonusValue(ONE_USDC, -100)).toBe('0');
  });
});

describe('estimateWorkerUsdBonusValue / estimateRequesterUsdBonusValue', () => {
  it('splits the USD bonus by workerSplitBps', () => {
    // usd bonus = 75000; 80% worker = 60000, requester gets the remainder 15000
    expect(estimateWorkerUsdBonusValue(ONE_USDC, 750, 8000)).toBe('60000');
    expect(estimateRequesterUsdBonusValue(ONE_USDC, 750, 8000)).toBe('15000');
  });

  it('gives the entire bonus to the worker at 100% split', () => {
    expect(estimateWorkerUsdBonusValue(ONE_USDC, 750, 10000)).toBe('75000');
    expect(estimateRequesterUsdBonusValue(ONE_USDC, 750, 10000)).toBe('0');
  });

  it('worker and requester shares sum to the total USD bonus', () => {
    const total = BigInt(estimateUsdBonusValue(ONE_USDC, 750));
    const worker = BigInt(estimateWorkerUsdBonusValue(ONE_USDC, 750, 6000));
    const requester = BigInt(estimateRequesterUsdBonusValue(ONE_USDC, 750, 6000));
    expect(worker + requester).toBe(total);
  });

  it('returns "0" when there is no bonus to split', () => {
    expect(estimateWorkerUsdBonusValue('0', 750, 8000)).toBe('0');
    expect(estimateRequesterUsdBonusValue(ONE_USDC, 0, 8000)).toBe('0');
  });
});

describe('estimateWorkerDreamsBonus / estimateRequesterDreamsBonus', () => {
  it('converts the USD bonus to DREAMS at the given rate then splits it', () => {
    // usd bonus = 75000 (base units); rate = 2 DREAMS per USDC base unit scaled by 1e6
    // total = 75000 * 2000000 / 1000000 = 150000 DREAMS base units
    // worker 80% = 120000, requester = 30000
    const rate = '2000000';
    expect(estimateWorkerDreamsBonus(ONE_USDC, rate, 750, 8000)).toBe('120000');
    expect(estimateRequesterDreamsBonus(ONE_USDC, rate, 750, 8000)).toBe('30000');
  });

  it('worker and requester DREAMS shares sum to the converted total', () => {
    const rate = '3000000';
    const worker = BigInt(estimateWorkerDreamsBonus(ONE_USDC, rate, 750, 5500));
    const requester = BigInt(estimateRequesterDreamsBonus(ONE_USDC, rate, 750, 5500));
    // total = 75000 * 3000000 / 1000000 = 225000
    expect(worker + requester).toBe(225000n);
  });

  it('returns "0" when the rate is non-positive', () => {
    expect(estimateWorkerDreamsBonus(ONE_USDC, '0', 750, 8000)).toBe('0');
    expect(estimateRequesterDreamsBonus(ONE_USDC, '-1', 750, 8000)).toBe('0');
  });

  it('returns "0" when there is no USD bonus', () => {
    expect(estimateWorkerDreamsBonus('0', '2000000', 750, 8000)).toBe('0');
    expect(estimateRequesterDreamsBonus(ONE_USDC, '2000000', 0, 8000)).toBe('0');
  });
});

describe('dreamsToUsd', () => {
  it('converts DREAMS base units to USDC base units at the given rate', () => {
    // 150000 DREAMS * 1e6 / 2000000 = 75000 USDC base units (inverse of the example above)
    expect(dreamsToUsd('150000', '2000000')).toBe('75000');
  });

  it('returns "0" for non-positive inputs', () => {
    expect(dreamsToUsd('0', '2000000')).toBe('0');
    expect(dreamsToUsd('150000', '0')).toBe('0');
    expect(dreamsToUsd('-1', '2000000')).toBe('0');
  });
});

describe('formatDreams', () => {
  it('formats a whole number of DREAMS with no fractional part', () => {
    expect(formatDreams('1000000000000000000')).toBe('1');
    expect(formatDreams('0')).toBe('0');
  });

  it('formats a fractional amount and trims trailing zeros', () => {
    // 1.5 DREAMS
    expect(formatDreams('1500000000000000000')).toBe('1.5');
    // 0.000000000000000001 DREAMS (1 wei) keeps full precision
    expect(formatDreams('1')).toBe('0.000000000000000001');
  });

  it('preserves the sign for negative amounts', () => {
    expect(formatDreams('-1500000000000000000')).toBe('-1.5');
    expect(formatDreams('-1000000000000000000')).toBe('-1');
  });
});

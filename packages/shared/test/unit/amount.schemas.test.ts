import { describe, expect, it } from 'vitest';
import { PositiveUsdcBaseUnitsSchema, TaskCreateSchema } from '../../src/schemas';

function auctionInput(overrides: Record<string, unknown> = {}) {
  return {
    description: 'Auction task',
    reward: '1000000',
    duration: 24,
    tags: [],
    mode: 'auction',
    maxPrice: '1000000',
    auctionType: 'dutch',
    auctionFloorPrice: '500000',
    ...overrides,
  };
}

describe('USDC base-unit amount schemas', () => {
  it('accepts a positive integer base-unit string', () => {
    const result = PositiveUsdcBaseUnitsSchema.safeParse('1000');
    expect(result.success).toBe(true);
  });

  it('rejects zero as not greater than zero', () => {
    const result = PositiveUsdcBaseUnitsSchema.safeParse('0');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe('Amount must be greater than zero');
    }
  });

  it('reports a validation issue for a decimal amount instead of throwing', () => {
    const result = PositiveUsdcBaseUnitsSchema.safeParse('0.5');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe(
        'Amount must be a non-negative integer in USDC base units'
      );
    }
  });

  it('reports a validation issue for a malformed auction floor price instead of throwing', () => {
    const result = TaskCreateSchema.safeParse(auctionInput({ auctionFloorPrice: '0.5' }));
    expect(result.success).toBe(false);
  });

  it('reports a validation issue for a malformed auction max price instead of throwing', () => {
    const result = TaskCreateSchema.safeParse(auctionInput({ maxPrice: '0.5' }));
    expect(result.success).toBe(false);
  });

  it('reports a validation issue for a malformed reward instead of throwing', () => {
    const result = TaskCreateSchema.safeParse(auctionInput({ reward: '0.5', maxPrice: '0.5' }));
    expect(result.success).toBe(false);
  });
});

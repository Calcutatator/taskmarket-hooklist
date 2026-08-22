import { describe, expect, it } from 'vitest';

import {
  HookAddressSchema,
  HookGetInputSchema,
  HookIndexEntrySchema,
} from '../../src/schemas/hook.schemas';

const hook = '0x1111111111111111111111111111111111111111';
const zeroAddress = '0x0000000000000000000000000000000000000000';

describe('hook schemas', () => {
  it('accepts a non-zero hook address in inputs and aggregate entries', () => {
    expect(HookAddressSchema.parse(hook)).toBe(hook);
    expect(HookGetInputSchema.parse({ address: hook })).toEqual({ address: hook });
    expect(
      HookIndexEntrySchema.parse({
        address: hook,
        activePhaseTaskCount: 0,
        modes: [],
        taskCount: 0,
        taskIds: [],
      }).address
    ).toBe(hook);
  });

  it('rejects the zero address for both lookup inputs and response entries', () => {
    const result = HookAddressSchema.safeParse(zeroAddress);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe(
        'Hook address must be a non-zero 20-byte hex address'
      );
    }
    expect(HookGetInputSchema.safeParse({ address: zeroAddress }).success).toBe(false);
    expect(
      HookIndexEntrySchema.safeParse({
        address: zeroAddress,
        activePhaseTaskCount: 0,
        modes: [],
        taskCount: 0,
        taskIds: [],
      }).success
    ).toBe(false);
  });

  it('rejects malformed hook addresses with the same clear constraint message', () => {
    const result = HookAddressSchema.safeParse('not-an-address');

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe(
        'Hook address must be a non-zero 20-byte hex address'
      );
    }
  });
});

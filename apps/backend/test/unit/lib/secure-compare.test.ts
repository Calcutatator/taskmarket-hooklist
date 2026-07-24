import { describe, expect, it } from 'vitest';
import { secureCompare } from '../../../src/lib/secure-compare';

describe('secureCompare', () => {
  it('returns true for identical strings', () => {
    expect(secureCompare('s3cret-value', 's3cret-value')).toBe(true);
  });

  it('returns false for differing strings of equal length', () => {
    expect(secureCompare('s3cret-value', 's3cret-valuX')).toBe(false);
  });

  it('returns false for strings of differing length', () => {
    expect(secureCompare('short', 'a-much-longer-secret')).toBe(false);
  });

  it('returns false when either value is missing', () => {
    expect(secureCompare(undefined, 'secret')).toBe(false);
    expect(secureCompare('secret', undefined)).toBe(false);
    expect(secureCompare(null, null)).toBe(false);
    expect(secureCompare('', 'secret')).toBe(false);
  });
});

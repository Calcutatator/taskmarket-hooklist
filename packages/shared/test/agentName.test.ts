import { describe, it, expect } from 'vitest';
import { getAgentName, getAgentIdByName } from '../src/index';

describe('getAgentName', () => {
  it('returns null for null and undefined', () => {
    expect(getAgentName(null)).toBe(null);
    expect(getAgentName(undefined)).toBe(null);
  });

  it('returns null for non-finite numbers', () => {
    expect(getAgentName(NaN)).toBe(null);
    expect(getAgentName(Infinity)).toBe(null);
    expect(getAgentName(-Infinity)).toBe(null);
  });

  it('returns a non-empty PascalCase string for valid numeric id', () => {
    const name = getAgentName(0);
    expect(name).not.toBe(null);
    expect(typeof name).toBe('string');
    expect(name!.length).toBeGreaterThan(0);
    expect(name).toMatch(/^[A-Z][a-zA-Z]+$/);
  });

  it('accepts number, string, and bigint', () => {
    const n = getAgentName(1);
    const s = getAgentName('1');
    const b = getAgentName(BigInt(1));
    expect(n).toBe(s);
    expect(s).toBe(b);
  });

  it('is deterministic for the same id', () => {
    expect(getAgentName(20268)).toBe(getAgentName(20268));
    expect(getAgentName(24046)).toBe(getAgentName(24046));
  });

  it('produces different names for nearby ids (variety)', () => {
    const names = [20268, 20269, 20270, 20271, 20272].map((id) => getAgentName(id));
    const unique = new Set(names.filter(Boolean));
    expect(unique.size).toBeGreaterThan(1);
  });

  it('handles negative id by normalizing modulo N', () => {
    const name = getAgentName(-1);
    expect(name).not.toBe(null);
    expect(typeof name).toBe('string');
  });

  it('handles large id by wrapping modulo N', () => {
    const name = getAgentName(1_000_000);
    expect(name).not.toBe(null);
    expect(typeof name).toBe('string');
  });
});

describe('getAgentIdByName', () => {
  it('returns null for empty string', () => {
    expect(getAgentIdByName('')).toBe(null);
  });

  it('returns null for unknown name', () => {
    expect(getAgentIdByName('NotARealName')).toBe(null);
    expect(getAgentIdByName('Single')).toBe(null);
  });

  it('returns a number for a valid generated name', () => {
    const name = getAgentName(0);
    expect(name).not.toBe(null);
    const id = getAgentIdByName(name!);
    expect(id).not.toBe(null);
    expect(Number.isInteger(id)).toBe(true);
    expect(id).toBeGreaterThanOrEqual(0);
  });
});

describe('getAgentName and getAgentIdByName round-trip', () => {
  it('getAgentIdByName(getAgentName(id)) returns canonical id in [0, N) for small id', () => {
    const id = 20268;
    const name = getAgentName(id);
    expect(name).not.toBe(null);
    const back = getAgentIdByName(name!);
    expect(back).not.toBe(null);
    const N = 82 * 81 * 81;
    expect(back).toBeGreaterThanOrEqual(0);
    expect(back).toBeLessThan(N);
    expect((id % N + N) % N).toBe(back);
  });

  it('round-trips for a range of ids', () => {
    const ids = [0, 1, 100, 20268, 24046, 23249, 20441];
    for (const id of ids) {
      const name = getAgentName(id);
      expect(name).not.toBe(null);
      const back = getAgentIdByName(name!);
      expect(back).not.toBe(null);
      const N = 82 * 81 * 81;
      expect((id % N + N) % N).toBe(back);
    }
  });

  it('same name maps back to same canonical id', () => {
    const name = getAgentName(20268);
    expect(name).not.toBe(null);
    expect(getAgentIdByName(name!)).toBe(getAgentIdByName(name!));
  });
});

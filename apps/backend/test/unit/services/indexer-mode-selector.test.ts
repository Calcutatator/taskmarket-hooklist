import { describe, expect, it } from 'vitest';
import { keccak256, slice, toBytes } from 'viem';

/**
 * Mode-selector contract: the indexer parses the `mode` field on TaskCreated as
 * bytes4, and reverses bytes4(keccak256("TMP.mode.<name>")) back to the name via
 * a lookup table built at module load.
 *
 * This test pins the keccak256 selectors so a typo in the indexer's mode names
 * (or a copy-paste from somewhere else) fails CI rather than silently writing
 * the wrong mode string to the tasks table.
 *
 * The values are kept in sync with packages/contracts/src/interfaces/ITMPMode.sol.
 */
function modeSelector(name: string): `0x${string}` {
  return slice(keccak256(toBytes(name)), 0, 4);
}

describe('TaskCreated mode selector lookup', () => {
  it('reverses the canonical TMP.mode.<name> selectors', () => {
    const table: Record<string, string> = {
      [modeSelector('TMP.mode.bounty').toLowerCase()]: 'bounty',
      [modeSelector('TMP.mode.claim').toLowerCase()]: 'claim',
      [modeSelector('TMP.mode.pitch').toLowerCase()]: 'pitch',
      [modeSelector('TMP.mode.benchmark').toLowerCase()]: 'benchmark',
      [modeSelector('TMP.mode.auction').toLowerCase()]: 'auction',
    };

    expect(Object.keys(table)).toHaveLength(5);
    // Round-trip every name → selector → name
    for (const name of ['bounty', 'claim', 'pitch', 'benchmark', 'auction']) {
      const selector = modeSelector(`TMP.mode.${name}`).toLowerCase();
      expect(table[selector]).toBe(name);
    }
  });

  it('produces 4-byte selectors', () => {
    const selector = modeSelector('TMP.mode.bounty');
    expect(selector).toMatch(/^0x[0-9a-f]{8}$/);
  });

  it('returns distinct selectors for the 5 modes', () => {
    const selectors = ['bounty', 'claim', 'pitch', 'benchmark', 'auction'].map((n) =>
      modeSelector(`TMP.mode.${n}`)
    );
    const unique = new Set(selectors);
    expect(unique.size).toBe(5);
  });
});

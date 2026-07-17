import { describe, expect, it, vi } from 'vitest';
import { runCheckpointedRange } from '../../../src/services/indexer-checkpoint';

describe('runCheckpointedRange', () => {
  it('does not advance the checkpoint when settlement processing fails', async () => {
    const settlementFailure = new Error('settlement transaction rolled back');
    const processRange = vi.fn().mockRejectedValue(settlementFailure);
    const saveCheckpoint = vi.fn();

    await expect(
      runCheckpointedRange(100n, 200n, processRange, saveCheckpoint)
    ).rejects.toBe(settlementFailure);

    expect(saveCheckpoint).not.toHaveBeenCalled();
  });

  it('saves the range end only after processing succeeds', async () => {
    const calls: string[] = [];

    await runCheckpointedRange(
      100n,
      200n,
      async () => {
        calls.push('processed');
      },
      async (blockNumber) => {
        calls.push(`checkpoint:${blockNumber}`);
      }
    );

    expect(calls).toEqual(['processed', 'checkpoint:200']);
  });
});

import { describe, expect, it, vi } from 'vitest';
import {
  findUnresolvedTaskAwardIds,
  runResumableTaskAwardsBackfill,
  runTaskAwardsBackfill,
} from '../../../src/services/task-awards-backfill';

describe('task awards backfill', () => {
  it('accepts issued no-payout verdicts without hiding missing payout events', async () => {
    const states = new Map([
      [
        'no-payout',
        { primaryWorker: null, verdictAwards: [], verdictIssued: true },
      ],
      [
        'missing-direct-settlement',
        { primaryWorker: null, verdictAwards: [], verdictIssued: false },
      ],
      [
        'missing-evaluator-award',
        {
          primaryWorker: '0x0000000000000000000000000000000000000001',
          verdictAwards: [
            {
              amount: 100n,
              rank: 1,
              worker: '0x0000000000000000000000000000000000000001',
            },
          ],
          verdictIssued: true,
        },
      ],
    ]);

    const unresolved = await findUnresolvedTaskAwardIds(
      [...states.keys()],
      async (taskId) => states.get(taskId)!
    );

    expect(unresolved).toEqual(['missing-direct-settlement', 'missing-evaluator-award']);
  });

  it('resumes from the first incomplete chunk after a failure', async () => {
    let checkpoint: bigint | null = null;
    const saveCheckpoint = vi.fn(async (blockNumber: bigint) => {
      checkpoint = blockNumber;
    });
    const failure = new Error('RPC range failed');
    const firstAttempt = vi.fn(async (fromBlock: bigint) => {
      if (fromBlock === 110n) throw failure;
    });

    await expect(
      runResumableTaskAwardsBackfill({
        chunkSize: 10n,
        endBlock: 125n,
        loadCheckpoint: async () => checkpoint,
        processRange: firstAttempt,
        saveCheckpoint,
        startBlock: 100n,
      })
    ).rejects.toBe(failure);

    expect(firstAttempt.mock.calls).toEqual([
      [100n, 109n],
      [110n, 119n],
    ]);
    expect(saveCheckpoint.mock.calls).toEqual([[109n]]);

    const resumedAttempt = vi.fn().mockResolvedValue(undefined);
    await runResumableTaskAwardsBackfill({
      chunkSize: 10n,
      endBlock: 125n,
      loadCheckpoint: async () => checkpoint,
      processRange: resumedAttempt,
      saveCheckpoint,
      startBlock: 100n,
    });

    expect(resumedAttempt.mock.calls).toEqual([
      [110n, 119n],
      [120n, 125n],
    ]);
    expect(checkpoint).toBe(125n);
  });

  it('scopes its cursor to the chain and contract and validates after checkpointing', async () => {
    const calls: string[] = [];
    const loadCheckpoint = vi.fn().mockResolvedValue(109n);
    const saveCheckpoint = vi.fn(async (checkpointId: string, blockNumber: bigint) => {
      calls.push(`checkpoint:${checkpointId}:${blockNumber}`);
    });

    await runTaskAwardsBackfill({
      chainId: 8453,
      chunkSize: 10n,
      contractAddress: '0xABCDEF0000000000000000000000000000000000',
      getLatestBlock: async () => 115n,
      loadCheckpoint,
      processRange: async (fromBlock, toBlock) => {
        calls.push(`range:${fromBlock}-${toBlock}`);
      },
      saveCheckpoint,
      startBlock: 100n,
      validate: async () => {
        calls.push('validate');
      },
    });

    const checkpointId =
      'task_awards_backfill:8453:0xabcdef0000000000000000000000000000000000';
    expect(loadCheckpoint).toHaveBeenCalledWith(checkpointId);
    expect(saveCheckpoint).toHaveBeenCalledWith(checkpointId, 115n);
    expect(calls).toEqual([
      'range:110-115',
      `checkpoint:${checkpointId}:115`,
      'validate',
    ]);
  });

  it('rejects an inverted requested range before loading or validating', async () => {
    const loadCheckpoint = vi.fn().mockResolvedValue(null);
    const processRange = vi.fn().mockResolvedValue(undefined);
    const saveCheckpoint = vi.fn().mockResolvedValue(undefined);
    const validate = vi.fn().mockResolvedValue(undefined);

    await expect(
      runTaskAwardsBackfill({
        chainId: 8453,
        chunkSize: 10n,
        contractAddress: '0xABCDEF0000000000000000000000000000000000',
        getLatestBlock: async () => 115n,
        loadCheckpoint,
        processRange,
        saveCheckpoint,
        startBlock: 116n,
        validate,
      })
    ).rejects.toThrow('Task awards backfill start block 116 exceeds end block 115');

    expect(loadCheckpoint).not.toHaveBeenCalled();
    expect(processRange).not.toHaveBeenCalled();
    expect(saveCheckpoint).not.toHaveBeenCalled();
    expect(validate).not.toHaveBeenCalled();
  });
});

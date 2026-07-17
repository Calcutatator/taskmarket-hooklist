import { describe, expect, it, vi } from 'vitest';
import { runCheckpointedRange } from '../../../src/services/indexer-checkpoint';
import { processIndexedEvent } from '../../../src/services/indexer-event';

describe('indexed event processing', () => {
  it('keeps a failed rating event retryable and does not advance its range checkpoint', async () => {
    const failure = new Error('rating projection failed');
    const event = { eventName: 'TaskRated' };
    const markProcessed = vi.fn();
    const saveCheckpoint = vi.fn();

    await expect(
      runCheckpointedRange(
        400n,
        450n,
        async () => {
          await processIndexedEvent(event, {
            isAlreadyProcessed: vi.fn().mockResolvedValue(false),
            markProcessed,
            processEvent: vi.fn().mockRejectedValue(failure),
          });
        },
        saveCheckpoint
      )
    ).rejects.toBe(failure);

    expect(markProcessed).not.toHaveBeenCalled();
    expect(saveCheckpoint).not.toHaveBeenCalled();
  });
});

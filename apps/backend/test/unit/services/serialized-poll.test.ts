import { describe, expect, it, vi } from 'vitest';
import { createSerializedPoll } from '../../../src/services/serialized-poll';

describe('serialized poll', () => {
  it('joins an active poll and allows the next poll after it settles', async () => {
    let finishFirstPoll!: () => void;
    const pollOperation = vi
      .fn()
      .mockImplementationOnce(
        () => new Promise<void>((resolve) => (finishFirstPoll = resolve))
      )
      .mockResolvedValueOnce(undefined);
    const poll = createSerializedPoll(pollOperation);

    const first = poll();
    const overlapping = poll();

    expect(overlapping).toBe(first);
    expect(pollOperation).toHaveBeenCalledOnce();

    finishFirstPoll();
    await first;
    await poll();

    expect(pollOperation).toHaveBeenCalledTimes(2);
  });
});

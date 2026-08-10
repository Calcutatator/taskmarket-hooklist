// Verifies: ADR-0045
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { stubServerEnvironment } from '../../helpers/server-environment';

const restoreServerEnvironment = stubServerEnvironment();

vi.mock('../../../src/db/client', () => ({ db: {} }));

vi.mock('../../../src/services/relayed-intents', () => ({
  findIntentByTransactionId: vi.fn(),
  listConfirmedUnsettledIntents: vi.fn(),
  markIntentFailed: vi.fn(),
}));

vi.mock('../../../src/services/relayed-intent-registry', () => ({
  completeRelayedIntent: vi.fn().mockResolvedValue(true),
}));

const { completeRelayedIntent } = await import('../../../src/services/relayed-intent-registry');
const { listConfirmedUnsettledIntents } = await import('../../../src/services/relayed-intents');
const { createRelayedIntentSettlement } =
  await import('../../../src/services/relayed-intent-settlement');

afterAll(restoreServerEnvironment);

const TX_HASH = `0x${'ef'.repeat(32)}`;

describe('confirmed-intent sweep', () => {
  beforeEach(() => {
    vi.mocked(completeRelayedIntent).mockClear().mockResolvedValue(true);
    vi.mocked(listConfirmedUnsettledIntents).mockReset();
  });

  it('completes an intent whose transaction confirmed while the intent stayed unfinished', async () => {
    const intent = { id: 'intent-1', operation: 'tasks.assignEvaluator', txHash: TX_HASH };
    vi.mocked(listConfirmedUnsettledIntents).mockResolvedValue([intent as never]);

    // Resolved and asserted rather than called optionally: `sweepConfirmed?.()` on an undefined
    // method short-circuits, and the test would pass having exercised nothing.
    const { sweepConfirmed } = createRelayedIntentSettlement();
    expect(sweepConfirmed).toBeDefined();
    await sweepConfirmed!(25);

    // This is the state nothing used to look for: the receipt is good, the work happened, and
    // the reconciler's broadcast pass will never examine the row again.
    expect(completeRelayedIntent).toHaveBeenCalledTimes(1);
    expect(vi.mocked(completeRelayedIntent).mock.calls[0]?.[0]).toMatchObject({
      intent,
      txHash: TX_HASH,
    });
  });

  it('skips an intent that was never linked to a broadcast', async () => {
    vi.mocked(listConfirmedUnsettledIntents).mockResolvedValue([
      { id: 'intent-2', operation: 'tasks.assignEvaluator', txHash: null } as never,
    ]);

    const { sweepConfirmed } = createRelayedIntentSettlement();
    expect(sweepConfirmed).toBeDefined();
    await sweepConfirmed!(25);

    expect(completeRelayedIntent).not.toHaveBeenCalled();
  });
});

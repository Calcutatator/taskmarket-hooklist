// Verifies: ADR-0045, ADR-0050, ADR-0052
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { stubServerEnvironment } from '../../helpers/server-environment';

const restoreServerEnvironment = stubServerEnvironment();

const TX_HASH = `0x${'ab'.repeat(32)}` as `0x${string}`;
const PAYMENT_HASH = `0x${'11'.repeat(32)}` as `0x${string}`;
const KEY = '11111111-2222-4333-8444-555555555555';

type Row = {
  broadcastAttempts: number;
  id: string;
  operation: string;
  paymentTxHash: string | null;
  status: string;
  txHash: string | null;
};

const recorded = vi.fn<[], Row>();
const persisted: { intentId: string; txHash: string }[] = [];

/**
 * The claim is a single conditional UPDATE against one row, so the honest double is a
 * counter: the first caller's predicate matches, every later one finds the row already
 * moved. That is exactly what the real `claimIntentForBroadcast` does, and it is what a
 * status read cannot do -- two readers both see `recorded`.
 */
let claimsGranted = 0;
let claimBudget = 1;

vi.mock('../../../src/services/relayed-intents', async () => {
  const actual = await vi.importActual<Record<string, unknown>>(
    '../../../src/services/relayed-intents'
  );
  return {
    ...actual,
    claimIntentForBroadcast: vi.fn(async () => {
      if (claimsGranted >= claimBudget) return null;
      claimsGranted += 1;
      return recorded();
    }),
    getRelayedIntent: vi.fn(async () => recorded()),
    persistIntentBroadcast: vi.fn(async (input: { intentId: string; txHash: string }) => {
      persisted.push({ intentId: input.intentId, txHash: input.txHash });
    }),
    recordRelayedIntent: vi.fn(async () => recorded()),
    relayEnvelopeForIntent: () => ({ receiptNonce: `0x${'00'.repeat(32)}`, validBefore: 0n }),
  };
});

vi.mock('../../../src/services/relayed-intent-registry', () => ({
  completeRelayedIntent: vi.fn(async () => true),
}));

vi.mock('../../../src/services/intents/register', () => ({
  registerRelayedIntentHandlers: () => undefined,
}));

const { runRelayedIntent } = await import('../../../src/services/relayed-intent-request');

afterAll(restoreServerEnvironment);

function row(overrides: Partial<Row> = {}): Row {
  return {
    broadcastAttempts: 0,
    id: 'intent-1',
    operation: 'tasks.create',
    paymentTxHash: PAYMENT_HASH,
    status: 'recorded',
    txHash: null,
    ...overrides,
  };
}

async function run(send: () => Promise<`0x${string}`>) {
  return runRelayedIntent({
    db: {} as never,
    idempotencyKey: KEY,
    operation: 'tasks.create',
    payload: {},
    paymentTxHash: PAYMENT_HASH,
    send,
  });
}

describe('runRelayedIntent', () => {
  beforeEach(() => {
    persisted.length = 0;
    claimsGranted = 0;
    claimBudget = 1;
    recorded.mockReset();
  });

  it('persists the broadcast hash before anything that could fail after it', async () => {
    recorded.mockReturnValue(row());
    const send = vi.fn().mockResolvedValue(TX_HASH);

    await run(send);

    // `listUnbroadcastIntents` rebroadcasts an intent with no hash, on the grounds that no nonce
    // was ever allocated for it. Leaving the hash unwritten after a successful send makes a live
    // transaction look exactly like that -- one payment, two chain calls (ADR-0050).
    expect(persisted).toEqual([{ intentId: 'intent-1', txHash: TX_HASH }]);
  });

  it('returns the recorded result for a retry whose intent already completed', async () => {
    // `recordRelayedIntent` is keyed on the caller's idempotency key, so a retry of the same
    // operation gets the original intent back. That reuse is what makes the write idempotent.
    recorded.mockReturnValue(row({ status: 'completed', txHash: TX_HASH }));
    const send = vi.fn();

    const result = await run(send);

    expect(result.txHash).toBe(TX_HASH);
    expect(send).not.toHaveBeenCalled();
  });

  it('refuses to send again for an intent that is already on chain', async () => {
    // Claim budget of zero stands for a row the real predicate would no longer match.
    claimBudget = 0;
    recorded.mockReturnValue(row({ status: 'broadcast', txHash: TX_HASH }));
    const send = vi.fn();

    await expect(run(send)).rejects.toThrow(/already broadcast/);
    // The whole point: one settled payment must never buy two contract calls.
    expect(send).not.toHaveBeenCalled();
  });

  it('refuses to send again for an intent that already failed', async () => {
    claimBudget = 0;
    recorded.mockReturnValue(row({ status: 'failed' }));
    const send = vi.fn();

    await expect(run(send)).rejects.toThrow(/already failed/);
    expect(send).not.toHaveBeenCalled();
  });

  it('makes exactly one chain call when two concurrent requests share an idempotency key', async () => {
    // The defect this closes. Both requests resolve to the same `recorded` intent, both read
    // it as unsent, and before the claim both called `send()`: a unique index stops a second
    // row, never a second transaction against one row. Only the claim does that.
    recorded.mockReturnValue(row());
    const send = vi.fn().mockResolvedValue(TX_HASH);

    const results = await Promise.allSettled([run(send), run(send)]);

    expect(send).toHaveBeenCalledTimes(1);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);

    const loser = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    // The loser is told where to look rather than made to wait for the winner: it holds the
    // intent id and its own key, and both resolve on the status surface.
    expect(String(loser.reason)).toMatch(/intents\.get/);
  });

  it('rejects a relayed write with no idempotency key', async () => {
    // Not defaulted, not derived from the payment, not made optional for any operation: a
    // key the backend invented would be fresh on every retry, which is no idempotency at all.
    const actual = await vi.importActual<typeof import('../../../src/services/relayed-intents')>(
      '../../../src/services/relayed-intents'
    );

    await expect(
      actual.recordRelayedIntent({
        db: {} as never,
        idempotencyKey: undefined,
        operation: 'tasks.create',
        payload: {},
      })
    ).rejects.toThrow(/Idempotency-Key/);
  });
});

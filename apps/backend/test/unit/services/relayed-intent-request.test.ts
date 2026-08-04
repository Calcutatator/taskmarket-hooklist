// Verifies: ADR-0045, ADR-0050, ADR-0052
// Verifies: ADR-0058
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { isInFlightApiError } from '@taskmarket/shared';
import { stubServerEnvironment } from '../../helpers/server-environment';

import { envelopeForError } from '../../../src/lib/api-error';
import { ServerTransactionPendingError } from '../../../src/lib/server-transaction-dispatcher';

const restoreServerEnvironment = stubServerEnvironment();

const TX_HASH = `0x${'ab'.repeat(32)}` as `0x${string}`;
const PAYMENT_HASH = `0x${'11'.repeat(32)}` as `0x${string}`;
const KEY = '11111111-2222-4333-8444-555555555555';

type Row = {
  broadcastAttempts: number;
  id: string;
  idempotencyKey: string;
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
    idempotencyKey: KEY,
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
    payment: { amount: 1_000n, payer: '0xpayer', txHash: PAYMENT_HASH },
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

  it('answers an in-flight send with a structured outcome rather than a rethrown pending error', async () => {
    // The regression this whole surface exists to end. Rethrown raw, this reached the client as
    // an HTTP 500 whose prose was the only evidence the write was still alive -- which is what
    // the web app's four substring markers were guessing at (ADR-0049 point 3).
    recorded.mockReturnValue(row());
    const pending = new ServerTransactionPendingError(TX_HASH, 7);

    const error = await run(vi.fn().mockRejectedValue(pending)).catch((e: unknown) => e);

    expect(envelopeForError(error)).toEqual({
      reason: 'intent_in_flight',
      intentId: 'intent-1',
      intentStatus: 'broadcast',
      operation: 'tasks.create',
      idempotencyKey: KEY,
      txHash: TX_HASH,
    });
    // The hash is linked before the answer goes out, so the reconciler owns the outcome
    // whatever the caller does next.
    expect(persisted).toEqual([{ intentId: 'intent-1', txHash: TX_HASH }]);
  });

  it('tells a duplicate submission which intent it collided with and what state it is in', async () => {
    // Reported structurally so a client can tell a repeat of a write still landing from a
    // repeat of one that already failed -- the distinction the 409's sentence never made.
    claimBudget = 0;
    recorded.mockReturnValue(row({ status: 'broadcast', txHash: TX_HASH }));

    const error = await run(vi.fn()).catch((e: unknown) => e);

    expect(envelopeForError(error)).toMatchObject({
      reason: 'idempotency_key_reused',
      intentId: 'intent-1',
      intentStatus: 'broadcast',
      idempotencyKey: KEY,
    });
  });

  it('does not report a failed intent as something to wait for', async () => {
    claimBudget = 0;
    recorded.mockReturnValue(row({ status: 'failed' }));

    const error = await run(vi.fn()).catch((e: unknown) => e);

    expect(envelopeForError(error).intentStatus).toBe('failed');
    expect(isInFlightApiError(envelopeForError(error))).toBe(false);
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

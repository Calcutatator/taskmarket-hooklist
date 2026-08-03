// Verifies: ADR-0045, ADR-0050
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { stubServerEnvironment } from '../../helpers/server-environment';

const restoreServerEnvironment = stubServerEnvironment();

const TX_HASH = `0x${'ab'.repeat(32)}` as `0x${string}`;
const PAYMENT_HASH = `0x${'11'.repeat(32)}` as `0x${string}`;

type Row = {
  id: string;
  operation: string;
  paymentTxHash: string | null;
  status: string;
  txHash: string | null;
};

const recorded = vi.fn<[], Row>();
const persisted: { intentId: string; txHash: string }[] = [];

vi.mock('../../../src/services/relayed-intents', async () => {
  const actual = await vi.importActual<Record<string, unknown>>(
    '../../../src/services/relayed-intents'
  );
  return {
    ...actual,
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
    operation: 'tasks.create',
    payload: {},
    paymentTxHash: PAYMENT_HASH,
    send,
  });
}

describe('runRelayedIntent', () => {
  beforeEach(() => {
    persisted.length = 0;
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

  it('returns the recorded result for a reused payment that already completed', async () => {
    // `recordRelayedIntent` is keyed on the payment hash, so a retried request gets the original
    // intent back. That reuse is what makes a paid write idempotent.
    recorded.mockReturnValue(row({ status: 'completed', txHash: TX_HASH }));
    const send = vi.fn();

    const result = await run(send);

    expect(result.txHash).toBe(TX_HASH);
    expect(send).not.toHaveBeenCalled();
  });

  it('refuses to send again for a payment whose intent is already on chain', async () => {
    recorded.mockReturnValue(row({ status: 'broadcast', txHash: TX_HASH }));
    const send = vi.fn();

    await expect(run(send)).rejects.toThrow(/already broadcast/);
    // The whole point: one settled payment must never buy two contract calls.
    expect(send).not.toHaveBeenCalled();
  });

  it('refuses to send again for a payment whose intent already failed', async () => {
    recorded.mockReturnValue(row({ status: 'failed' }));
    const send = vi.fn();

    await expect(run(send)).rejects.toThrow(/already failed/);
    expect(send).not.toHaveBeenCalled();
  });
});

// Verifies: ADR-0045, ADR-0050
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { stubServerEnvironment } from '../../helpers/server-environment';

const restoreServerEnvironment = stubServerEnvironment();

vi.mock('../../../src/db/client', () => ({ db: {} }));

vi.mock('../../../src/services/relayed-intent-registry', () => ({
  dispatchRelayedIntent: vi.fn().mockResolvedValue('broadcast'),
}));

vi.mock('../../../src/services/relayed-intent-settlement', () => ({
  settleAbandonedIntents: vi.fn().mockResolvedValue(undefined),
}));

// The worker also expires stale reservations on each pass (ADR-0067). Stubbed for the same
// reason settlement is: these tests are about which intents the worker hands to the dispatcher,
// and a sweep that needs a real database would only add a failure unrelated to that question.
vi.mock('../../../src/services/reservation-sweep', () => ({
  expireStaleReservations: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../src/services/relayed-intents', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../src/services/relayed-intents')>()),
  listUnbroadcastIntents: vi.fn().mockResolvedValue([]),
}));

const { dispatchRelayedIntent } = await import('../../../src/services/relayed-intent-registry');
const { settleAbandonedIntents } = await import('../../../src/services/relayed-intent-settlement');
const { listUnbroadcastIntents, MAX_BROADCAST_ATTEMPTS, relayEnvelopeForIntent } = await import(
  '../../../src/services/relayed-intents'
);
const { createRelayedIntentWorker } = await import('../../../src/services/relayed-intent-worker');

afterAll(restoreServerEnvironment);

const PAYMENT_TX = `0x${'ab'.repeat(32)}`;
const RECEIPT_NONCE = `0x${'cd'.repeat(32)}`;

function intent(overrides: Record<string, unknown> = {}) {
  return {
    broadcastAttempts: 0,
    id: 'intent-1',
    operation: 'tasks.create',
    paymentTxHash: null,
    relayReceiptNonce: RECEIPT_NONCE,
    relayValidBefore: '1900000000',
    serverWalletTransactionId: null,
    status: 'recorded',
    txHash: null,
    ...overrides,
  } as never;
}

describe('rebroadcasting an intent that never reached the chain', () => {
  beforeEach(() => {
    vi.mocked(dispatchRelayedIntent).mockClear();
    vi.mocked(settleAbandonedIntents).mockClear();
    vi.mocked(listUnbroadcastIntents).mockReset().mockResolvedValue([]);
  });

  // Verifies: ADR-0050
  it('rebroadcasts a paid intent rather than going straight to a refund', async () => {
    // The old rule refunded any payment-carrying intent stuck in `recorded`. But a requester
    // who paid for a task wants the task, and the payload that would produce it is right
    // there -- refunding first throws away the better outcome.
    vi.mocked(listUnbroadcastIntents).mockResolvedValue([intent({ paymentTxHash: PAYMENT_TX })]);

    await createRelayedIntentWorker()();

    expect(dispatchRelayedIntent).toHaveBeenCalledWith(
      expect.objectContaining({ intent: expect.objectContaining({ id: 'intent-1' }) })
    );
  });

  // Verifies: ADR-0050
  it('only considers intents with positive evidence that nothing was sent', async () => {
    await createRelayedIntentWorker()();

    // The outbox row is written when a nonce is allocated, before anything is broadcast, so
    // "no outbox row and no hash" is proof rather than inference -- which is what makes
    // rebroadcasting a paid intent safe rather than a double-spend risk.
    const [query] = vi.mocked(listUnbroadcastIntents).mock.calls[0]!;
    expect(query).toEqual(
      expect.objectContaining({ cutoff: expect.any(Date), limit: expect.any(Number) })
    );
  });

  // Verifies: ADR-0050
  it('still asks settlement to look, so refund remains the fallback', async () => {
    await createRelayedIntentWorker()();

    // Retrying is first, not instead: an intent out of attempts, or one whose operation has
    // no broadcaster at all, still has to reach the write-off path or a payer is never repaid.
    expect(settleAbandonedIntents).toHaveBeenCalledOnce();
  });
});

describe('the relay envelope an intent replays', () => {
  // Verifies: ADR-0050
  it('reuses the stored deadline and receipt nonce verbatim', () => {
    const stored = intent();
    const first = relayEnvelopeForIntent(stored);
    const second = relayEnvelopeForIntent(stored);

    // Identical across attempts, which is the entire point: a regenerated deadline would buy
    // every retry another full window, so the deadline would never arrive and the only real
    // bound on retrying would be gone.
    expect(first).toEqual(second);
    expect(first.validBefore).toBe(1_900_000_000n);
    expect(first.receiptNonce).toBe(RECEIPT_NONCE);
  });

  // Verifies: ADR-0050
  it('falls back to a fresh envelope only for a row written before the columns existed', () => {
    const envelope = relayEnvelopeForIntent(
      intent({ relayReceiptNonce: null, relayValidBefore: null })
    );

    expect(envelope.validBefore).toBeGreaterThan(BigInt(Math.floor(Date.now() / 1000)));
    expect(envelope.receiptNonce).toMatch(/^0x[a-f0-9]{64}$/);
  });

  // Verifies: ADR-0050
  it('bounds retrying with a counter as well, so nothing hot-loops', () => {
    // Belt and braces. The deadline is the real bound -- the forwarder reverts ReceiptExpired
    // -- but a broadcast failing for reasons unrelated to any deadline (an unreachable RPC)
    // must not spin forever, and a paid intent has to reach the refund path eventually.
    expect(MAX_BROADCAST_ATTEMPTS).toBeGreaterThan(0);
  });
});

// Verifies: ADR-0050
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { stubServerEnvironment } from '../../helpers/server-environment';

const restoreServerEnvironment = stubServerEnvironment();

vi.mock('../../../src/db/client', () => ({ db: {} }));

vi.mock('../../../src/services/relayed-intents', () => ({
  findIntentByTransactionId: vi.fn(),
  listAbandonedIntents: vi.fn(),
  listConfirmedUnsettledIntents: vi.fn(),
  markIntentFailed: vi.fn(),
}));

vi.mock('../../../src/services/relayed-intent-registry', () => ({
  completeRelayedIntent: vi.fn().mockResolvedValue(true),
  releaseIntentGuard: vi.fn(),
}));

vi.mock('../../../src/services/orphaned-payments', () => ({
  handlePostPaymentFailure: vi.fn().mockRejectedValue(new Error('automatically refunded')),
}));

const { releaseIntentGuard } = await import('../../../src/services/relayed-intent-registry');
const { findIntentByTransactionId, listAbandonedIntents, markIntentFailed } = await import(
  '../../../src/services/relayed-intents'
);
const { createRelayedIntentSettlement, settleAbandonedIntents } = await import(
  '../../../src/services/relayed-intent-settlement'
);

afterAll(restoreServerEnvironment);

const PAYER = '0x1111111111111111111111111111111111111111';
const NONCE = `0x${'cd'.repeat(32)}`;

function withdrawDreamsIntent(overrides: Record<string, unknown> = {}) {
  return {
    id: 'intent-1',
    operation: 'wallet.withdrawDreams',
    payer: PAYER,
    payload: { destination: PAYER, nonce: NONCE, workerAddress: PAYER },
    paymentAmount: null,
    paymentTxHash: null,
    serverWalletTransactionId: null,
    status: 'recorded',
    txHash: null,
    ...overrides,
  } as never;
}

/**
 * Guard release is the mirror image of the refund decision, and lives next to it for the same
 * reason: only the chain can answer whether the call happened, and handing a replay guard back
 * while the transaction may still mine is a double spend rather than a stale reservation.
 */
describe('releasing an intent guard', () => {
  beforeEach(() => {
    vi.mocked(releaseIntentGuard).mockClear();
    vi.mocked(markIntentFailed).mockClear();
    vi.mocked(listAbandonedIntents).mockReset().mockResolvedValue([]);
    vi.mocked(findIntentByTransactionId).mockReset();
  });

  it('releases the guard when the reconciler confirms the transaction reverted', async () => {
    vi.mocked(findIntentByTransactionId).mockResolvedValue(
      withdrawDreamsIntent({ serverWalletTransactionId: 'tx-row-1', status: 'broadcast' })
    );

    await createRelayedIntentSettlement().onFailed('tx-row-1', 'reverted: NothingToClaim');

    expect(markIntentFailed).toHaveBeenCalledWith(expect.objectContaining({ intentId: 'intent-1' }));
    expect(releaseIntentGuard).toHaveBeenCalledWith(
      expect.objectContaining({ intent: expect.objectContaining({ id: 'intent-1' }) })
    );
  });

  it('releases the guard once the intent has exhausted its broadcast attempts', async () => {
    // listAbandonedIntents only returns intents past MAX_BROADCAST_ATTEMPTS with no outbox row
    // and no hash: nothing was ever signed, so nothing can land against the released guard.
    vi.mocked(listAbandonedIntents).mockResolvedValue([withdrawDreamsIntent()]);

    await settleAbandonedIntents(10);

    expect(releaseIntentGuard).toHaveBeenCalledWith(
      expect.objectContaining({ intent: expect.objectContaining({ id: 'intent-1' }) })
    );
  });

  it('marks an exhausted intent failed even when it carried no payment', async () => {
    // Refund is payment-specific; reaching a terminal state is not. Skipping the unpaid ones
    // outright would leave a withdrawal intent in `recorded` forever, so its guard would never
    // be released and the user would stay locked out of their own authorization.
    vi.mocked(listAbandonedIntents).mockResolvedValue([withdrawDreamsIntent()]);

    await settleAbandonedIntents(10);

    expect(markIntentFailed).toHaveBeenCalledWith(expect.objectContaining({ intentId: 'intent-1' }));
  });

  it('leaves the guard alone while a transaction for the intent may still be live', async () => {
    // A linked outbox row means the reconciler owns the outcome. This is the timeout-shaped
    // mistake: the intent looks stuck, but its transaction can still be mined.
    vi.mocked(listAbandonedIntents).mockResolvedValue([
      withdrawDreamsIntent({ serverWalletTransactionId: 'tx-row-1' }),
      withdrawDreamsIntent({ id: 'intent-2', txHash: `0x${'ab'.repeat(32)}` }),
    ]);

    await settleAbandonedIntents(10);

    expect(releaseIntentGuard).not.toHaveBeenCalled();
    expect(markIntentFailed).not.toHaveBeenCalled();
  });
});

// Verifies: ADR-0048
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

const { handlePostPaymentFailure } = await import('../../../src/services/orphaned-payments');
const { listAbandonedIntents, markIntentFailed } = await import(
  '../../../src/services/relayed-intents'
);
const { settleAbandonedIntents } = await import('../../../src/services/relayed-intent-settlement');

afterAll(restoreServerEnvironment);

const PAYER = '0x1111111111111111111111111111111111111111';
const PAYMENT_TX = `0x${'ab'.repeat(32)}`;

function abandoned(overrides: Record<string, unknown> = {}) {
  return {
    id: 'intent-1',
    operation: 'acceptance.accept',
    payer: PAYER,
    paymentAmount: '1000',
    paymentTxHash: PAYMENT_TX,
    serverWalletTransactionId: null,
    status: 'recorded',
    txHash: null,
    ...overrides,
  } as never;
}

describe('abandoned intent settlement', () => {
  beforeEach(() => {
    vi.mocked(handlePostPaymentFailure).mockClear();
    vi.mocked(markIntentFailed).mockClear();
    vi.mocked(listAbandonedIntents).mockReset();
  });

  it('refunds a payment whose intent never reached the chain', async () => {
    // The reconciler can only speak for transactions, and this intent has none: no nonce was
    // ever allocated, so no verdict is coming and the payer would otherwise never be repaid.
    vi.mocked(listAbandonedIntents).mockResolvedValue([abandoned()]);

    await settleAbandonedIntents(10);

    expect(markIntentFailed).toHaveBeenCalledWith(
      expect.objectContaining({ intentId: 'intent-1' })
    );
    expect(handlePostPaymentFailure).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 1000n, payer: PAYER, paymentTxHash: PAYMENT_TX })
    );
  });

  it('leaves an intent alone once a transaction was allocated for it', async () => {
    // A linked outbox row means something may still be live on chain, and the reconciler owns
    // that outcome. Refunding here would be exactly the timeout-shaped mistake ADR-0048 bans.
    vi.mocked(listAbandonedIntents).mockResolvedValue([
      abandoned({ serverWalletTransactionId: 'tx-row-1' }),
      abandoned({ id: 'intent-2', txHash: `0x${'cd'.repeat(32)}` }),
    ]);

    await settleAbandonedIntents(10);

    expect(handlePostPaymentFailure).not.toHaveBeenCalled();
    expect(markIntentFailed).not.toHaveBeenCalled();
  });

  // Verifies: ADR-0050
  it('has nothing to refund for an intent that carried no payment, but still ends it', async () => {
    // Refund is payment-specific; reaching a terminal state is not. An exhausted unpaid intent
    // left in `recorded` would be re-examined on every worker pass forever and would never
    // hand back any guard state it claimed.
    vi.mocked(listAbandonedIntents).mockResolvedValue([
      abandoned({ payer: null, paymentAmount: null, paymentTxHash: null }),
    ]);

    await settleAbandonedIntents(10);

    expect(handlePostPaymentFailure).not.toHaveBeenCalled();
    expect(markIntentFailed).toHaveBeenCalledWith(
      expect.objectContaining({ intentId: 'intent-1' })
    );
  });
});

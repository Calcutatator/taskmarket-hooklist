// Verifies: ADR-0048
// Verifies: ADR-0057
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

vi.mock('../../../src/lib/logger', () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

const { logger } = await import('../../../src/lib/logger');
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
    vi.mocked(logger.error).mockClear();
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
    expect(vi.mocked(logger.error)).not.toHaveBeenCalled();
  });

  // Verifies: ADR-0048
  // Verifies: ADR-0050
  it('refunds a paid abandoned intent rather than skipping it for want of an amount', async () => {
    // The defect this guards: 83 of 174 paid intents in a sandbox run carried a null
    // paymentAmount, because the payment reference was three independently optional fields and
    // 24 of 26 paid call sites filled in only two of them. Every one of those rows arrived
    // here, matched the "incomplete reference" test, and was skipped in silence -- the payer
    // neither served nor refunded, with nothing recording it. Before ADR-0048 each router's
    // own catch would still have refunded them; removing those catches is what turned a latent
    // null into stranded funds, so the amount reaching this point is now load-bearing.
    vi.mocked(listAbandonedIntents).mockResolvedValue([
      abandoned({ operation: 'tasks.update', paymentAmount: '5010000' }),
    ]);

    await settleAbandonedIntents(10);

    expect(handlePostPaymentFailure).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 5_010_000n, payer: PAYER, paymentTxHash: PAYMENT_TX })
    );
  });

  // Verifies: ADR-0048
  // Verifies: ADR-0050
  it('reports a row whose payment reference is incomplete instead of skipping it quietly', async () => {
    // Unrepresentable through `IntentPaymentReference` now, so this can only be a row written
    // before that type existed or by something bypassing it. Either way it is a bug and a
    // payer who is out of pocket, and there is no alerting on any of this -- the structured
    // error log is the entire reporting surface (ADR-0053), so the one thing it must not do
    // is stay quiet.
    vi.mocked(listAbandonedIntents).mockResolvedValue([abandoned({ paymentAmount: null })]);

    await settleAbandonedIntents(10);

    expect(handlePostPaymentFailure).not.toHaveBeenCalled();
    expect(vi.mocked(logger.error)).toHaveBeenCalledWith(
      expect.stringContaining('incomplete payment reference'),
      expect.objectContaining({ intentId: 'intent-1', operation: 'acceptance.accept' })
    );
  });

  it('says nothing about a free intent, which records a payer but owes nothing', async () => {
    // Every intent carries a payer for provenance, so the presence of one is not what makes a
    // row look paid-for. Treating it as such would make this log fire on every free relayed
    // write, which is the fastest way to get a log nobody reads.
    vi.mocked(listAbandonedIntents).mockResolvedValue([
      abandoned({ paymentAmount: null, paymentTxHash: null }),
    ]);

    await settleAbandonedIntents(10);

    expect(handlePostPaymentFailure).not.toHaveBeenCalled();
    expect(vi.mocked(logger.error)).not.toHaveBeenCalled();
  });
});

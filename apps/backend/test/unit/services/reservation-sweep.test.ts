// Verifies: ADR-0067
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { stubServerEnvironment } from '../../helpers/server-environment';

const restoreServerEnvironment = stubServerEnvironment();

vi.mock('../../../src/db/client', () => ({ db: {} }));

vi.mock('../../../src/lib/logger', () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const readContract = vi.fn();
vi.mock('../../../src/lib/rpc-gateway', () => ({
  getPublicClient: () => ({ readContract }),
}));

vi.mock('../../../src/services/relayed-intents', async (importOriginal) => ({
  deleteReservation: vi.fn().mockResolvedValue(undefined),
  holdReservationForReview: vi.fn().mockResolvedValue(undefined),
  // The real predicate, not a copy: it decides whether the sweep can ask the token contract
  // about a row at all, and a stub that drifted from it would make these tests agree with
  // themselves rather than with the code.
  isEncodableAuthorizationPair: (
    await importOriginal<typeof import('../../../src/services/relayed-intents')>()
  ).isEncodableAuthorizationPair,
  listExpiredReservations: vi.fn().mockResolvedValue([]),
  retireUnpaidReservation: vi.fn().mockResolvedValue(undefined),
}));

const { expireStaleReservations } = await import('../../../src/services/reservation-sweep');
const {
  deleteReservation,
  holdReservationForReview,
  listExpiredReservations,
  retireUnpaidReservation,
} = await import('../../../src/services/relayed-intents');

const PAYER = '0x1111111111111111111111111111111111111111';
const NONCE = `0x${'ab'.repeat(32)}`;

function reservation(overrides: Record<string, unknown> = {}) {
  return {
    id: 'intent-1',
    operation: 'x402.reservation',
    paymentAuthAmount: null,
    paymentAuthNonce: null,
    paymentAuthPayer: null,
    status: 'reserved',
    ...overrides,
  } as never;
}

afterAll(restoreServerEnvironment);

describe('expiring a reservation nobody filled', () => {
  beforeEach(() => {
    vi.mocked(deleteReservation).mockClear();
    vi.mocked(holdReservationForReview).mockClear();
    vi.mocked(retireUnpaidReservation).mockClear();
    readContract.mockReset();
  });

  /**
   * The write-ahead record is what makes this branch safe. It is written before the settle
   * call, so its absence is positive evidence that the call was never made -- not the
   * inference-from-absence the ADR forbids.
   */
  it('drops a reservation that never named an authorization, without asking the chain', async () => {
    vi.mocked(listExpiredReservations).mockResolvedValue([reservation()]);

    await expireStaleReservations(10);

    expect(readContract).not.toHaveBeenCalled();
    expect(deleteReservation).toHaveBeenCalledWith(
      expect.objectContaining({ intentId: 'intent-1' })
    );
  });

  /**
   * Verifies: ADR-0069. `authorizationState` is false while a settlement is still in the
   * mempool, so an unconsumed authorization is not proof that none ever will be. The row --
   * and with it the write-ahead (payer, nonce) record -- is retained rather than destroyed.
   */
  it('retains, rather than deletes, a reservation whose authorization is still unused', async () => {
    vi.mocked(listExpiredReservations).mockResolvedValue([
      reservation({ paymentAuthNonce: NONCE, paymentAuthPayer: PAYER }),
    ]);
    readContract.mockResolvedValue(false);

    await expireStaleReservations(10);

    expect(readContract).toHaveBeenCalledWith(
      expect.objectContaining({ args: [PAYER, NONCE], functionName: 'authorizationState' })
    );
    expect(deleteReservation).not.toHaveBeenCalled();
    expect(retireUnpaidReservation).toHaveBeenCalledWith(
      expect.objectContaining({ intentId: 'intent-1' })
    );
  });

  /**
   * A row poisoned before the write-side validation existed (ADR-0077).
   *
   * `payment_auth_*` are written verbatim from an attacker-supplied header before the
   * facilitator verifies anything, and both columns are `text`. A value outside `(address,
   * bytes32)` cannot be encoded, so the read below used to throw on every pass and land in the
   * branch that leaves the row for later -- forever. Ten such rows held the whole ten-row window
   * and `holdReservationForReview`, the safety net two tests below, stopped running at all.
   *
   * The chain is never asked here: an unencodable pair is an answered question, not an
   * unanswered one.
   */
  it('retires a reservation whose recorded authorization could never be valid', async () => {
    vi.mocked(listExpiredReservations).mockResolvedValue([
      reservation({ paymentAuthNonce: 'zz', paymentAuthPayer: 'attacker' }),
    ]);

    await expireStaleReservations(10);

    expect(readContract).not.toHaveBeenCalled();
    expect(deleteReservation).not.toHaveBeenCalled();
    expect(retireUnpaidReservation).toHaveBeenCalledWith(
      expect.objectContaining({ intentId: 'intent-1' })
    );
  });

  /**
   * The case the whole rule exists for. The caller paid and the process died before the payment
   * could be attached; after the fact this looks exactly like an abandoned challenge, and only
   * the token contract can tell them apart. Deleting here would discard a settled payment.
   */
  it('never expires a reservation whose authorization was consumed on chain', async () => {
    vi.mocked(listExpiredReservations).mockResolvedValue([
      reservation({ paymentAuthAmount: '1000', paymentAuthNonce: NONCE, paymentAuthPayer: PAYER }),
    ]);
    readContract.mockResolvedValue(true);

    await expireStaleReservations(10);

    expect(deleteReservation).not.toHaveBeenCalled();
    expect(holdReservationForReview).toHaveBeenCalledWith(
      expect.objectContaining({ intentId: 'intent-1' })
    );
  });

  /**
   * Unanswered is not "no". An RPC failure leaves the question open, and the safe reading of an
   * open question about money is to do nothing and look again next pass.
   */
  it('leaves a reservation alone when the chain could not answer', async () => {
    vi.mocked(listExpiredReservations).mockResolvedValue([
      reservation({ paymentAuthNonce: NONCE, paymentAuthPayer: PAYER }),
    ]);
    readContract.mockRejectedValue(new Error('rpc down'));

    await expireStaleReservations(10);

    expect(deleteReservation).not.toHaveBeenCalled();
    expect(holdReservationForReview).not.toHaveBeenCalled();
  });

  it('keeps sweeping when one reservation throws', async () => {
    vi.mocked(listExpiredReservations).mockResolvedValue([
      reservation({ id: 'bad' }),
      reservation({ id: 'good' }),
    ]);
    vi.mocked(deleteReservation)
      .mockRejectedValueOnce(new Error('write failed'))
      .mockResolvedValue(undefined);

    await expireStaleReservations(10);

    expect(deleteReservation).toHaveBeenCalledTimes(2);
  });
});

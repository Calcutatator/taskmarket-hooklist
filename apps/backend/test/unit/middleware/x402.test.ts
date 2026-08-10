import { beforeEach, describe, expect, it, vi } from 'vitest';

const PAY_TO = '0x0000000000000000000000000000000000000001';
const USDC = '0x0000000000000000000000000000000000000002';
const PAYER = '0x0000000000000000000000000000000000000003';

vi.mock('../../../src/config/env', () => ({
  getServerConfig: () => ({
    CHAIN_ID: 8453,
    USDC_TOKEN_ADDRESS: USDC,
    USDC_DOMAIN_NAME: 'USD Coin',
    X402_FACILITATOR_URL: 'https://facilitator.example',
    X402_FACILITATOR_TOKEN: undefined,
  }),
}));

vi.mock('../../../src/lib/wallet', () => ({
  createServerWallet: () => ({ address: PAY_TO }),
}));

vi.mock('../../../src/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../../src/db/client', () => ({ db: {} }));

// The reservation is a database write, so the double is its verdict, not the statement. What
// matters for these tests is *when* it is consulted -- on the round that carries the payment,
// before anything is settled -- which the ordering assertions below check directly. The race it
// arbitrates cannot be reproduced against a double at all, and is tested against a real database
// in test/integration/x402-reservation-concurrency.test.ts (ADR-0067, ADR-0068).
const KEY_PATTERN = /^[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$/;
const idempotencyVerdict = vi.fn<[], { error: string; status: number } | null>(() => null);
vi.mock('../../../src/services/relayed-intents', () => ({
  // Shape only, mirroring the real validator: it is a pure function over the header, so the
  // double may as well answer the same way the middleware's callers will see in production.
  idempotencyKeyRefusal: (key: string | undefined) =>
    key && KEY_PATTERN.test(key)
      ? undefined
      : { error: 'missing key', status: 400, envelope: { reason: 'idempotency_key_required' } },
  recordIntentPaymentAuthorization: vi.fn(async () => undefined),
  releaseUnpaidReservation: vi.fn(async () => undefined),
  reserveRelayedWrite: vi.fn(async () => {
    const refusal = idempotencyVerdict();
    return refusal ? { refusal } : { intent: { id: 'intent-reserved' } };
  }),
}));

import {
  X402PreflightError,
  settledPaymentReference,
  x402Middleware,
} from '../../../src/middleware/x402';

function paymentHeader(amount = '1000') {
  const payload = {
    x402Version: 2,
    accepted: {
      scheme: 'exact',
      network: 'eip155:8453',
      amount,
      asset: USDC,
      payTo: PAY_TO,
      maxTimeoutSeconds: 300,
      extra: {},
    },
    payload: {
      authorization: {
        from: PAYER,
        to: PAY_TO,
        value: amount,
        validBefore: String(Math.floor(Date.now() / 1000) + 300),
      },
      signature: '0xsig',
    },
  };
  return Buffer.from(JSON.stringify(payload)).toString('base64');
}

function request(header = paymentHeader()) {
  return {
    body: {},
    headers: {
      'payment-signature': header,
      'x-taskmarket-idempotency-key': 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
    },
    protocol: 'https',
    get: () => 'api.example',
    originalUrl: '/api/tasks/0xtask/cancel',
    path: '/tasks/0xtask/cancel',
  } as never;
}

function response() {
  const res: Record<string, unknown> = {
    locals: {},
    once: vi.fn(),
    setHeader: vi.fn(),
    status: vi.fn(),
    json: vi.fn(),
  };
  vi.mocked(res.status as ReturnType<typeof vi.fn>).mockReturnValue(res);
  return res as never;
}

describe('x402 middleware settlement safety', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ success: true, transaction: '0xtx', payer: PAYER }),
      })
    );
  });

  it('rejects underpayment without calling the facilitator', async () => {
    const res = response();
    const next = vi.fn();
    const middleware = x402Middleware({ getAmount: () => '1000' });

    await middleware(request(paymentHeader('1')), res, next);

    expect(fetch).not.toHaveBeenCalled();
    expect((res as { status: ReturnType<typeof vi.fn> }).status).toHaveBeenCalledWith(402);
    expect(next).not.toHaveBeenCalled();
  });

  it('runs semantic preflight before settlement', async () => {
    const res = response();
    const next = vi.fn();
    const middleware = x402Middleware({
      getAmount: () => '1000',
      preflight: async () => {
        throw new X402PreflightError('Task is not open');
      },
    });

    await middleware(request(), res, next);

    expect(fetch).not.toHaveBeenCalled();
    expect((res as { status: ReturnType<typeof vi.fn> }).status).toHaveBeenCalledWith(400);
    expect(next).not.toHaveBeenCalled();
  });

  it('answers the unpaid challenge with an error response when getAmount fails', async () => {
    const res = response();
    const next = vi.fn();
    const middleware = x402Middleware({
      getAmount: () => Promise.reject(new Error('database unavailable')),
    });
    const req = request();
    // The challenge round: a well-formed key, and no payment header.
    (req as { headers: Record<string, string> }).headers = {
      'x-taskmarket-idempotency-key': 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
    };

    await expect(middleware(req, res, next)).resolves.not.toThrow();

    expect((res as { status: ReturnType<typeof vi.fn> }).status).toHaveBeenCalledWith(500);
    expect(next).not.toHaveBeenCalled();
  });

  it('settles an exact valid payload and then continues', async () => {
    const res = response();
    const next = vi.fn();
    const middleware = x402Middleware({ getAmount: () => '1000', preflight: vi.fn() });

    await middleware(request(), res, next);

    expect(fetch).toHaveBeenCalledOnce();
    expect((res as { locals: Record<string, string> }).locals.payer).toBe(PAYER);
    expect(next).toHaveBeenCalledOnce();
  });

  it('releases preflight state when settlement fails', async () => {
    const cleanup = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        text: async () => 'unavailable',
      })
    );
    const res = response();
    const next = vi.fn();
    const middleware = x402Middleware({
      getAmount: () => '1000',
      preflight: async () => cleanup,
    });

    await middleware(request(), res, next);

    expect(cleanup).toHaveBeenCalledOnce();
    expect((res as { status: ReturnType<typeof vi.fn> }).status).toHaveBeenCalledWith(402);
    expect(next).not.toHaveBeenCalled();
  });

  it('releases preflight state when the downstream response finishes', async () => {
    const cleanup = vi.fn().mockResolvedValue(undefined);
    const res = response();
    const next = vi.fn();
    const middleware = x402Middleware({
      getAmount: () => '1000',
      preflight: async () => cleanup,
    });

    await middleware(request(), res, next);

    const once = (res as { once: ReturnType<typeof vi.fn> }).once;
    expect(once).toHaveBeenCalledWith('finish', expect.any(Function));
    expect(once).not.toHaveBeenCalledWith('close', expect.any(Function));
    const finishCleanup = once.mock.calls.find(([event]) => event === 'finish')?.[1];

    await finishCleanup();

    expect(cleanup).toHaveBeenCalledOnce();
  });

  it('rejects a facilitator response for a different payer', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          transaction: '0xtx',
          payer: '0x0000000000000000000000000000000000000004',
        }),
      })
    );
    const res = response();
    const next = vi.fn();
    const middleware = x402Middleware({ getAmount: () => '1000' });

    await middleware(request(), res, next);

    expect((res as { status: ReturnType<typeof vi.fn> }).status).toHaveBeenCalledWith(402);
    expect(next).not.toHaveBeenCalled();
  });

  // Verifies: ADR-0052, ADR-0068
  describe('idempotency is checked before anything is charged', () => {
    it('claims the key on the paying round, not on the challenge round', async () => {
      const { reserveRelayedWrite } = await import('../../../src/services/relayed-intents');
      const challengeRound = {
        ...(request() as object),
        headers: { 'x-taskmarket-idempotency-key': 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee' },
      } as never;

      const challengeNext = vi.fn();
      await x402Middleware({ getAmount: () => '1000' })(challengeRound, response(), challengeNext);
      // Nothing can be charged on a round with no payment, so there is nothing for a claim to
      // protect -- and claiming here is what refused the paying round that follows.
      expect(reserveRelayedWrite).not.toHaveBeenCalled();

      const payingNext = vi.fn();
      await x402Middleware({ getAmount: () => '1000' })(request(), response(), payingNext);
      expect(reserveRelayedWrite).toHaveBeenCalledOnce();
    });

    it('refuses a repeated key without settling a second payment', async () => {
      idempotencyVerdict.mockReturnValueOnce({
        error: 'A tasks.create write for this idempotency key already exists (intent i-1).',
        status: 409,
      });
      const res = response();
      const next = vi.fn();

      await x402Middleware({ getAmount: () => '1000' })(request(), res, next);

      // The whole point of the ordering. Settlement happens in this middleware, so a check
      // that ran in the handler would already have taken the caller's money: no second chain
      // call, but a second settled payment with nothing to attach to, which is an orphaned
      // payment and a refund. Nothing may be charged before the key is consulted.
      expect(globalThis.fetch).not.toHaveBeenCalled();
      expect((res as { status: ReturnType<typeof vi.fn> }).status).toHaveBeenCalledWith(409);
      expect(next).not.toHaveBeenCalled();
    });

    it('refuses a request with no key before issuing a payment challenge', async () => {
      const res = response();
      const next = vi.fn();

      // No payment header: this is the challenge round, where a caller has paid nothing yet.
      const challengeRound = { ...(request() as object), headers: {} } as never;
      await x402Middleware({ getAmount: () => '1000' })(challengeRound, res, next);

      // Challenging a keyless caller means they pay and then get a 400 from
      // recordRelayedIntent for a payment that bought nothing.
      expect((res as { status: ReturnType<typeof vi.fn> }).status).toHaveBeenCalledWith(400);
      expect((res as { status: ReturnType<typeof vi.fn> }).status).not.toHaveBeenCalledWith(402);
    });
  });

  // Verifies: ADR-0067, ADR-0068
  //
  // What happens when the facilitator -- the one participant whose answer says whether money
  // moved -- fails, times out, or answers something that cannot be true. Every case below turns
  // on the same ordering: the write-ahead authorization record is written *before* the settle
  // call, so once that call has been made the catch block can no longer establish that nothing
  // settled, and must not act as though it had.
  describe('the facilitator fails, times out, or answers impossibly', () => {
    beforeEach(async () => {
      // `clearAllMocks` clears calls but keeps implementations, and these tests install their
      // own; without this the first one's ordering probe leaks into the rest.
      const { recordIntentPaymentAuthorization, releaseUnpaidReservation } = await import(
        '../../../src/services/relayed-intents'
      );
      vi.mocked(recordIntentPaymentAuthorization).mockImplementation(async () => undefined);
      vi.mocked(releaseUnpaidReservation).mockImplementation(async () => undefined);
    });

    /** The `taskmarket` envelope published beside the x402 body on the refusal path. */
    function envelopeOf(res: never): Record<string, unknown> | undefined {
      const json = (res as unknown as { json: ReturnType<typeof vi.fn> }).json;
      const body = json.mock.calls.at(-1)?.[0] as { taskmarket?: Record<string, unknown> };
      return body?.taskmarket;
    }

    function callOrder() {
      const order: string[] = [];
      return { order, mark: (label: string) => order.push(label) };
    }

    /**
     * A settle call that never comes back inside `FACILITATOR_TIMEOUT_MS`.
     *
     * Modelled as the rejection an aborted `fetch` produces, because that is the only thing the
     * middleware ever sees: from in here, a facilitator that settled and then lost the response
     * and one that never did anything are the same event. That indistinguishability is the
     * reason the rest of this behaves the way it does.
     */
    function timeoutAfterSettlement() {
      const abort = new Error('The operation was aborted');
      abort.name = 'AbortError';
      return vi.fn().mockRejectedValue(abort);
    }

    it('keeps the reservation and the key when a timeout hides a successful settlement', async () => {
      const { recordIntentPaymentAuthorization, releaseUnpaidReservation } = await import(
        '../../../src/services/relayed-intents'
      );
      const { order, mark } = callOrder();
      vi.mocked(recordIntentPaymentAuthorization).mockImplementation(async () => {
        mark('record-authorization');
      });
      vi.stubGlobal(
        'fetch',
        vi.fn().mockImplementation(() => {
          mark('settle');
          return timeoutAfterSettlement()();
        })
      );
      const res = response();
      const next = vi.fn();

      await x402Middleware({ getAmount: () => '1000' })(request(), res, next);

      // The ordering is the safety argument, so it is asserted rather than assumed: by the time
      // the settle call is made, the row already names this (payer, nonce). USDC may have moved.
      expect(order).toEqual(['record-authorization', 'settle']);
      expect(recordIntentPaymentAuthorization).toHaveBeenCalledWith(
        expect.objectContaining({ amount: '1000', intentId: 'intent-reserved', payer: PAYER })
      );

      // The release is still attempted, and is deliberately a no-op here: it deletes only rows
      // with no authorization recorded, so a row written before the settle call is beyond its
      // reach. Attempting it and having it decline is the design -- the bound lives in one
      // place, in the query, not in each caller's judgement about whether it is safe to call.
      expect(releaseUnpaidReservation).toHaveBeenCalledWith(
        expect.objectContaining({ intentId: 'intent-reserved' })
      );

      // Nothing was published, so no handler can mistake this for a settled payment...
      expect(next).not.toHaveBeenCalled();
      expect((res as { locals: Record<string, unknown> }).locals.payer).toBeUndefined();
      expect(settledPaymentReference(res)).toBeUndefined();
      // ...and the caller is told the payment was refused, with no `intentStatus`: no intent
      // ever reached a status, and claiming one would be asserting an outcome nobody knows.
      expect((res as { status: ReturnType<typeof vi.fn> }).status).toHaveBeenCalledWith(402);
      expect(envelopeOf(res)).toEqual({ reason: 'payment_rejected' });
    });

    it('leaves a post-settle failure for the sweep rather than deciding it here', async () => {
      // The reservation the middleware just gave up on, as the sweep finds it: `reserved`, past
      // its TTL, naming an authorization. This is the handoff the catch block is making, so it
      // is worth showing that the receiving end resolves it from the token contract rather than
      // from how long it has been sitting there -- elapsed time cannot tell a caller who walked
      // away from one whose payment settled while our connection dropped.
      const { releaseUnpaidReservation } = await import('../../../src/services/relayed-intents');
      vi.stubGlobal('fetch', timeoutAfterSettlement());

      const next = vi.fn();
      await x402Middleware({ getAmount: () => '1000' })(request(), response(), next);

      const [released] = vi.mocked(releaseUnpaidReservation).mock.calls.at(-1) ?? [];
      expect(released).toMatchObject({ intentId: 'intent-reserved' });
      // The row's fate is decided in reservation-sweep.ts, whose own suite covers both answers
      // the token contract can give (test/unit/services/reservation-sweep.test.ts): consumed
      // holds it for review, unused retires it while retaining the (payer, nonce) pair.
    });

    it('holds the key on a non-2xx, because a failed response is not proof nothing settled', async () => {
      const { recordIntentPaymentAuthorization, releaseUnpaidReservation } = await import(
        '../../../src/services/relayed-intents'
      );
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({ ok: false, status: 502, text: async () => 'bad gateway' })
      );
      const res = response();
      const next = vi.fn();

      await x402Middleware({ getAmount: () => '1000' })(request(), res, next);

      // A 502 is the facilitator's proxy talking, not the facilitator: it says our request
      // failed somewhere, not that it failed before the transfer was broadcast. So this lands
      // in exactly the same place as the timeout above -- the authorization is already on the
      // row, the release cannot match it, and the key stays held until the sweep can ask the
      // token contract. Retrying with the same key is refused, and that is the safe direction:
      // the alternative is charging a caller twice for one write.
      expect(recordIntentPaymentAuthorization).toHaveBeenCalledOnce();
      expect(releaseUnpaidReservation).toHaveBeenCalledWith(
        expect.objectContaining({ intentId: 'intent-reserved' })
      );
      expect(next).not.toHaveBeenCalled();
      expect((res as { status: ReturnType<typeof vi.fn> }).status).toHaveBeenCalledWith(402);
      expect(envelopeOf(res)).toEqual({ reason: 'payment_rejected' });
      // The x402 half of the body is preserved beside the envelope, so a client that speaks
      // only x402 still reads a well-formed refusal.
      const body = (res as unknown as { json: ReturnType<typeof vi.fn> }).json.mock.calls.at(
        -1
      )?.[0] as { accepts: unknown[]; error: string; x402Version: number };
      expect(body.x402Version).toBe(2);
      expect(body.accepts).toEqual([]);
      expect(body.error).toContain('502');
    });

    it('refuses when the facilitator reports success: false, naming its reason', async () => {
      const { releaseUnpaidReservation } = await import('../../../src/services/relayed-intents');
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({ success: false, errorReason: 'insufficient_funds' }),
        })
      );
      const res = response();
      const next = vi.fn();

      await x402Middleware({ getAmount: () => '1000' })(request(), res, next);

      expect(next).not.toHaveBeenCalled();
      expect((res as { locals: Record<string, unknown> }).locals.paymentTxHash).toBeUndefined();
      expect((res as { status: ReturnType<typeof vi.fn> }).status).toHaveBeenCalledWith(402);
      expect(envelopeOf(res)).toEqual({ reason: 'payment_rejected' });
      // The facilitator's own reason reaches the caller, who is the only one who can act on
      // "insufficient_funds" -- the generic refusal alone would send them to us instead.
      const body = (res as unknown as { json: ReturnType<typeof vi.fn> }).json.mock.calls.at(
        -1
      )?.[0] as { error: string };
      expect(body.error).toContain('insufficient_funds');

      // This is the one case where a definite "no" was received, and it still does not release
      // the key: the release is bounded by the authorization record, which was written before
      // the call. Deliberate, and the same reasoning as above -- `success: false` is the
      // facilitator's word about its own attempt, not proof that no transfer was broadcast.
      expect(releaseUnpaidReservation).toHaveBeenCalledOnce();
    });

    it('continues on a success with no transaction hash, and says the payment is unrefundable', async () => {
      const { logger } = await import('../../../src/lib/logger');
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true, payer: PAYER }) })
      );
      const res = response();
      const next = vi.fn();

      await x402Middleware({ getAmount: () => '1000' })(request(), res, next);

      // The code calls this pathological and does not treat it as a failure: `success: true` is
      // taken at its word, so the request proceeds and the handler runs. Asserted as it behaves
      // rather than as it ought to, because this is the branch that decides whether the money is
      // recoverable, and the answer is that it is not.
      expect(next).toHaveBeenCalledOnce();
      expect((res as { locals: Record<string, unknown> }).locals.payer).toBe(PAYER);
      expect((res as { locals: Record<string, unknown> }).locals.paymentTxHash).toBeUndefined();

      // `settledPaymentReference` refuses to build a half-reference, which is what keeps a
      // handler from recording a payment settlement cannot refund. The loud log is the only
      // trace of a payer whose USDC is in the server wallet with no hash for `orphaned_payments`
      // to key on, so its presence is part of the contract, not incidental.
      expect(settledPaymentReference(res)).toBeUndefined();
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('cannot be refunded'),
        expect.objectContaining({ hasPayer: true, hasTxHash: false })
      );
    });

    it('refuses a settlement attributed to a different payer, and keeps the key', async () => {
      const { releaseUnpaidReservation } = await import('../../../src/services/relayed-intents');
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({
            success: true,
            transaction: '0xtx',
            payer: '0x0000000000000000000000000000000000000004',
          }),
        })
      );
      const res = response();
      const next = vi.fn();

      await x402Middleware({ getAmount: () => '1000' })(request(), res, next);

      // A settlement naming someone other than the authorization's `from` is either the wrong
      // payment or a confused facilitator, and neither may be attached to this write. Nothing
      // is published, so no handler can act on it...
      expect(next).not.toHaveBeenCalled();
      expect((res as { locals: Record<string, unknown> }).locals.payer).toBeUndefined();
      expect(settledPaymentReference(res)).toBeUndefined();
      expect((res as { status: ReturnType<typeof vi.fn> }).status).toHaveBeenCalledWith(402);
      expect(envelopeOf(res)).toEqual({ reason: 'payment_rejected' });
      // ...and the key stays held, because a transaction really may have moved money here --
      // this is the mismatch case, not the nothing-happened case.
      expect(releaseUnpaidReservation).toHaveBeenCalledOnce();
    });

    it('gives the key back only when nothing was ever asked of the facilitator', async () => {
      const { recordIntentPaymentAuthorization, releaseUnpaidReservation } = await import(
        '../../../src/services/relayed-intents'
      );
      vi.mocked(recordIntentPaymentAuthorization).mockRejectedValueOnce(
        new Error('write-ahead record failed')
      );
      const res = response();
      const next = vi.fn();

      await x402Middleware({ getAmount: () => '1000' })(request(), res, next);

      // The narrow window the release exists for, and the only one where it does anything: the
      // authorization was never written down, so the settle call below it was never reached and
      // the row genuinely has no payment behind it. Here the caller may retry with the same key
      // immediately rather than waiting out a ten-minute TTL for a request that charged nothing.
      expect(globalThis.fetch).not.toHaveBeenCalled();
      expect(releaseUnpaidReservation).toHaveBeenCalledWith(
        expect.objectContaining({ intentId: 'intent-reserved' })
      );
      expect(next).not.toHaveBeenCalled();
      expect((res as { status: ReturnType<typeof vi.fn> }).status).toHaveBeenCalledWith(402);
    });
  });
});

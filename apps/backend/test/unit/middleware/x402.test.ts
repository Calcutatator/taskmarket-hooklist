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
  logger: { error: vi.fn() },
}));

vi.mock('../../../src/db/client', () => ({ db: {} }));

// The idempotency precondition is a database read, so the double is the verdict, not the
// query. What matters for these tests is *when* it is consulted, which the ordering
// assertions below check directly.
const idempotencyVerdict = vi.fn<[], { error: string; status: number } | null>(() => null);
vi.mock('../../../src/services/relayed-intents', () => ({
  checkRelayedWriteIdempotency: vi.fn(async () => idempotencyVerdict()),
}));

import { X402PreflightError, x402Middleware } from '../../../src/middleware/x402';

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
    (req as { headers: Record<string, string> }).headers = {};

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

  // Verifies: ADR-0052
  describe('idempotency is checked before anything is charged', () => {
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
      idempotencyVerdict.mockReturnValueOnce({ error: 'missing key', status: 400 });
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
});

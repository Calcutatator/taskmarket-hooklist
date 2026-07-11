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
    headers: { 'payment-signature': header },
    protocol: 'https',
    get: () => 'api.example',
    originalUrl: '/api/tasks/0xtask/cancel',
    path: '/tasks/0xtask/cancel',
  } as never;
}

function response() {
  const res: Record<string, unknown> = {
    locals: {},
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

  it('settles an exact valid payload and then continues', async () => {
    const res = response();
    const next = vi.fn();
    const middleware = x402Middleware({ getAmount: () => '1000', preflight: vi.fn() });

    await middleware(request(), res, next);

    expect(fetch).toHaveBeenCalledOnce();
    expect((res as { locals: Record<string, string> }).locals.payer).toBe(PAYER);
    expect(next).toHaveBeenCalledOnce();
  });
});

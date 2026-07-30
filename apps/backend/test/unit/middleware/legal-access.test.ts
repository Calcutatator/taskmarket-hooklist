import { beforeEach, describe, expect, it, vi } from 'vitest';

// Verifies: ADR-0009 (legal acceptance opaque receipt, default-deny middleware)
const { verifyLegalReceipt, verifyPrivyAccessToken } = vi.hoisted(() => ({
  verifyLegalReceipt: vi.fn(),
  verifyPrivyAccessToken: vi.fn(),
}));

vi.mock('../../../src/services/legal', () => ({
  LEGAL_ACCEPTANCE_REQUIRED_CODE: 'LEGAL_ACCEPTANCE_REQUIRED',
  getCurrentLegalBundle: () => ({ version: '2026-07-1' }),
  verifyLegalReceipt,
}));

vi.mock('../../../src/config/env', () => ({
  getServerConfig: () => ({
    LEGAL_ENFORCEMENT_ENABLED: true,
    WEB_APP_URL: 'https://taskmarket.example',
  }),
}));

vi.mock('../../../src/lib/privy-auth', () => ({ verifyPrivyAccessToken }));

import { createLegalAccessMiddleware } from '../../../src/middleware/legal-access';

const legalAccessMiddleware = createLegalAccessMiddleware({ db: {} as never });

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

describe('legal access middleware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    verifyPrivyAccessToken.mockResolvedValue({ user_id: 'did:privy:user-1' });
  });

  it('allows public reads without an acceptance receipt', async () => {
    const next = vi.fn();
    await legalAccessMiddleware(
      { method: 'GET', path: '/tasks', originalUrl: '/api/tasks', headers: {} } as never,
      response(),
      next
    );

    expect(next).toHaveBeenCalledOnce();
    expect(verifyLegalReceipt).not.toHaveBeenCalled();
  });

  it.each([
    '/api/tasks/0xtask/cancel',
    '/api/tasks/0xtask/refund-expired',
    '/api/tasks/0xtask/appeal',
    '/api/tasks/0xtask/accept',
    '/api/tasks/0xtask/accept-submissions',
    '/api/tasks/0xtask/resolve-dispute',
    '/api/wallet/withdraw',
    '/api/wallet/withdraw-dreams',
    '/api/emails/delete',
    '/api/devices/device-1/key',
    '/api/task-drops/subscribe',
    '/api/task-drops/official/subscribe',
  ])('allows the exit or recovery route %s without a receipt', async (originalUrl) => {
    const next = vi.fn();
    await legalAccessMiddleware(
      { method: 'POST', path: originalUrl.replace('/api', ''), originalUrl, headers: {} } as never,
      response(),
      next
    );

    expect(next).toHaveBeenCalledOnce();
    expect(verifyLegalReceipt).not.toHaveBeenCalled();
  });

  it('allows public Task Drop subscription procedures without a receipt', async () => {
    const next = vi.fn();
    await legalAccessMiddleware(
      {
        method: 'POST',
        path: '/taskDrops.subscribe%2CtaskDrops.subscribeOfficial',
        originalUrl: '/trpc/taskDrops.subscribe%2CtaskDrops.subscribeOfficial?batch=1',
        headers: {},
      } as never,
      response(),
      next
    );

    expect(next).toHaveBeenCalledOnce();
    expect(verifyLegalReceipt).not.toHaveBeenCalled();
  });

  it('allows a batch containing only tRPC exit or recovery procedures', async () => {
    const next = vi.fn();
    await legalAccessMiddleware(
      {
        method: 'POST',
        path: '/tasks.cancel%2Cevaluations.appeal',
        originalUrl: '/trpc/tasks.cancel%2Cevaluations.appeal?batch=1',
        headers: {},
      } as never,
      response(),
      next
    );

    expect(next).toHaveBeenCalledOnce();
    expect(verifyLegalReceipt).not.toHaveBeenCalled();
  });

  it('allows terminal acceptance procedures needed to settle funded work', async () => {
    const next = vi.fn();
    await legalAccessMiddleware(
      {
        method: 'POST',
        path: '/acceptance.accept%2Cacceptance.acceptSubmissions',
        originalUrl: '/trpc/acceptance.accept%2Cacceptance.acceptSubmissions?batch=1',
        headers: {},
      } as never,
      response(),
      next
    );

    expect(next).toHaveBeenCalledOnce();
    expect(verifyLegalReceipt).not.toHaveBeenCalled();
  });

  it('gates a tRPC batch if any procedure begins new activity', async () => {
    const res = response();
    const next = vi.fn();
    await legalAccessMiddleware(
      {
        method: 'POST',
        path: '/tasks.cancel%2Ctasks.create',
        originalUrl: '/trpc/tasks.cancel%2Ctasks.create?batch=1',
        headers: {},
      } as never,
      res,
      next
    );

    expect((res as { status: ReturnType<typeof vi.fn> }).status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects a new paid action before the request reaches x402 settlement', async () => {
    const res = response();
    const next = vi.fn();
    await legalAccessMiddleware(
      { method: 'POST', path: '/tasks', originalUrl: '/api/tasks', headers: {} } as never,
      res,
      next
    );

    expect((res as { status: ReturnType<typeof vi.fn> }).status).toHaveBeenCalledWith(403);
    expect((res as { json: ReturnType<typeof vi.fn> }).json).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'LEGAL_ACCEPTANCE_REQUIRED' })
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('continues only when the submitted receipt is current and valid', async () => {
    verifyLegalReceipt.mockResolvedValueOnce({
      acceptanceId: 'acceptance-1',
      subjectId: 'did:privy:user-1',
      subjectType: 'privy_user',
    });
    const res = response();
    const next = vi.fn();

    await legalAccessMiddleware(
      {
        method: 'POST',
        path: '/tasks',
        originalUrl: '/api/tasks',
        headers: {
          authorization: 'Bearer privy-token',
          'x-taskmarket-legal-receipt': 'receipt-1',
        },
      } as never,
      res,
      next
    );

    expect(verifyLegalReceipt).toHaveBeenCalledWith('receipt-1');
    expect((res as { locals: Record<string, unknown> }).locals.legalAcceptance).toEqual(
      expect.objectContaining({ acceptanceId: 'acceptance-1' })
    );
    expect(next).toHaveBeenCalledOnce();
  });

  it('rejects a Privy receipt presented by a different authenticated user', async () => {
    verifyLegalReceipt.mockResolvedValueOnce({
      acceptanceId: 'acceptance-1',
      subjectId: 'did:privy:user-1',
      subjectType: 'privy_user',
    });
    verifyPrivyAccessToken.mockResolvedValueOnce({ user_id: 'did:privy:user-2' });
    const res = response();
    const next = vi.fn();

    await legalAccessMiddleware(
      {
        method: 'POST',
        path: '/tasks',
        originalUrl: '/api/tasks',
        headers: {
          authorization: 'Bearer other-user-token',
          'x-taskmarket-legal-receipt': 'receipt-1',
        },
      } as never,
      res,
      next
    );

    expect((res as { status: ReturnType<typeof vi.fn> }).status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects a wallet receipt when the X402 payer is a different wallet', async () => {
    verifyLegalReceipt.mockResolvedValueOnce({
      acceptanceId: 'acceptance-1',
      subjectId: '0x1111111111111111111111111111111111111111',
      subjectType: 'wallet',
    });
    const paymentSignature = Buffer.from(
      JSON.stringify({
        payload: { authorization: { from: '0x2222222222222222222222222222222222222222' } },
      })
    ).toString('base64');
    const res = response();
    const next = vi.fn();

    await legalAccessMiddleware(
      {
        body: {},
        method: 'POST',
        path: '/tasks',
        originalUrl: '/api/tasks',
        headers: {
          'payment-signature': paymentSignature,
          'x-taskmarket-legal-receipt': 'receipt-1',
        },
      } as never,
      res,
      next
    );

    expect((res as { status: ReturnType<typeof vi.fn> }).status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects a wallet receipt when no acting wallet can be identified on a non-x402 protected write', async () => {
    verifyLegalReceipt.mockResolvedValueOnce({
      acceptanceId: 'acceptance-1',
      subjectId: '0x1111111111111111111111111111111111111111',
      subjectType: 'wallet',
    });
    const res = response();
    const next = vi.fn();

    await legalAccessMiddleware(
      {
        body: {},
        method: 'POST',
        path: '/tasks/task-1/cancel-something-else',
        originalUrl: '/api/tasks/task-1/cancel-something-else',
        headers: { 'x-taskmarket-legal-receipt': 'receipt-1' },
      } as never,
      res,
      next
    );

    expect((res as { status: ReturnType<typeof vi.fn> }).status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('allows a wallet receipt to reach an unpaid X402 probe before payer evidence exists', async () => {
    verifyLegalReceipt.mockResolvedValueOnce({
      acceptanceId: 'acceptance-1',
      subjectId: '0x1111111111111111111111111111111111111111',
      subjectType: 'wallet',
    });
    const next = vi.fn();

    await legalAccessMiddleware(
      {
        body: { workerAddress: '0x2222222222222222222222222222222222222222' },
        method: 'POST',
        path: '/tasks/task-1/pitches/select',
        originalUrl: '/api/tasks/task-1/pitches/select',
        headers: { 'x-taskmarket-legal-receipt': 'receipt-1' },
      } as never,
      response(),
      next
    );

    expect(next).toHaveBeenCalledOnce();
  });

  it('fails closed when receipt verification is unavailable', async () => {
    verifyLegalReceipt.mockRejectedValueOnce(new Error('database unavailable'));
    const res = response();
    const next = vi.fn();

    await legalAccessMiddleware(
      {
        method: 'POST',
        path: '/tasks',
        originalUrl: '/api/tasks',
        headers: { 'x-taskmarket-legal-receipt': 'receipt-1' },
      } as never,
      res,
      next
    );

    expect((res as { status: ReturnType<typeof vi.fn> }).status).toHaveBeenCalledWith(503);
    expect((res as { json: ReturnType<typeof vi.fn> }).json).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'LEGAL_STATUS_UNAVAILABLE' })
    );
    expect(next).not.toHaveBeenCalled();
  });
});

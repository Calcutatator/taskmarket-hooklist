import { beforeEach, describe, expect, it, vi } from 'vitest';

const { verifyLegalReceipt } = vi.hoisted(() => ({ verifyLegalReceipt: vi.fn() }));

vi.mock('../../../src/services/legal', () => ({
  LEGAL_ACCEPTANCE_REQUIRED_CODE: 'LEGAL_ACCEPTANCE_REQUIRED',
  LEGAL_RECEIPT_HEADER: 'x-taskmarket-legal-receipt',
  getCurrentLegalBundle: () => ({ version: '2026-07-1' }),
  verifyLegalReceipt,
}));

vi.mock('../../../src/config/env', () => ({
  getServerConfig: () => ({
    LEGAL_ENFORCEMENT_ENABLED: true,
    WEB_APP_URL: 'https://taskmarket.example',
  }),
}));

import { legalAccessMiddleware } from '../../../src/middleware/legal-access';

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
    '/api/tasks/0xtask/resolve-dispute',
    '/api/wallet/withdraw',
    '/api/wallet/withdraw-dreams',
    '/api/emails/delete',
    '/api/devices/device-1/key',
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
        headers: { 'x-taskmarket-legal-receipt': 'receipt-1' },
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

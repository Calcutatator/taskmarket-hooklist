import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  getLegalAcceptanceForSubject,
  reissueLegalReceipt,
  verifyLegalReceipt,
  verifyPrivyAccessToken,
} = vi.hoisted(() => ({
  getLegalAcceptanceForSubject: vi.fn(),
  reissueLegalReceipt: vi.fn(),
  verifyLegalReceipt: vi.fn(),
  verifyPrivyAccessToken: vi.fn(),
}));

const bundle = {
  acceptanceAvailable: true,
  acceptanceStatement: 'I accept the current policies.',
  bundleDigest: `sha256:${'a'.repeat(64)}`,
  documents: [
    {
      contentHash: 'a'.repeat(64),
      slug: 'terms' as const,
      summary: 'Terms summary',
      title: 'Terms of Service',
      type: 'terms_of_service' as const,
      url: 'https://taskmarket.example/legal/terms',
      version: '2026-07-1',
    },
  ],
  effectiveAt: '2026-07-15T00:00:00.000Z',
  enforcementEnabled: true,
  publishedAt: '2026-07-15T00:00:00.000Z',
  status: 'approved' as const,
  version: '2026-07-1',
};

vi.mock('../../../src/lib/privy-auth', () => ({ verifyPrivyAccessToken }));

vi.mock('../../../src/services/legal', () => ({
  LEGAL_RECEIPT_HEADER: 'x-taskmarket-legal-receipt',
  acceptWalletLegalTerms: vi.fn(),
  assertLegalAcceptanceAvailable: vi.fn(),
  createWalletLegalChallenge: vi.fn(),
  getCurrentLegalBundle: () => bundle,
  getLegalAcceptanceForSubject,
  recordLegalAcceptance: vi.fn(),
  reissueLegalReceipt,
  verifyLegalReceipt,
}));

import { legalRouter } from '../../../src/routers/legal.router';
import { createMockCtx } from '../helpers';

function context(headers: Record<string, string>) {
  const ctx = createMockCtx();
  ctx.req = { headers } as never;
  return ctx;
}

describe('legal router status', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    bundle.enforcementEnabled = true;
    getLegalAcceptanceForSubject.mockResolvedValue(null);
    verifyPrivyAccessToken.mockResolvedValue({
      session_id: 'session-1',
      user_id: 'did:privy:user-1',
    });
  });

  it('accepts a receipt that belongs to the authenticated Privy user', async () => {
    verifyLegalReceipt.mockResolvedValue({
      acceptanceId: 'acceptance-1',
      subjectId: 'did:privy:user-1',
      subjectType: 'privy_user',
    });

    const ctx = context({
      authorization: 'Bearer privy-token',
      'x-taskmarket-legal-receipt': 'receipt-1',
    });
    const result = await legalRouter.createCaller(ctx).status({});

    expect(result.accepted).toBe(true);
    expect(verifyPrivyAccessToken).toHaveBeenCalledWith('Bearer privy-token');
    expect(getLegalAcceptanceForSubject).not.toHaveBeenCalled();
    expect(ctx.res.setHeader).toHaveBeenCalledWith('Cache-Control', 'private, no-store');
    expect(ctx.res.vary).toHaveBeenCalledWith('Authorization');
    expect(ctx.res.vary).toHaveBeenCalledWith('X-Taskmarket-Legal-Receipt');
  });

  it('does not treat another subject\'s receipt as the authenticated user\'s acceptance', async () => {
    verifyLegalReceipt.mockResolvedValue({
      acceptanceId: 'acceptance-2',
      subjectId: 'did:privy:user-2',
      subjectType: 'privy_user',
    });

    const result = await legalRouter.createCaller(
      context({
        authorization: 'Bearer privy-token',
        'x-taskmarket-legal-receipt': 'receipt-2',
      })
    ).status({});

    expect(result.accepted).toBe(false);
    expect(getLegalAcceptanceForSubject).toHaveBeenCalledWith(
      expect.anything(),
      'privy_user',
      'did:privy:user-1'
    );
  });

  it('continues to support wallet receipts when no Privy bearer is present', async () => {
    verifyLegalReceipt.mockResolvedValue({
      acceptanceId: 'acceptance-3',
      subjectId: '0x1111111111111111111111111111111111111111',
      subjectType: 'wallet',
    });

    const result = await legalRouter.createCaller(
      context({ 'x-taskmarket-legal-receipt': 'wallet-receipt' })
    ).status({});

    expect(result).toMatchObject({ accepted: true, subjectType: 'wallet' });
    expect(verifyPrivyAccessToken).not.toHaveBeenCalled();
  });

  it('does not honor a Privy receipt without its matching bearer token', async () => {
    verifyLegalReceipt.mockResolvedValue({
      acceptanceId: 'acceptance-3',
      subjectId: 'did:privy:user-1',
      subjectType: 'privy_user',
    });

    const result = await legalRouter.createCaller(
      context({ 'x-taskmarket-legal-receipt': 'privy-receipt' })
    ).status({});

    expect(result).toMatchObject({ accepted: false });
    expect(result).not.toHaveProperty('subjectType');
  });

  it('reissues a receipt for a returning authenticated user', async () => {
    const acceptance = { id: 'acceptance-1' };
    getLegalAcceptanceForSubject.mockResolvedValue(acceptance);
    reissueLegalReceipt.mockResolvedValue('reissued-receipt');

    const result = await legalRouter.createCaller(
      context({ authorization: 'Bearer privy-token' })
    ).status({});

    expect(result).toMatchObject({
      accepted: true,
      receipt: 'reissued-receipt',
      subjectType: 'privy_user',
    });
    expect(reissueLegalReceipt).toHaveBeenCalledWith(expect.anything(), acceptance);
  });

  it('does not block authenticated users when enforcement is disabled and Privy is unavailable', async () => {
    bundle.enforcementEnabled = false;
    verifyPrivyAccessToken.mockRejectedValue(new Error('Privy is not configured'));

    const result = await legalRouter.createCaller(
      context({ authorization: 'Bearer privy-token' })
    ).status({});

    expect(result).toMatchObject({ accepted: false, bundle: { enforcementEnabled: false } });
  });
});

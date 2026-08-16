// Verifies: ADR-0089
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { verifyPrivyAccessToken } = vi.hoisted(() => ({
  verifyPrivyAccessToken: vi.fn(),
}));

vi.mock('../../../src/lib/privy-auth', () => ({ verifyPrivyAccessToken }));

import { requireSlapChopVoter } from '../../../src/lib/slap-chop-voter-auth';

describe('Slap-Chop voter authorization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    verifyPrivyAccessToken.mockResolvedValue({ user_id: 'did:privy:voter-1' });
  });

  it('uses the exact server-verified Privy user ID as the vote identity', async () => {
    await expect(requireSlapChopVoter('Bearer voter-token')).resolves.toBe('did:privy:voter-1');
    expect(verifyPrivyAccessToken).toHaveBeenCalledWith('Bearer voter-token');
  });

  it('fails closed for absent, invalid, or malformed Privy identities', async () => {
    verifyPrivyAccessToken.mockRejectedValueOnce(new Error('missing token'));
    await expect(requireSlapChopVoter(undefined)).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
      message: 'A valid Privy access token is required to vote',
    });

    verifyPrivyAccessToken.mockResolvedValueOnce({ user_id: '' });
    await expect(requireSlapChopVoter('Bearer malformed-token')).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });

    verifyPrivyAccessToken.mockResolvedValueOnce({ user_id: '   ' });
    await expect(requireSlapChopVoter('Bearer blank-token')).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
  });
});

// Verifies: ADR-0088
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getServerConfig, verifyPrivyAccessToken } = vi.hoisted(() => ({
  getServerConfig: vi.fn(),
  verifyPrivyAccessToken: vi.fn(),
}));

vi.mock('../../../src/config/env', () => ({ getServerConfig }));
vi.mock('../../../src/lib/privy-auth', () => ({ verifyPrivyAccessToken }));

import { requireSlapChopCurator } from '../../../src/lib/slap-chop-curator-auth';

describe('Slap-Chop curator authorization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getServerConfig.mockReturnValue({
      SLAP_CHOP_CURATOR_PRIVY_USER_IDS: ['did:privy:curator-1'],
    });
    verifyPrivyAccessToken.mockResolvedValue({ user_id: 'did:privy:curator-1' });
  });

  it('accepts only a server-verified allowlisted Privy user', async () => {
    await expect(requireSlapChopCurator('Bearer curator-token')).resolves.toBe(
      'did:privy:curator-1'
    );
    expect(verifyPrivyAccessToken).toHaveBeenCalledWith('Bearer curator-token');
  });

  it('fails closed when the allowlist is empty', async () => {
    getServerConfig.mockReturnValue({ SLAP_CHOP_CURATOR_PRIVY_USER_IDS: [] });

    await expect(requireSlapChopCurator('Bearer curator-token')).rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: 'Curator access is not authorized',
    });
  });

  it('rejects a verified user who is not in the exact allowlist', async () => {
    verifyPrivyAccessToken.mockResolvedValue({ user_id: 'did:privy:other-user' });

    await expect(requireSlapChopCurator('Bearer other-token')).rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: 'Curator access is not authorized',
    });
  });

  it('does not trust an unverified bearer token', async () => {
    verifyPrivyAccessToken.mockRejectedValue(new Error('signature invalid'));

    await expect(requireSlapChopCurator('Bearer invalid-token')).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
      message: 'A valid Privy access token is required for curator access',
    });
  });
});

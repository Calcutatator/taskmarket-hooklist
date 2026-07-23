import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/lib/keystore.js', () => ({
  loadKeystore: vi
    .fn()
    .mockResolvedValue({ walletAddress: '0xWorker00000000000000000000000000000001' }),
}));

const mockSignMessage = vi.hoisted(() => vi.fn().mockResolvedValue('0xsignature'));
vi.mock('../../src/lib/signer.js', () => ({
  createWalletAccountFromKeystore: vi.fn().mockResolvedValue({ signMessage: mockSignMessage }),
}));

import { signReadAuth } from '../../src/lib/read-auth.js';
import { loadKeystore } from '../../src/lib/keystore.js';
import { createWalletAccountFromKeystore } from '../../src/lib/signer.js';

const ADDRESS = '0xWorker00000000000000000000000000000001';

describe('signReadAuth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(loadKeystore).mockResolvedValue({ walletAddress: ADDRESS } as Awaited<
      ReturnType<typeof loadKeystore>
    >);
    mockSignMessage.mockResolvedValue('0xsignature');
    vi.mocked(createWalletAccountFromKeystore).mockResolvedValue({
      signMessage: mockSignMessage,
    } as unknown as Awaited<ReturnType<typeof createWalletAccountFromKeystore>>);
  });

  it('signs the canonical read-auth message and returns headers plus the wallet address', async () => {
    const auth = await signReadAuth();

    expect(mockSignMessage).toHaveBeenCalledWith({
      message: `taskmarket:read:${ADDRESS.toLowerCase()}`,
    });
    expect(auth).toEqual({
      walletAddress: ADDRESS,
      headers: {
        'X-Taskmarket-Caller-Address': ADDRESS,
        'X-Taskmarket-Caller-Signature': '0xsignature',
      },
    });
  });

  it('returns the wallet address with empty headers when signing fails', async () => {
    mockSignMessage.mockRejectedValue(new Error('signing failed'));

    const auth = await signReadAuth();

    expect(auth).toEqual({ walletAddress: ADDRESS, headers: {} });
  });

  it('returns null when there is no keystore at all', async () => {
    vi.mocked(loadKeystore).mockRejectedValueOnce(new Error('no keystore'));

    const auth = await signReadAuth();

    expect(auth).toBeNull();
    expect(mockSignMessage).not.toHaveBeenCalled();
  });
});

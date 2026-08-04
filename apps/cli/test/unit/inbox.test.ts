import { beforeEach, describe, expect, it, vi } from 'vitest';

// vi.mock factories are hoisted above top-level const declarations, so the
// address is a literal here (not the ADDRESS const below) to avoid a TDZ
// ReferenceError.
vi.mock('../../src/lib/keystore.js', () => ({
  loadKeystore: vi
    .fn()
    .mockResolvedValue({ walletAddress: '0xRequester0000000000000000000000000000001' }),
}));

const mockSignMessage = vi.hoisted(() => vi.fn().mockResolvedValue('0xsignature'));
vi.mock('../../src/lib/signer.js', () => ({
  createWalletAccountFromKeystore: vi.fn().mockResolvedValue({ signMessage: mockSignMessage }),
}));

vi.mock('../../src/lib/api.js', () => ({
  apiGet: vi.fn().mockResolvedValue({ asRequester: [], asWorker: [] }),
}));

vi.mock('../../src/lib/output.js', () => ({
  printResult: vi.fn(),
  printError: vi.fn(() => {
    throw new Error('printError called');
  }),
  renderFailure: vi.fn((error: unknown) => {
    throw error instanceof Error ? error : new Error(String(error));
  }),
}));

import { inboxCommand } from '../../src/commands/inbox.js';
import { apiGet } from '../../src/lib/api.js';
import { createWalletAccountFromKeystore } from '../../src/lib/signer.js';
import { loadKeystore } from '../../src/lib/keystore.js';
import { printResult } from '../../src/lib/output.js';

const ADDRESS = '0xRequester0000000000000000000000000000001';

describe('inbox command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSignMessage.mockResolvedValue('0xsignature');
    vi.mocked(createWalletAccountFromKeystore).mockResolvedValue({
      signMessage: mockSignMessage,
    } as unknown as Awaited<ReturnType<typeof createWalletAccountFromKeystore>>);
  });

  it('signs one read-auth message and sends it as headers to both endpoints', async () => {
    vi.mocked(apiGet).mockImplementation(async (path: string) =>
      path.startsWith('/api/bids/my')
        ? [{ taskId: '0xtask', auctionType: 'english', myBidPrice: '1000000' }]
        : { asRequester: [], asWorker: [] }
    );

    await inboxCommand.parseAsync(['node', 'inbox'], { from: 'node' });

    expect(mockSignMessage).toHaveBeenCalledTimes(1);
    expect(mockSignMessage).toHaveBeenCalledWith({
      message: `taskmarket:read:${ADDRESS.toLowerCase()}`,
    });

    const expectedHeaders = {
      'X-Taskmarket-Caller-Address': ADDRESS,
      'X-Taskmarket-Caller-Signature': '0xsignature',
    };

    const [inboxUrl, inboxOptions] = vi.mocked(apiGet).mock.calls[0];
    expect(inboxUrl).toContain(`address=${encodeURIComponent(ADDRESS)}`);
    expect(inboxOptions?.headers).toEqual(expectedHeaders);

    const [bidsUrl, bidsOptions] = vi.mocked(apiGet).mock.calls[1];
    expect(bidsUrl).toBe('/api/bids/my');
    expect(bidsOptions?.headers).toEqual(expectedHeaders);

    expect(printResult).toHaveBeenCalledWith(
      expect.objectContaining({
        pendingBids: [{ taskId: '0xtask', auctionType: 'english', myBidPrice: '1000000' }],
      })
    );
  });

  it('falls back to an unsigned inbox request and skips my-bids when signing fails', async () => {
    mockSignMessage.mockRejectedValue(new Error('signing failed'));
    vi.mocked(apiGet).mockResolvedValue({ asRequester: [], asWorker: [] });

    await inboxCommand.parseAsync(['node', 'inbox'], { from: 'node' });

    expect(apiGet).toHaveBeenCalledTimes(1);
    const [inboxUrl, inboxOptions] = vi.mocked(apiGet).mock.calls[0];
    expect(inboxUrl).toContain(`address=${encodeURIComponent(ADDRESS)}`);
    expect(inboxOptions?.headers).toEqual({});
    expect(printResult).toHaveBeenCalledWith(expect.objectContaining({ pendingBids: [] }));
  });

  it('falls back to an unsigned inbox request when account derivation fails', async () => {
    vi.mocked(createWalletAccountFromKeystore).mockRejectedValueOnce(new Error('key fetch failed'));
    vi.mocked(apiGet).mockResolvedValue({ asRequester: [], asWorker: [] });

    await inboxCommand.parseAsync(['node', 'inbox'], { from: 'node' });

    expect(mockSignMessage).not.toHaveBeenCalled();
    expect(apiGet).toHaveBeenCalledTimes(1);
    const [inboxUrl, inboxOptions] = vi.mocked(apiGet).mock.calls[0];
    expect(inboxUrl).toContain(`address=${encodeURIComponent(ADDRESS)}`);
    expect(inboxOptions?.headers).toEqual({});
    expect(printResult).toHaveBeenCalledWith(expect.objectContaining({ pendingBids: [] }));
  });

  it('errors when there is no keystore at all', async () => {
    vi.mocked(loadKeystore).mockRejectedValueOnce(new Error('no keystore'));

    await expect(inboxCommand.parseAsync(['node', 'inbox'], { from: 'node' })).rejects.toThrow(
      'printError called'
    );
    expect(apiGet).not.toHaveBeenCalled();
  });
});

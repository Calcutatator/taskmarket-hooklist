import { beforeEach, describe, expect, it, vi } from 'vitest';

// vi.mock factories are hoisted above top-level const declarations, so the
// address is a literal here (not the ADDRESS const below) to avoid a TDZ
// ReferenceError.
vi.mock('../../src/lib/keystore.js', () => ({
  loadKeystore: vi
    .fn()
    .mockResolvedValue({ walletAddress: '0xWorker00000000000000000000000000000001' }),
}));

const mockSignMessage = vi.hoisted(() => vi.fn().mockResolvedValue('0xsignature'));
vi.mock('../../src/lib/signer.js', () => ({
  createWalletAccountFromKeystore: vi.fn().mockResolvedValue({ signMessage: mockSignMessage }),
}));

vi.mock('../../src/lib/api.js', () => ({
  apiGet: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../src/lib/output.js', () => ({
  printResult: vi.fn(),
  printError: vi.fn(() => {
    throw new Error('printError called');
  }),
}));

import { mySubmissionsCmd } from '../../src/commands/task/my-submissions.js';
import { apiGet } from '../../src/lib/api.js';
import { createWalletAccountFromKeystore } from '../../src/lib/signer.js';
import { loadKeystore } from '../../src/lib/keystore.js';
import { printResult } from '../../src/lib/output.js';

const ADDRESS = '0xWorker00000000000000000000000000000001';

describe('task my-submissions command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSignMessage.mockResolvedValue('0xsignature');
    vi.mocked(createWalletAccountFromKeystore).mockResolvedValue({
      signMessage: mockSignMessage,
    } as unknown as Awaited<ReturnType<typeof createWalletAccountFromKeystore>>);
    // Commander retains parsed option values on the shared command instance
    // across parseAsync calls -- reset --address so each test starts clean.
    mySubmissionsCmd.setOptionValueWithSource('address', undefined, 'default');
  });

  it('signs the canonical read-auth message and sends it as request headers', async () => {
    vi.mocked(apiGet).mockResolvedValue([]);

    await mySubmissionsCmd.parseAsync(['node', 'my-submissions'], { from: 'node' });

    expect(mockSignMessage).toHaveBeenCalledWith({
      message: `taskmarket:read:${ADDRESS.toLowerCase()}`,
    });
    const [path, options] = vi.mocked(apiGet).mock.calls[0];
    expect(path).toBe(`/api/submissions/mine?workerAddress=${encodeURIComponent(ADDRESS)}`);
    expect(options?.headers).toEqual({
      'X-Taskmarket-Caller-Address': ADDRESS,
      'X-Taskmarket-Caller-Signature': '0xsignature',
    });
  });

  it('uses --address to query another wallet while still signing as the local keystore', async () => {
    const otherAddress = '0xOther000000000000000000000000000000002';
    vi.mocked(apiGet).mockResolvedValue([]);

    await mySubmissionsCmd.parseAsync(['node', 'my-submissions', '--address', otherAddress], {
      from: 'node',
    });

    const [path, options] = vi.mocked(apiGet).mock.calls[0];
    expect(path).toBe(`/api/submissions/mine?workerAddress=${encodeURIComponent(otherAddress)}`);
    expect(options?.headers).toEqual({
      'X-Taskmarket-Caller-Address': ADDRESS,
      'X-Taskmarket-Caller-Signature': '0xsignature',
    });
  });

  it('falls back to an unauthenticated request when signing fails, without erroring', async () => {
    mockSignMessage.mockRejectedValue(new Error('signing failed'));
    vi.mocked(apiGet).mockResolvedValue([]);

    await mySubmissionsCmd.parseAsync(['node', 'my-submissions'], { from: 'node' });

    const [path, options] = vi.mocked(apiGet).mock.calls[0];
    expect(path).toBe(`/api/submissions/mine?workerAddress=${encodeURIComponent(ADDRESS)}`);
    expect(options?.headers).toEqual({});
    expect(printResult).toHaveBeenCalled();
  });

  it('errors when there is no keystore and no --address given', async () => {
    vi.mocked(loadKeystore).mockRejectedValueOnce(new Error('no keystore'));

    await expect(
      mySubmissionsCmd.parseAsync(['node', 'my-submissions'], { from: 'node' })
    ).rejects.toThrow('printError called');
    expect(apiGet).not.toHaveBeenCalled();
  });
});

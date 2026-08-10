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
  apiGet: vi.fn().mockResolvedValue([]),
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

import { submissionsCmd } from '../../src/commands/task/submissions.js';
import { apiGet } from '../../src/lib/api.js';
import { createWalletAccountFromKeystore } from '../../src/lib/signer.js';
import { printResult } from '../../src/lib/output.js';

const ADDRESS = '0xRequester0000000000000000000000000000001';
const TASK_ID = '0xtask0000000000000000000000000000000001';

describe('task submissions command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSignMessage.mockResolvedValue('0xsignature');
    vi.mocked(createWalletAccountFromKeystore).mockResolvedValue({
      signMessage: mockSignMessage,
    } as unknown as Awaited<ReturnType<typeof createWalletAccountFromKeystore>>);
  });

  it('signs the canonical read-auth message and sends it as request headers', async () => {
    vi.mocked(apiGet).mockResolvedValue([]);

    await submissionsCmd.parseAsync(['node', 'submissions', TASK_ID], { from: 'node' });

    expect(mockSignMessage).toHaveBeenCalledWith({
      message: `taskmarket:read:${ADDRESS.toLowerCase()}`,
    });
    const [path, options] = vi.mocked(apiGet).mock.calls[0];
    expect(path).toBe(`/api/tasks/${TASK_ID}/submissions`);
    expect(options?.headers).toEqual({
      'X-Taskmarket-Caller-Address': ADDRESS,
      'X-Taskmarket-Caller-Signature': '0xsignature',
    });
  });

  it('falls back to an unauthenticated request when signing fails, without erroring', async () => {
    mockSignMessage.mockRejectedValue(new Error('signing failed'));
    vi.mocked(apiGet).mockResolvedValue([]);

    await submissionsCmd.parseAsync(['node', 'submissions', TASK_ID], { from: 'node' });

    const [, options] = vi.mocked(apiGet).mock.calls[0];
    expect(options?.headers).toEqual({});
    expect(printResult).toHaveBeenCalled();
  });

  it('falls back to an unauthenticated request when there is no keystore', async () => {
    vi.mocked(createWalletAccountFromKeystore).mockRejectedValueOnce(new Error('no keystore'));
    vi.mocked(apiGet).mockResolvedValue([]);

    await submissionsCmd.parseAsync(['node', 'submissions', TASK_ID], { from: 'node' });

    expect(mockSignMessage).not.toHaveBeenCalled();
    const [, options] = vi.mocked(apiGet).mock.calls[0];
    expect(options?.headers).toEqual({});
    expect(printResult).toHaveBeenCalledWith([]);
  });
});

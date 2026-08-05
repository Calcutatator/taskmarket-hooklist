import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/lib/x402.js', () => ({
  x402Post: vi.fn(),
}));

vi.mock('../../src/lib/output.js', () => ({
  printResult: vi.fn(),
  printError: vi.fn(),
  renderFailure: vi.fn((error: unknown) => {
    throw error instanceof Error ? error : new Error(String(error));
  }),
}));

vi.mock('../../src/lib/api.js', () => ({
  apiGet: vi.fn(),
}));

import { acceptCmd } from '../../src/commands/task/accept.js';
import { x402Post } from '../../src/lib/x402.js';
import { printResult, printError } from '../../src/lib/output.js';
import { apiGet } from '../../src/lib/api.js';

const mockTask = {
  expiryTime: new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString(),
  pendingActions: [{ action: 'accept', role: 'requester' }],
};

describe('task accept command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(apiGet).mockResolvedValue(mockTask);
  });

  it('posts to accept endpoint with worker address', async () => {
    vi.mocked(x402Post).mockResolvedValue({});

    await acceptCmd.parseAsync(['node', 'accept', '0xtask', '--worker', '0xworker'], {
      from: 'node',
    });

    expect(x402Post).toHaveBeenCalledWith('/api/tasks/0xtask/accept', {
      taskId: '0xtask',
      worker: '0xworker',
    });
    expect(printResult).toHaveBeenCalledWith({ accepted: true });
  });

  it('propagates errors from x402Post', async () => {
    vi.mocked(x402Post).mockRejectedValueOnce(new Error('network error'));

    await expect(
      acceptCmd.parseAsync(['node', 'accept', '0xtask', '--worker', '0xworker'], { from: 'node' })
    ).rejects.toThrow('network error');
  });

  it('exits without calling x402Post when accept is not in pendingActions', async () => {
    vi.mocked(apiGet).mockResolvedValue({
      expiryTime: new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString(),
      pendingActions: [],
    });

    await acceptCmd.parseAsync(['node', 'accept', '0xtask', '--worker', '0xworker'], {
      from: 'node',
    });

    expect(x402Post).not.toHaveBeenCalled();
    expect(printError).toHaveBeenCalled();
  });

  it('reports expired when task has no submissions and is past expiry', async () => {
    vi.mocked(apiGet).mockResolvedValue({
      expiryTime: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      pendingActions: [{ action: 'refund_expired', role: 'requester' }],
    });

    await acceptCmd.parseAsync(['node', 'accept', '0xtask', '--worker', '0xworker'], {
      from: 'node',
    });

    expect(x402Post).not.toHaveBeenCalled();
    expect(printError).toHaveBeenCalledWith(expect.stringContaining('expired'));
  });
});

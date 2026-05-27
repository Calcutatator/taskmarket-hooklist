import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/lib/x402.js', () => ({
  x402Post: vi.fn(),
}));

vi.mock('../../src/lib/output.js', () => ({
  printResult: vi.fn(),
}));

import { acceptCmd } from '../../src/commands/task/accept.js';
import { x402Post } from '../../src/lib/x402.js';
import { printResult } from '../../src/lib/output.js';

describe('task accept command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('posts to accept endpoint with worker address', async () => {
    vi.mocked(x402Post).mockResolvedValue({});

    await acceptCmd.parseAsync(
      ['node', 'accept', '0xtask', '--worker', '0xworker'],
      { from: 'node' }
    );

    expect(x402Post).toHaveBeenCalledWith('/api/tasks/0xtask/accept', {
      taskId: '0xtask',
      worker: '0xworker',
    });
    expect(printResult).toHaveBeenCalledWith({ accepted: true });
  });

  it('includes deliverable when provided', async () => {
    vi.mocked(x402Post).mockResolvedValue({});
    const deliverable = '0x' + 'ab'.repeat(32);

    await acceptCmd.parseAsync(
      ['node', 'accept', '0xtask', '--worker', '0xworker', '--deliverable', deliverable],
      { from: 'node' }
    );

    expect(x402Post).toHaveBeenCalledWith('/api/tasks/0xtask/accept', {
      taskId: '0xtask',
      worker: '0xworker',
      deliverable,
    });
  });

  it('propagates errors from x402Post', async () => {
    vi.mocked(x402Post).mockRejectedValueOnce(new Error('Task not found'));

    await expect(
      acceptCmd.parseAsync(['node', 'accept', '0xtask', '--worker', '0xworker'], { from: 'node' })
    ).rejects.toThrow('Task not found');
  });

  it('rejects invalid deliverable hash', async () => {
    await expect(
      acceptCmd.parseAsync(
        ['node', 'accept', '0xtask', '--worker', '0xworker', '--deliverable', '0xdeadbeef'],
        { from: 'node' }
      )
    ).rejects.toThrow('--deliverable must be a 0x-prefixed 32-byte hex string');
  });
});

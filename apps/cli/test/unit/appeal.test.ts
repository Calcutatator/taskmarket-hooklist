import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/lib/x402.js', () => ({
  x402Post: vi.fn(),
}));

vi.mock('../../src/lib/output.js', () => ({
  printResult: vi.fn(),
}));

import { appealCmd } from '../../src/commands/task/appeal.js';
import { x402Post } from '../../src/lib/x402.js';
import { printResult } from '../../src/lib/output.js';

describe('task appeal command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('posts to appeal endpoint and prints txHash', async () => {
    vi.mocked(x402Post).mockResolvedValue({ txHash: '0xtxhash' });

    await appealCmd.parseAsync(['node', 'appeal', '0xtask'], { from: 'node' });

    expect(x402Post).toHaveBeenCalledWith('/api/tasks/0xtask/appeal', { taskId: '0xtask' });
    expect(printResult).toHaveBeenCalledWith({ txHash: '0xtxhash' });
  });

  it('propagates errors from x402Post', async () => {
    vi.mocked(x402Post).mockRejectedValueOnce(new Error('Task is not in Appealing state'));

    await expect(
      appealCmd.parseAsync(['node', 'appeal', '0xtask'], { from: 'node' })
    ).rejects.toThrow('Task is not in Appealing state');
  });
});

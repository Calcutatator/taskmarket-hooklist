import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/lib/x402.js', () => ({
  x402Post: vi.fn(),
}));

vi.mock('../../src/lib/output.js', () => ({
  printResult: vi.fn(),
}));

import { finalizeVerdictCmd } from '../../src/commands/task/finalize-verdict.js';
import { x402Post } from '../../src/lib/x402.js';
import { printResult } from '../../src/lib/output.js';

describe('task finalize-verdict command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('posts to finalize-verdict endpoint and prints txHash', async () => {
    vi.mocked(x402Post).mockResolvedValue({ txHash: '0xfinalizetx' });

    await finalizeVerdictCmd.parseAsync(['node', 'finalize-verdict', '0xtask'], { from: 'node' });

    expect(x402Post).toHaveBeenCalledWith('/api/tasks/0xtask/finalize-verdict', {
      taskId: '0xtask',
    });
    expect(printResult).toHaveBeenCalledWith({ txHash: '0xfinalizetx' });
  });

  it('propagates errors from x402Post', async () => {
    vi.mocked(x402Post).mockRejectedValueOnce(new Error('Appeal window not expired'));

    await expect(
      finalizeVerdictCmd.parseAsync(['node', 'finalize-verdict', '0xtask'], { from: 'node' })
    ).rejects.toThrow('Appeal window not expired');
  });
});

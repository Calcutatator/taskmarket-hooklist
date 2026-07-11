import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/lib/api.js', () => ({
  apiPost: vi.fn(),
}));

vi.mock('../../src/lib/output.js', () => ({
  printResult: vi.fn(),
}));

import { finalizeVerdictCmd } from '../../src/commands/task/finalize-verdict.js';
import { apiPost } from '../../src/lib/api.js';
import { printResult } from '../../src/lib/output.js';

describe('task finalize-verdict command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('posts to finalize-verdict endpoint and prints txHash', async () => {
    vi.mocked(apiPost).mockResolvedValue({ txHash: '0xfinalizetx' });

    await finalizeVerdictCmd.parseAsync(['node', 'finalize-verdict', '0xtask'], { from: 'node' });

    expect(apiPost).toHaveBeenCalledWith('/api/tasks/0xtask/finalize-verdict', {
      taskId: '0xtask',
    });
    expect(printResult).toHaveBeenCalledWith({ txHash: '0xfinalizetx' });
  });

  it('propagates errors from apiPost', async () => {
    vi.mocked(apiPost).mockRejectedValueOnce(new Error('Appeal window not expired'));

    await expect(
      finalizeVerdictCmd.parseAsync(['node', 'finalize-verdict', '0xtask'], { from: 'node' })
    ).rejects.toThrow('Appeal window not expired');
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { writeOutcome, TEST_IDEMPOTENCY_KEY } from '../helpers/write-outcome.js';

vi.mock('../../src/lib/x402.js', () => ({
  x402Post: vi.fn(),
}));

vi.mock('../../src/lib/output.js', () => ({
  printResult: vi.fn(),
  renderFailure: vi.fn((error: unknown) => {
    throw error instanceof Error ? error : new Error(String(error));
  }),
}));

import { evaluatorTimeoutCmd } from '../../src/commands/task/evaluator-timeout.js';
import { x402Post } from '../../src/lib/x402.js';
import { printResult } from '../../src/lib/output.js';

describe('task evaluator-timeout command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('posts to evaluator-timeout endpoint and prints txHash', async () => {
    vi.mocked(x402Post).mockResolvedValue(writeOutcome({ txHash: '0xtxhash' }));

    await evaluatorTimeoutCmd.parseAsync(['node', 'evaluator-timeout', '0xtask'], { from: 'node' });

    expect(x402Post).toHaveBeenCalledWith('/api/tasks/0xtask/evaluator-timeout', {
      taskId: '0xtask',
    });
    expect(printResult).toHaveBeenCalledWith({ txHash: '0xtxhash' }, { idempotencyKey: TEST_IDEMPOTENCY_KEY });
  });

  it('propagates errors from x402Post', async () => {
    vi.mocked(x402Post).mockRejectedValueOnce(new Error('Task is not in Review state'));

    await expect(
      evaluatorTimeoutCmd.parseAsync(['node', 'evaluator-timeout', '0xtask'], { from: 'node' })
    ).rejects.toThrow('Task is not in Review state');
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/lib/x402.js', () => ({
  x402Post: vi.fn(),
}));

vi.mock('../../src/lib/output.js', () => ({
  printResult: vi.fn(),
}));

import { bidCmd } from '../../src/commands/task/bid.js';
import { x402Post } from '../../src/lib/x402.js';
import { printResult } from '../../src/lib/output.js';

describe('task bid command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('converts USDC price to base units and posts to bids endpoint', async () => {
    vi.mocked(x402Post).mockResolvedValue({ bidId: 'bid-1' });

    await bidCmd.parseAsync(['node', 'bid', '0xtask', '--price', '3'], { from: 'node' });

    expect(x402Post).toHaveBeenCalledWith('/api/tasks/0xtask/bids', {
      taskId: '0xtask',
      price: '3000000',
    });
    expect(printResult).toHaveBeenCalledWith({ bidId: 'bid-1' });
  });

  it('handles decimal prices', async () => {
    vi.mocked(x402Post).mockResolvedValue({ bidId: 'bid-2' });

    await bidCmd.parseAsync(['node', 'bid', '0xtask', '--price', '1.5'], { from: 'node' });

    expect(x402Post).toHaveBeenCalledWith('/api/tasks/0xtask/bids', {
      taskId: '0xtask',
      price: '1500000',
    });
  });

  it('propagates errors from x402Post', async () => {
    vi.mocked(x402Post).mockRejectedValueOnce(new Error('Bid too high'));

    await expect(
      bidCmd.parseAsync(['node', 'bid', '0xtask', '--price', '5'], { from: 'node' })
    ).rejects.toThrow('Bid too high');
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/lib/x402.js', () => ({
  x402Post: vi.fn(),
}));

vi.mock('../../src/lib/output.js', () => ({
  printResult: vi.fn(),
}));

import { auctionAcceptCmd } from '../../src/commands/task/auction-accept.js';
import { x402Post } from '../../src/lib/x402.js';
import { printResult } from '../../src/lib/output.js';

describe('task auction-accept command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('posts to bids accept endpoint without min-price', async () => {
    vi.mocked(x402Post).mockResolvedValue({ acceptedPrice: '2000000', workerAddress: '0xworker' });

    await auctionAcceptCmd.parseAsync(['node', 'auction-accept', '0xtask'], { from: 'node' });

    expect(x402Post).toHaveBeenCalledWith('/api/tasks/0xtask/bids/accept', { taskId: '0xtask' });
    expect(printResult).toHaveBeenCalledWith({
      acceptedPrice: '2000000',
      acceptedPriceUsdc: '2.000000',
      workerAddress: '0xworker',
    });
  });

  it('converts --min-price to base units', async () => {
    vi.mocked(x402Post).mockResolvedValue({ acceptedPrice: '3000000', workerAddress: '0xworker' });

    await auctionAcceptCmd.parseAsync(
      ['node', 'auction-accept', '0xtask', '--min-price', '1.5'],
      { from: 'node' }
    );

    expect(x402Post).toHaveBeenCalledWith('/api/tasks/0xtask/bids/accept', {
      taskId: '0xtask',
      minPrice: '1500000',
    });
  });

  it('propagates errors from x402Post', async () => {
    vi.mocked(x402Post).mockRejectedValueOnce(new Error('Price below floor'));

    await expect(
      auctionAcceptCmd.parseAsync(['node', 'auction-accept', '0xtask'], { from: 'node' })
    ).rejects.toThrow('Price below floor');
  });

  it('rejects invalid --min-price', async () => {
    await expect(
      auctionAcceptCmd.parseAsync(
        ['node', 'auction-accept', '0xtask', '--min-price', 'abc'],
        { from: 'node' }
      )
    ).rejects.toThrow('--min-price: invalid number "abc"');
  });
});

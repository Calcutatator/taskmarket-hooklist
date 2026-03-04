import { Command } from 'commander';
import { x402Post } from '../../lib/x402.js';
import { printResult } from '../../lib/output.js';

export const bidCmd = new Command('bid')
  .description('Submit a bid on an auction task')
  .argument('<taskId>', 'Task ID (0x-prefixed hex)')
  .requiredOption('--price <usdc>', 'Bid price in USDC (e.g. 3 or 1.5)')
  .action(async (taskId: string, opts: { price: string }) => {
    const priceBaseUnits = String(Math.round(parseFloat(opts.price) * 1e6));

    const result = (await x402Post(`/api/tasks/${taskId}/bids`, {
      taskId,
      price: priceBaseUnits,
    })) as { bidId: string };

    printResult({ bidId: result.bidId });
  });

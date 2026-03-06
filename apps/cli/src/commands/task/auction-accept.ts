import { Command } from 'commander';
import { x402Post } from '../../lib/x402.js';
import { printResult } from '../../lib/output.js';

export const auctionAcceptCmd = new Command('auction-accept')
  .description('Accept current clock price on a dutch or reverse_dutch auction task')
  .argument('<taskId>', 'Task ID (0x-prefixed hex)')
  .option(
    '--min-price <usdc>',
    'Reject if current clock price is below this value (price floor guard)'
  )
  .action(async (taskId: string, opts: { minPrice?: string }) => {
    const body: Record<string, unknown> = { taskId };
    if (opts.minPrice) {
      const parsed = parseFloat(opts.minPrice);
      if (!Number.isFinite(parsed)) {
        throw new Error(`--min-price: invalid number "${opts.minPrice}"`);
      }
      body.minPrice = String(Math.round(parsed * 1e6));
    }
    const result = (await x402Post(`/api/tasks/${taskId}/bids/accept`, body)) as {
      acceptedPrice: string;
      workerAddress: string;
    };
    printResult({
      acceptedPrice: result.acceptedPrice,
      acceptedPriceUsdc: (Number(result.acceptedPrice) / 1_000_000).toFixed(6),
      workerAddress: result.workerAddress,
    });
  });

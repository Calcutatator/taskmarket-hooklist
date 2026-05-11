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
      const [intPart = '0', fracPart = ''] = opts.minPrice.trim().split('.');
      if (!/^\d+$/.test(intPart) || (fracPart && !/^\d+$/.test(fracPart))) {
        throw new Error(`--min-price: invalid number "${opts.minPrice}"`);
      }
      const padded = fracPart.slice(0, 6).padEnd(6, '0');
      body.minPrice = (BigInt(intPart) * 1_000_000n + BigInt(padded)).toString();
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

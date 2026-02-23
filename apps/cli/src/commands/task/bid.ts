import { Command } from 'commander';
import { loadKeystore } from '../../lib/keystore.js';
import { apiPost } from '../../lib/api.js';

export const bidCmd = new Command('bid')
  .description('Submit a bid on an auction task')
  .argument('<taskId>', 'Task ID (0x-prefixed hex)')
  .requiredOption('--price <usdc>', 'Bid price in USDC (e.g. 3 or 1.5)')
  .action(async (taskId: string, opts: { price: string }) => {
    const keystore = await loadKeystore();
    const priceBaseUnits = String(Math.round(parseFloat(opts.price) * 1e6));

    const result = (await apiPost(`/api/tasks/${taskId}/bids`, {
      taskId,
      price: priceBaseUnits,
      workerAddress: keystore.walletAddress,
    })) as { bidId: string };

    console.log('Bid submitted:', result.bidId);
  });

import { Command } from 'commander';
import { loadKeystore } from '../lib/keystore.js';
import { apiGet } from '../lib/api.js';

export const statsCommand = new Command('stats')
  .description('View agent statistics')
  .option('--address <addr>', 'Wallet address (defaults to own wallet)')
  .action(async (opts: { address?: string }) => {
    let address = opts.address;
    if (!address) {
      const keystore = await loadKeystore();
      address = keystore.walletAddress;
    }

    const result = (await apiGet(`/api/agents/stats?address=${address}`)) as {
      completedTasks: number;
      averageRating: number | null;
      totalEarnings: string;
    };

    console.log('Address:', address);
    console.log('Completed tasks:', result.completedTasks);
    console.log('Average rating:', result.averageRating ?? 'N/A');
    console.log('Total earnings:', result.totalEarnings);
  });

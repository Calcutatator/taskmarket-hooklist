import { Command } from 'commander';
import { loadKeystore } from '../lib/keystore.js';
import { apiGet } from '../lib/api.js';
import { printResult } from '../lib/output.js';

export const statsCommand = new Command('stats')
  .description('View agent statistics')
  .option('--address <addr>', 'Wallet address (defaults to own wallet)')
  .action(async (opts: { address?: string }) => {
    let address = opts.address;
    if (!address) {
      const keystore = await loadKeystore();
      address = keystore.walletAddress;
    }

    const [result, balanceResult] = await Promise.all([
      apiGet(`/api/agents/stats?address=${address}`) as Promise<{
        completedTasks: number;
        averageRating: number | null;
        totalEarnings: string;
      }>,
      apiGet(`/api/wallet/balance?address=${address}`) as Promise<{
        balanceBaseUnits: string;
        balanceUsdc: string;
      }>,
    ]);

    printResult({
      address,
      balanceUsdc: balanceResult.balanceUsdc,
      balanceBaseUnits: balanceResult.balanceBaseUnits,
      completedTasks: result.completedTasks,
      averageRating: result.averageRating,
      totalEarnings: result.totalEarnings,
    });
  });

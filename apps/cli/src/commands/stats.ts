import { Command } from 'commander';
import { loadKeystore } from '../lib/keystore.js';
import { apiGet } from '../lib/api.js';
import { isHumanMode, printResult } from '../lib/output.js';

export const statsCommand = new Command('stats')
  .description('View agent statistics')
  .option('--address <addr>', 'Wallet address (defaults to own wallet)')
  .option('--human', 'Human-readable output')
  .action(async (opts: { address?: string; human?: boolean }) => {
    const human = isHumanMode(opts.human);
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

    if (human) {
      console.log('Address:', address);
      console.log('Balance:', balanceResult.balanceUsdc, 'USDC');
      console.log('Completed tasks:', result.completedTasks);
      console.log('Average rating:', result.averageRating ?? 'N/A');
      console.log('Total earnings:', result.totalEarnings);
    } else {
      printResult(
        {
          address,
          balanceUsdc: balanceResult.balanceUsdc,
          balanceBaseUnits: balanceResult.balanceBaseUnits,
          completedTasks: result.completedTasks,
          averageRating: result.averageRating,
          totalEarnings: result.totalEarnings,
        },
        human
      );
    }
  });

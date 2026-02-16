import { Command } from 'commander';
import { api } from '../lib/api';
import { getAddress } from '../lib/wallet';

export const statsCommand = new Command('stats')
  .description('View worker statistics')
  .argument('[address]', 'Worker address (defaults to your address)')
  .action(async (address?: string) => {
    try {
      const targetAddress = address || (await getAddress());

      const stats = await api.agents.get.query({ address: targetAddress });

      if (!stats) {
        console.log(`\nNo stats found for ${targetAddress}`);
        return;
      }

      console.log(`\nWorker Stats for ${targetAddress}:`);
      console.log(`Completed Tasks: ${stats.completedTasks}`);
      console.log(`Rated Tasks: ${stats.ratedTasks}`);
      console.log(
        `Average Rating: ${stats.ratedTasks > 0 ? (stats.totalStars / stats.ratedTasks).toFixed(2) : 'N/A'} stars`
      );
      console.log(`Total Earnings: ${(Number(stats.totalEarnings) / 1e6).toFixed(2)} USDC`);
    } catch (error) {
      console.error('Error fetching stats:', error);
      process.exit(1);
    }
  });

import { Command } from 'commander';
import { api } from '../lib/api';

export const searchCommand = new Command('search')
  .description('Search for tasks')
  .option('-s, --status <status>', 'Filter by status')
  .option('-m, --mode <mode>', 'Filter by mode (contest|instant|proposal|race)')
  .option('-t, --tags <tags>', 'Comma-separated tags to filter by')
  .option('--min-reward <amount>', 'Minimum reward in USDC')
  .option('-l, --limit <number>', 'Maximum number of results', '20')
  .action(async (options) => {
    try {
      const tags = options.tags ? options.tags.split(',').map((t: string) => t.trim()) : undefined;

      const result = await api.tasks.list.query({
        status: options.status || 'ALL',
        mode: options.mode || 'ALL',
        tags,
        minReward: options.minReward,
        limit: parseInt(options.limit),
      });

      console.log(`\nFound ${result.tasks.length} tasks:\n`);

      result.tasks.forEach((task) => {
        console.log(`ID: ${task.id}`);
        console.log(`Mode: ${task.mode}`);
        console.log(`Description: ${task.description.substring(0, 100)}...`);
        console.log(`Reward: ${(Number(task.reward) / 1e6).toFixed(2)} USDC`);
        console.log(`Status: ${task.status}`);
        console.log(`Tags: ${task.tags.join(', ')}`);
        console.log(`Created: ${new Date(task.createdAt).toLocaleString()}`);
        console.log(`Expires: ${new Date(task.expiryTime).toLocaleString()}`);
        console.log('---');
      });

      if (result.hasMore) {
        console.log(`\n(${result.tasks.length} of many results shown)`);
      }
    } catch (error) {
      console.error('Error searching tasks:', error);
      process.exit(1);
    }
  });

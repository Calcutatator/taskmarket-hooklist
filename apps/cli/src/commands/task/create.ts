import { Command } from 'commander';
import { x402Post } from '../../lib/x402.js';

export const createCmd = new Command('create')
  .description('Create a new task (costs reward amount in USDC)')
  .requiredOption('--description <text>', 'Task description')
  .requiredOption('--reward <usdc>', 'Reward in USDC (e.g. 5 for 5 USDC)')
  .requiredOption('--duration <days>', 'Task duration in days')
  .option('--mode <mode>', 'Task mode: contest, instant, proposal, race', 'contest')
  .option('--tags <tags>', 'Comma-separated tags')
  .action(async (opts: {
    description: string;
    reward: string;
    duration: string;
    mode: string;
    tags?: string;
  }) => {
    const rewardBaseUnits = String(Math.round(parseFloat(opts.reward) * 1e6));
    const tags = opts.tags ? opts.tags.split(',').map((t) => t.trim()) : [];

    const result = (await x402Post('/api/tasks', {
      description: opts.description,
      reward: rewardBaseUnits,
      duration: parseInt(opts.duration, 10),
      mode: opts.mode,
      tags,
      stakeRequired: false,
      stakeBps: 0,
    })) as { success: boolean; taskId: string };

    console.log('Task created:', result.taskId);
  });

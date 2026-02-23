import { Command } from 'commander';
import { x402Post } from '../../lib/x402.js';
import { isHumanMode, printResult, printError } from '../../lib/output.js';

export const createCmd = new Command('create')
  .description('Create a new task (costs reward amount in USDC)')
  .requiredOption('--description <text>', 'Task description')
  .requiredOption('--reward <usdc>', 'Reward in USDC (e.g. 5 for 5 USDC)')
  .requiredOption('--duration <hours>', 'Task duration in hours')
  .option('--mode <mode>', 'Task mode: bounty, claim, pitch, benchmark, auction', 'bounty')
  .option('--tags <tags>', 'Comma-separated tags')
  .option('--pitch-deadline <hours>', 'Pitch deadline in hours from now (pitch mode only)')
  .option('--bid-deadline <hours>', 'Bid deadline in hours from now (auction mode only)')
  .option('--max-price <usdc>', 'Maximum bid price in USDC (required for auction mode)')
  .option('--human', 'Human-readable output')
  .action(
    async (opts: {
      description: string;
      reward: string;
      duration: string;
      mode: string;
      tags?: string;
      pitchDeadline?: string;
      bidDeadline?: string;
      maxPrice?: string;
      human?: boolean;
    }) => {
      const human = isHumanMode(opts.human);

      if (opts.mode === 'auction' && !opts.maxPrice) {
        printError('--max-price is required for auction mode', human);
      }

      const rewardBaseUnits = String(Math.round(parseFloat(opts.reward) * 1e6));
      const tags = opts.tags ? opts.tags.split(',').map((t) => t.trim()) : [];

      const body: Record<string, unknown> = {
        description: opts.description,
        reward: rewardBaseUnits,
        duration: parseInt(opts.duration, 10),
        mode: opts.mode,
        tags,
        stakeRequired: false,
        stakeBps: 0,
      };

      if (opts.pitchDeadline) {
        body.pitchDeadline = parseInt(opts.pitchDeadline, 10) * 3600;
      }

      if (opts.bidDeadline) {
        body.bidDeadline = parseInt(opts.bidDeadline, 10);
      }

      if (opts.maxPrice) {
        body.maxPrice = String(Math.round(parseFloat(opts.maxPrice) * 1e6));
      }

      const result = (await x402Post('/api/tasks', body)) as { success: boolean; taskId: string };

      if (human) {
        console.log('Task created:', result.taskId);
      } else {
        printResult({ taskId: result.taskId }, human);
      }
    }
  );

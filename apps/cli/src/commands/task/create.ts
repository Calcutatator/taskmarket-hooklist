import { Command } from 'commander';
import { x402Post } from '../../lib/x402.js';
import { printResult, printError } from '../../lib/output.js';

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
  .option(
    '--auction-type <type>',
    'Auction subtype: dutch, english, reverse_dutch, reverse_english (required for auction mode)'
  )
  .option(
    '--auction-start-price <usdc>',
    'Starting clock price in USDC for reverse_dutch (required for reverse_dutch)'
  )
  .option(
    '--auction-floor-price <usdc>',
    'Floor price in USDC for dutch clock (optional, defaults to 0)'
  )
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
      auctionType?: string;
      auctionStartPrice?: string;
      auctionFloorPrice?: string;
    }) => {
      if (opts.mode === 'auction') {
        if (!opts.maxPrice) {
          return void printError('--max-price is required for auction mode');
        }
        if (!opts.auctionType) {
          return void printError(
            '--auction-type is required for auction mode (dutch, english, reverse_dutch, reverse_english)'
          );
        }
        const validTypes = ['dutch', 'english', 'reverse_dutch', 'reverse_english'];
        if (!validTypes.includes(opts.auctionType)) {
          return void printError(
            `--auction-type must be one of: ${validTypes.join(', ')}. Got: ${opts.auctionType}`
          );
        }
        if (opts.auctionType === 'reverse_dutch' && !opts.auctionStartPrice) {
          return void printError(
            '--auction-start-price is required for reverse_dutch auction type'
          );
        }
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

      if (opts.auctionType) {
        body.auctionType = opts.auctionType;
      }

      if (opts.auctionStartPrice) {
        body.auctionStartPrice = String(Math.round(parseFloat(opts.auctionStartPrice) * 1e6));
      }

      if (opts.auctionFloorPrice) {
        body.auctionFloorPrice = String(Math.round(parseFloat(opts.auctionFloorPrice) * 1e6));
      }

      const result = (await x402Post('/api/tasks', body)) as { success: boolean; taskId: string };
      printResult({ taskId: result.taskId });
    }
  );

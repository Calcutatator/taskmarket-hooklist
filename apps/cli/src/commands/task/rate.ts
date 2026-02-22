import { Command } from 'commander';
import { x402Post } from '../../lib/x402.js';

export const rateCmd = new Command('rate')
  .description('Rate a worker (costs 0.001 USDC)')
  .argument('<taskId>', 'Task ID (0x-prefixed hex)')
  .requiredOption('--worker <addr>', 'Worker wallet address')
  .requiredOption('--rating <n>', 'Rating 0-100')
  .option('--feedback <text>', 'Optional feedback text')
  .action(async (taskId: string, opts: { worker: string; rating: string; feedback?: string }) => {
    const rating = parseInt(opts.rating, 10);
    if (rating < 0 || rating > 100) {
      console.error('Rating must be between 0 and 100');
      process.exit(1);
    }

    const result = (await x402Post(`/api/tasks/${taskId}/rate`, {
      taskId,
      worker: opts.worker,
      rating,
      ...(opts.feedback ? { feedbackText: opts.feedback } : {}),
    })) as { success: boolean; feedbackId: string };

    console.log('Rated. Feedback ID:', result.feedbackId);
  });

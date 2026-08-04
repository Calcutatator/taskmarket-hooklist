import { Command } from 'commander';
import { x402Post } from '../../lib/x402.js';
import { printResult, renderFailure } from '../../lib/output.js';

export const refundExpiredCmd = new Command('refund-expired')
  .description(
    'Refund an expired task with no submissions back to the requester (costs 0.001 USDC)'
  )
  .argument('<taskId>', 'Task ID (0x-prefixed hex)')
  .action(async (taskId: string) => {
    try {
      const result = await x402Post(`/api/tasks/${taskId}/refund-expired`, { taskId });
      printResult(result as Record<string, unknown>);
    } catch (err) {
      renderFailure(err);
    }
  });

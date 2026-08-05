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
      const { data: result, idempotencyKey } = await x402Post<Record<string, unknown>>(
        `/api/tasks/${taskId}/refund-expired`,
        { taskId }
      );
      printResult(result, { idempotencyKey });
    } catch (err) {
      renderFailure(err);
    }
  });

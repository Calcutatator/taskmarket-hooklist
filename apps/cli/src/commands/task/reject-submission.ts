import { Command } from 'commander';
import { x402Post } from '../../lib/x402.js';
import { printResult, renderFailure } from '../../lib/output.js';

export const rejectSubmissionCmd = new Command('reject-submission')
  .description(
    'Reject a spam or low-quality submission (costs 0.001 USDC relay fee). Once all submissions are rejected, the task can be cancelled to recover escrow.'
  )
  .argument('<taskId>', 'Task ID (0x-prefixed hex)')
  .requiredOption('--worker <address>', 'Worker address whose submission to reject')
  .action(async (taskId: string, opts: { worker: string }) => {
    try {
      const { data: result, idempotencyKey } = await x402Post<Record<string, unknown>>(
        `/api/tasks/${taskId}/reject-submission`,
        {
          taskId,
          worker: opts.worker,
        }
      );
      printResult(result, { idempotencyKey });
    } catch (err) {
      renderFailure(err);
    }
  });

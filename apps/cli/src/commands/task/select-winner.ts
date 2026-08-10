import { Command } from 'commander';
import { apiPost } from '../../lib/api.js';
import { printResult, renderFailure } from '../../lib/output.js';

export const selectWinnerCmd = new Command('select-winner')
  .description('Permissionlessly finalize the lowest bidder after the auction deadline')
  .argument('<taskId>', 'Task ID (0x-prefixed hex)')
  .action(async (taskId: string) => {
    let result: { success: boolean; workerAddress: string };
    let idempotencyKey: string;
    try {
      ({ data: result, idempotencyKey } = await apiPost<typeof result>(
        `/api/tasks/${taskId}/bids/select-winner`,
        { taskId }
      ));
    } catch (err: unknown) {
      renderFailure(err, { fallback: 'Failed to select winner.' });
      return;
    }

    printResult(result, { idempotencyKey });
  });

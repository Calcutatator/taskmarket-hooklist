import { Command } from 'commander';
import { apiPost } from '../../lib/api.js';
import { printResult, printError } from '../../lib/output.js';

export const selectWinnerCmd = new Command('select-winner')
  .description('Select lowest bidder after auction deadline (requester only)')
  .argument('<taskId>', 'Task ID (0x-prefixed hex)')
  .action(async (taskId: string) => {
    let result: { success: boolean; workerAddress: string };
    try {
      result = (await apiPost(`/api/tasks/${taskId}/bids/select-winner`, {
        taskId,
      })) as typeof result;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to select winner.';
      printError(msg);
    }

    printResult(result!);
  });

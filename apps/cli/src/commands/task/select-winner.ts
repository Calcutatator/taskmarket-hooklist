import { Command } from 'commander';
import { apiPost } from '../../lib/api.js';
import { isHumanMode, printResult, printError } from '../../lib/output.js';

export const selectWinnerCmd = new Command('select-winner')
  .description('Select lowest bidder after auction deadline (requester only)')
  .argument('<taskId>', 'Task ID (0x-prefixed hex)')
  .option('--human', 'Human-readable output')
  .action(async (taskId: string, opts: { human?: boolean }) => {
    const human = isHumanMode(opts.human);

    let result: { success: boolean; workerAddress: string };
    try {
      result = (await apiPost(`/api/tasks/${taskId}/bids/select-winner`, {
        taskId,
      })) as typeof result;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to select winner.';
      printError(msg, human);
    }

    if (human) {
      console.log('Winner selected:', result!.workerAddress);
      console.log('');
      console.log(`Next: taskmarket task accept ${taskId} --worker ${result!.workerAddress}`);
    } else {
      printResult(result!, human);
    }
  });

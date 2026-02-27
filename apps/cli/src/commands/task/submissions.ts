import { Command } from 'commander';
import { apiGet } from '../../lib/api.js';
import { printResult, printError } from '../../lib/output.js';

export const submissionsCmd = new Command('submissions')
  .description('List submissions for a task')
  .argument('<taskId>', 'Task ID (0x-prefixed hex)')
  .action(async (taskId: string) => {
    let subs: unknown;
    try {
      subs = await apiGet(`/api/tasks/${taskId}/submissions`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to fetch submissions.';
      printError(msg);
    }
    printResult(subs!);
  });

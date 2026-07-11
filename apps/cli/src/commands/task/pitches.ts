import { Command } from 'commander';
import { apiGet } from '../../lib/api.js';
import { printError, printResult } from '../../lib/output.js';

export const pitchesCmd = new Command('pitches')
  .description('List pitches for a task')
  .argument('<taskId>', 'Task ID (0x-prefixed hex)')
  .action(async (taskId: string) => {
    try {
      printResult(await apiGet(`/api/tasks/${taskId}/pitches`));
    } catch (err) {
      printError(err instanceof Error ? err.message : String(err));
    }
  });

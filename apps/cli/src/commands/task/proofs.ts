import { Command } from 'commander';
import { apiGet } from '../../lib/api.js';
import { printError, printResult } from '../../lib/output.js';

export const proofsCmd = new Command('proofs')
  .description('List proofs for a benchmark task')
  .argument('<taskId>', 'Task ID (0x-prefixed hex)')
  .action(async (taskId: string) => {
    try {
      printResult(await apiGet(`/api/tasks/${taskId}/proofs`));
    } catch (err) {
      printError(err instanceof Error ? err.message : String(err));
    }
  });

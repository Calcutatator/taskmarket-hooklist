import { Command } from 'commander';
import { apiGet } from '../../lib/api.js';
import { printResult, printError } from '../../lib/output.js';

export const getCmd = new Command('get')
  .description('Get task details')
  .argument('<taskId>', 'Task ID (0x-prefixed hex)')
  .action(async (taskId: string) => {
    const task = (await apiGet(`/api/tasks/${taskId}`)) as Record<string, unknown> | null;
    if (!task) {
      printError(`Task not found: ${taskId}`);
    }
    printResult(task);
  });

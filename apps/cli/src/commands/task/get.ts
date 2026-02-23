import { Command } from 'commander';
import { apiGet } from '../../lib/api.js';
import { isHumanMode, printResult, printError } from '../../lib/output.js';

export const getCmd = new Command('get')
  .description('Get task details')
  .argument('<taskId>', 'Task ID (0x-prefixed hex)')
  .option('--human', 'Human-readable output')
  .action(async (taskId: string, opts: { human?: boolean }) => {
    const human = isHumanMode(opts.human);
    const task = (await apiGet(`/api/tasks/${taskId}`)) as Record<string, unknown> | null;
    if (!task) {
      printError(`Task not found: ${taskId}`, human);
    }
    if (human) {
      console.log(JSON.stringify(task, null, 2));
    } else {
      printResult(task, human);
    }
  });

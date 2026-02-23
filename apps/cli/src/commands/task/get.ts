import { Command } from 'commander';
import { apiGet } from '../../lib/api.js';
import { isHumanMode, printResult, printError } from '../../lib/output.js';

type PendingAction = { role: string; action: string; command: string };

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
      const { pendingActions, ...taskData } = task as Record<string, unknown> & {
        pendingActions?: PendingAction[];
      };
      console.log(JSON.stringify(taskData, null, 2));
      if (pendingActions && pendingActions.length > 0) {
        console.log('');
        console.log('Next steps:');
        for (const a of pendingActions) {
          console.log(`  [${a.role}] ${a.command}`);
        }
      }
    } else {
      printResult(task, human);
    }
  });

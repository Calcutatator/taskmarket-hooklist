import { Command } from 'commander';
import { apiGet } from '../../lib/api.js';

export const getCmd = new Command('get')
  .description('Get task details')
  .argument('<taskId>', 'Task ID (0x-prefixed hex)')
  .action(async (taskId: string) => {
    const task = (await apiGet(`/api/tasks/${taskId}`)) as Record<string, unknown> | null;
    if (!task) {
      console.log('Task not found:', taskId);
      return;
    }
    console.log(JSON.stringify(task, null, 2));
  });

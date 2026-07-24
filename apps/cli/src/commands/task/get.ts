import { Command } from 'commander';
import { apiGet } from '../../lib/api.js';
import { printResult, printError } from '../../lib/output.js';
import { signReadAuth } from '../../lib/read-auth.js';
import { taskAccessGrantHeaders } from '../../lib/task-access-grants.js';

export const getCmd = new Command('get')
  .description('Get task details')
  .argument('<taskId>', 'Task ID (0x-prefixed hex)')
  .action(async (taskId: string) => {
    // Phase 3 (ADR-0030): proves wallet ownership and attaches any cached
    // password-verified grant for this task, so a private task's requester/allowlisted
    // wallet/unlocked caller sees it here too. Non-fatal if neither is available --
    // falls back to whatever the anonymous view already reveals.
    const auth = await signReadAuth();
    const headers = { ...(auth?.headers ?? {}), ...(await taskAccessGrantHeaders(taskId)) };

    const task = (await apiGet(`/api/tasks/${taskId}`, { headers })) as Record<
      string,
      unknown
    > | null;
    if (!task) {
      printError(`Task not found: ${taskId}`);
    }
    printResult(task);
  });

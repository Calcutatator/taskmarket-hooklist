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
      // The backend returns this same response for a genuinely nonexistent task and for
      // a private task the caller can't view (by design -- it never distinguishes the two,
      // see docs/reference/raw-api.md's Private Tasks section). So this hint is shown
      // unconditionally rather than only when the task is known to be private: it can't
      // leak anything an attacker couldn't already infer, since it's the same message
      // either way.
      printError(
        `Task not found: ${taskId} (or this is a private task you don't have access to -- ` +
          `if you have a password for it, run: taskmarket task unlock ${taskId} --password <password>)`
      );
    }
    printResult(task);
  });

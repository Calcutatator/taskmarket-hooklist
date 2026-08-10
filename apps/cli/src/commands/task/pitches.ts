import { Command } from 'commander';
import { apiGet } from '../../lib/api.js';
import { printResult, renderFailure } from '../../lib/output.js';
import { signReadAuth } from '../../lib/read-auth.js';
import { taskAccessGrantHeaders } from '../../lib/task-access-grants.js';

export const pitchesCmd = new Command('pitches')
  .description('List pitches for a task')
  .argument('<taskId>', 'Task ID (0x-prefixed hex)')
  .action(async (taskId: string) => {
    try {
      // Phase 3 (ADR-0030): see get.ts's comment -- same read-auth + cached-grant wiring.
      const auth = await signReadAuth();
      const headers = { ...(auth?.headers ?? {}), ...(await taskAccessGrantHeaders(taskId)) };
      printResult(await apiGet(`/api/tasks/${taskId}/pitches`, { headers }));
    } catch (err) {
      renderFailure(err);
    }
  });

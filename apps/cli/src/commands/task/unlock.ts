import { Command } from 'commander';
import { apiPost } from '../../lib/api.js';
import { printResult, printError } from '../../lib/output.js';
import { saveTaskAccessGrant } from '../../lib/task-access-grants.js';

/**
 * Phase 3 (ADR-0030): verifies a private task's password and caches the resulting
 * task-scoped access grant locally, so every subsequent read command for this taskId
 * (get, pitches, proofs, submissions, my-submissions) automatically attaches it.
 */
export const unlockCmd = new Command('unlock')
  .description('Unlock a private task with its password, caching a task-scoped access grant')
  .argument('<taskId>', 'Task ID (0x-prefixed hex)')
  .requiredOption('--password <password>', "The private task's password")
  .action(async (taskId: string, opts: { password: string }) => {
    let result: { grant: string; expiresAt: string };
    try {
      result = (await apiPost(`/api/tasks/${taskId}/private-access/verify`, {
        taskId,
        password: opts.password,
      })) as typeof result;
    } catch (err: unknown) {
      printError(err instanceof Error ? err.message : 'Failed to unlock task.');
      return;
    }

    await saveTaskAccessGrant(taskId, result.grant, result.expiresAt);
    printResult({ taskId, expiresAt: result.expiresAt });
  });

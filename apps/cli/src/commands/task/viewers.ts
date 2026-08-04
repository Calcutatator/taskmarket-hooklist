import { Command } from 'commander';
import { apiGet } from '../../lib/api.js';
import { printResult, printError, renderFailure } from '../../lib/output.js';
import { signReadAuth } from '../../lib/read-auth.js';

/** Phase 3 (ADR-0030): requester-only. Lists a private task's current wallet allowlist. */
export const viewersCmd = new Command('viewers')
  .description("List a private task's wallet allowlist (requester only)")
  .argument('<taskId>', 'Task ID (0x-prefixed hex)')
  .action(async (taskId: string) => {
    const auth = await signReadAuth();
    if (!auth || Object.keys(auth.headers).length === 0) {
      printError('No keystore found. Run `taskmarket init` first.');
      return;
    }

    try {
      const result = await apiGet(`/api/tasks/${taskId}/private-access/viewers`, {
        headers: auth.headers,
      });
      printResult(result as Record<string, unknown>);
    } catch (err: unknown) {
      renderFailure(err, { fallback: 'Failed to list viewers.' });
    }
  });

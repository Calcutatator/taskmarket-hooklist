import { Command } from 'commander';
import { apiDelete } from '../../lib/api.js';
import { printResult, printError, renderFailure } from '../../lib/output.js';
import { signReadAuth } from '../../lib/read-auth.js';

/** Phase 3 (ADR-0030): requester-only. Removes a wallet from a private task's allowlist. */
export const uninviteCmd = new Command('uninvite')
  .description("Remove a wallet from a private task's allowlist (requester only)")
  .argument('<taskId>', 'Task ID (0x-prefixed hex)')
  .argument('<address>', 'Wallet address to remove')
  .action(async (taskId: string, address: string) => {
    const auth = await signReadAuth();
    if (!auth || Object.keys(auth.headers).length === 0) {
      printError('No keystore found. Run `taskmarket init` first.');
      return;
    }

    try {
      const { data: result, idempotencyKey } = await apiDelete<Record<string, unknown>>(
        `/api/tasks/${taskId}/private-access/viewers/${encodeURIComponent(address)}`,
        { headers: auth.headers }
      );
      printResult(result, { idempotencyKey });
    } catch (err: unknown) {
      renderFailure(err, { fallback: 'Failed to remove viewer.' });
    }
  });

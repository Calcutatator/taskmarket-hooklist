import { Command } from 'commander';
import { apiPost } from '../../lib/api.js';
import { printResult, printError } from '../../lib/output.js';
import { signReadAuth } from '../../lib/read-auth.js';

/**
 * Phase 3 (ADR-0030): requester-only. Invites a wallet onto a private task's
 * allowlist -- the invited wallet then sees the task in its own `inbox` (self-authed)
 * under `invitedPrivateTasks`, and can view the task/its gated reads directly.
 */
export const inviteCmd = new Command('invite')
  .description('Invite a wallet to view a private task (requester only)')
  .argument('<taskId>', 'Task ID (0x-prefixed hex)')
  .argument('<address>', 'Wallet address to invite')
  .action(async (taskId: string, address: string) => {
    const auth = await signReadAuth();
    if (!auth || Object.keys(auth.headers).length === 0) {
      printError('No keystore found. Run `taskmarket init` first.');
      return;
    }

    try {
      const result = await apiPost(
        `/api/tasks/${taskId}/private-access/viewers`,
        { taskId, viewerAddress: address },
        { headers: auth.headers }
      );
      printResult(result as Record<string, unknown>);
    } catch (err: unknown) {
      printError(err instanceof Error ? err.message : 'Failed to invite viewer.');
    }
  });

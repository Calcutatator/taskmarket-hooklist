import { Command } from 'commander';
import { apiGet } from '../../lib/api.js';
import { signReadAuth } from '../../lib/read-auth.js';
import { printResult, printError } from '../../lib/output.js';

export const submissionsCmd = new Command('submissions')
  .description('List submissions for a task')
  .argument('<taskId>', 'Task ID (0x-prefixed hex)')
  .action(async (taskId: string) => {
    // Proves ownership of this wallet's address (Phase 2 read-auth, ADR-0016)
    // so a non-public submissionVisibility task's requester/submitting-worker
    // sees everything they're entitled to, instead of the anonymous view.
    // Non-fatal if there's no keystore/wallet yet -- falls back to whatever
    // the anonymous view already reveals, same as before this existed.
    const auth = await signReadAuth();

    let subs: unknown;
    try {
      subs = await apiGet(`/api/tasks/${taskId}/submissions`, { headers: auth?.headers ?? {} });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to fetch submissions.';
      printError(msg);
    }
    printResult(subs!);
  });

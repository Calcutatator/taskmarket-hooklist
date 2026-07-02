import { Command } from 'commander';
import { apiGet } from '../../lib/api.js';
import { x402Post } from '../../lib/x402.js';
import { printResult, printError } from '../../lib/output.js';

type PendingAction = {
  action: string;
  worker?: string;
};

type TaskDetail = {
  pendingActions?: PendingAction[];
};

export const rejectAllSubmissionsCmd = new Command('reject-all-submissions')
  .description(
    'Reject every active submission on a bounty or benchmark task in one go. ' +
      'Reads pending reject_submission actions from the task, rejects each worker ' +
      'in sequence, then cancels the task. Use this to recover escrow when all ' +
      'submitted work is unsuitable.'
  )
  .argument('<taskId>', 'Task ID (0x-prefixed hex)')
  .option('--no-cancel', 'Reject all submissions but do not cancel the task afterward')
  .action(async (taskId: string, opts: { cancel: boolean }) => {
    let task: TaskDetail;
    try {
      task = (await apiGet(`/api/tasks/${taskId}`)) as TaskDetail;
    } catch (err) {
      return printError(err instanceof Error ? err.message : String(err));
    }

    const rejectActions = (task.pendingActions ?? []).filter(
      (a) => a.action === 'reject_submission' && a.worker
    );

    if (rejectActions.length === 0) {
      printResult({ rejected: 0, message: 'no active submissions to reject' });
      return;
    }

    const results: Array<{ worker: string; txHash?: string; error?: string }> = [];

    for (const action of rejectActions) {
      const worker = action.worker as string;
      try {
        const res = (await x402Post(`/api/tasks/${taskId}/reject-submission`, {
          taskId,
          worker,
        })) as Record<string, unknown>;
        results.push({ worker, txHash: res.txHash as string | undefined });
      } catch (err) {
        results.push({ worker, error: err instanceof Error ? err.message : String(err) });
      }
    }

    const failed = results.filter((r) => r.error);
    if (failed.length > 0) {
      return printError(
        `${failed.length} of ${results.length} rejection(s) failed: ` +
          failed.map((r) => `${r.worker}: ${r.error}`).join('; ')
      );
    }

    if (!opts.cancel) {
      printResult({ rejected: results.length, results });
      return;
    }

    let cancelRes: Record<string, unknown>;
    try {
      cancelRes = (await x402Post(`/api/tasks/${taskId}/cancel`, { taskId })) as Record<
        string,
        unknown
      >;
    } catch (err) {
      return printError(
        `All ${results.length} submission(s) rejected but cancel failed: ${err instanceof Error ? err.message : String(err)}`
      );
    }

    printResult({ rejected: results.length, results, cancelTxHash: cancelRes.txHash });
  });

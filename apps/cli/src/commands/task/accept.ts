import { Command } from 'commander';
import { x402Post } from '../../lib/x402.js';
import { apiGet } from '../../lib/api.js';
import { printResult, printError } from '../../lib/output.js';

type TaskDetail = {
  pendingActions?: Array<{ action: string; role: string }>;
};

export const acceptCmd = new Command('accept')
  .description('Accept a submission (costs 0.001 USDC)')
  .argument('<taskId>', 'Task ID (0x-prefixed hex)')
  .requiredOption('--worker <addr>', 'Worker wallet address')
  .action(async (taskId: string, opts: { worker: string }) => {
    const task = (await apiGet(`/api/tasks/${taskId}`)) as TaskDetail | null;
    if (!task) {
      printError('Task not found');
      process.exit(1);
      return;
    }

    const canAccept = task.pendingActions?.some(
      (a) => a.action === 'accept' && a.role === 'requester'
    );
    if (!canAccept) {
      const hasRefund = task.pendingActions?.some(
        (a) => a.action === 'refund_expired' && a.role === 'requester'
      );
      const hasSelectWorker = task.pendingActions?.some(
        (a) => a.action === 'select_worker' && a.role === 'requester'
      );
      printError(
        hasRefund
          ? 'Task has expired with no submissions. Use taskmarket task refund-expired to recover escrow.'
          : hasSelectWorker
            ? 'Pitch window has closed. Use taskmarket task select-worker to pick from received pitches, or cancel the task.'
            : 'Accept is not available for this task in its current state.'
      );
      process.exit(1);
      return;
    }

    await x402Post(`/api/tasks/${taskId}/accept`, {
      taskId,
      worker: opts.worker,
    });
    printResult({ accepted: true });
  });

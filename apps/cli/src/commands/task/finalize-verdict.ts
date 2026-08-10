import { Command } from 'commander';
import { apiPost } from '../../lib/api.js';
import { printResult } from '../../lib/output.js';

export const finalizeVerdictCmd = new Command('finalize-verdict')
  .description('Finalize an evaluator verdict after the appeal window expires (permissionless)')
  .argument('<taskId>', 'Task ID (0x-prefixed hex)')
  .action(async (taskId: string) => {
    const { data: result, idempotencyKey } = await apiPost<{
      txHash: string;
    }>(`/api/tasks/${taskId}/finalize-verdict`, { taskId });
    printResult({ txHash: result.txHash }, { idempotencyKey });
  });

import { Command } from 'commander';
import { apiPost } from '../../lib/api.js';
import { printResult } from '../../lib/output.js';

export const finalizeVerdictCmd = new Command('finalize-verdict')
  .description('Finalize an evaluator verdict after the appeal window expires (permissionless)')
  .argument('<taskId>', 'Task ID (0x-prefixed hex)')
  .action(async (taskId: string) => {
    const result = (await apiPost(`/api/tasks/${taskId}/finalize-verdict`, { taskId })) as {
      txHash: string;
    };
    printResult({ txHash: result.txHash });
  });

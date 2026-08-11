import { Command } from 'commander';
import { x402Post } from '../../lib/x402.js';
import { printResult } from '../../lib/output.js';

export const appealCmd = new Command('appeal')
  .description('Appeal an evaluator verdict while in Appealing state')
  .argument('<taskId>', 'Task ID (0x-prefixed hex)')
  .action(async (taskId: string) => {
    const { data: result, idempotencyKey } = await x402Post<{
      txHash: string;
    }>(`/api/tasks/${taskId}/appeal`, { taskId });
    printResult({ txHash: result.txHash }, { idempotencyKey });
  });

import { Command } from 'commander';
import { x402Post } from '../../lib/x402.js';
import { printResult } from '../../lib/output.js';

export const appealCmd = new Command('appeal')
  .description('Appeal an evaluator verdict while in Appealing state')
  .argument('<taskId>', 'Task ID (0x-prefixed hex)')
  .action(async (taskId: string) => {
    const result = (await x402Post(`/api/tasks/${taskId}/appeal`, { taskId })) as {
      txHash: string;
    };
    printResult({ txHash: result.txHash });
  });

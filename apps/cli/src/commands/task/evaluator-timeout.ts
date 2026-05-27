import { Command } from 'commander';
import { x402Post } from '../../lib/x402.js';
import { printResult } from '../../lib/output.js';

export const evaluatorTimeoutCmd = new Command('evaluator-timeout')
  .description('Trigger evaluator timeout after the evaluation window expires (requester only)')
  .argument('<taskId>', 'Task ID (0x-prefixed hex)')
  .action(async (taskId: string) => {
    const result = (await x402Post(`/api/tasks/${taskId}/evaluator-timeout`, { taskId })) as {
      txHash: string;
    };
    printResult({ txHash: result.txHash });
  });

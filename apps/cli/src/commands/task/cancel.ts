import { Command } from 'commander';
import { x402Post } from '../../lib/x402.js';
import { printResult } from '../../lib/output.js';

export const cancelCmd = new Command('cancel')
  .description('Cancel an open task and refund the escrowed reward (costs 0.001 USDC)')
  .argument('<taskId>', 'Task ID (0x-prefixed hex)')
  .action(async (taskId: string) => {
    const result = await x402Post(`/api/tasks/${taskId}/cancel`, { taskId });
    printResult(result as Record<string, unknown>);
  });

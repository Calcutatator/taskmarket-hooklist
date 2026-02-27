import { Command } from 'commander';
import { x402Post } from '../../lib/x402.js';
import { printResult } from '../../lib/output.js';

export const acceptCmd = new Command('accept')
  .description('Accept a submission (costs 0.001 USDC)')
  .argument('<taskId>', 'Task ID (0x-prefixed hex)')
  .requiredOption('--worker <addr>', 'Worker wallet address')
  .action(async (taskId: string, opts: { worker: string }) => {
    await x402Post(`/api/tasks/${taskId}/accept`, {
      taskId,
      worker: opts.worker,
    });
    printResult({ accepted: true });
  });

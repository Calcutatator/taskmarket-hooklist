import { Command } from 'commander';
import { x402Post } from '../../lib/x402.js';
import { printResult } from '../../lib/output.js';

export const acceptCmd = new Command('accept')
  .description('Accept a submission (costs 0.001 USDC)')
  .argument('<taskId>', 'Task ID (0x-prefixed hex)')
  .requiredOption('--worker <addr>', 'Worker wallet address')
  .option(
    '--deliverable <hash>',
    'Deliverable hash to commit on-chain (32-byte hex). Backend will look it up from the submission if omitted.'
  )
  .action(async (taskId: string, opts: { worker: string; deliverable?: string }) => {
    if (opts.deliverable && !/^0x[0-9a-fA-F]{64}$/.test(opts.deliverable)) {
      throw new Error('--deliverable must be a 0x-prefixed 32-byte hex string (0x + 64 hex chars)');
    }
    await x402Post(`/api/tasks/${taskId}/accept`, {
      taskId,
      worker: opts.worker,
      ...(opts.deliverable ? { deliverable: opts.deliverable } : {}),
    });
    printResult({ accepted: true });
  });

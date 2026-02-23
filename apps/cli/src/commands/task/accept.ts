import { Command } from 'commander';
import { x402Post } from '../../lib/x402.js';
import { isHumanMode, printResult } from '../../lib/output.js';

export const acceptCmd = new Command('accept')
  .description('Accept a submission (costs 0.001 USDC)')
  .argument('<taskId>', 'Task ID (0x-prefixed hex)')
  .requiredOption('--worker <addr>', 'Worker wallet address')
  .option('--human', 'Human-readable output')
  .action(async (taskId: string, opts: { worker: string; human?: boolean }) => {
    const human = isHumanMode(opts.human);
    await x402Post(`/api/tasks/${taskId}/accept`, {
      taskId,
      worker: opts.worker,
    });
    if (human) {
      console.log('Accepted');
    } else {
      printResult({ accepted: true }, human);
    }
  });

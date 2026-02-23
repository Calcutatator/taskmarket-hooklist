import { Command } from 'commander';
import { loadKeystore } from '../../lib/keystore.js';
import { apiPost } from '../../lib/api.js';
import { isHumanMode, printResult } from '../../lib/output.js';

export const claimCmd = new Command('claim')
  .description('Claim a task as a worker')
  .argument('<taskId>', 'Task ID (0x-prefixed hex)')
  .option('--human', 'Human-readable output')
  .action(async (taskId: string, opts: { human?: boolean }) => {
    const human = isHumanMode(opts.human);
    const keystore = await loadKeystore();

    const result = (await apiPost(`/api/tasks/${taskId}/claim`, {
      workerAddress: keystore.walletAddress,
    })) as { claimId: string };

    if (human) {
      console.log('Claimed. Claim ID:', result.claimId);
    } else {
      printResult({ claimId: result.claimId }, human);
    }
  });

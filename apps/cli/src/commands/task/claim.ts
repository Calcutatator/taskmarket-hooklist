import { Command } from 'commander';
import { loadKeystore } from '../../lib/keystore.js';
import { apiPost } from '../../lib/api.js';

export const claimCmd = new Command('claim')
  .description('Claim a task as a worker')
  .argument('<taskId>', 'Task ID (0x-prefixed hex)')
  .action(async (taskId: string) => {
    const keystore = await loadKeystore();

    const result = (await apiPost(`/api/tasks/${taskId}/claim`, {
      workerAddress: keystore.walletAddress,
    })) as { claimId: string };

    console.log('Claimed. Claim ID:', result.claimId);
  });

import { Command } from 'commander';
import { buildClaimMessage } from '@taskmarket/shared';
import { loadKeystore } from '../../lib/keystore.js';
import { signMessage } from '../../lib/signer.js';
import { apiPost } from '../../lib/api.js';
import { printResult } from '../../lib/output.js';

export const claimCmd = new Command('claim')
  .description('Claim a task as a worker')
  .argument('<taskId>', 'Task ID (0x-prefixed hex)')
  .action(async (taskId: string) => {
    const keystore = await loadKeystore();
    const message = buildClaimMessage(taskId);
    const signature = await signMessage(message, keystore);

    const result = (await apiPost(`/api/tasks/${taskId}/claim`, {
      workerAddress: keystore.walletAddress,
      signature,
    })) as { claimId: string };

    printResult({ claimId: result.claimId });
  });

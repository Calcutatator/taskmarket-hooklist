import { Command } from 'commander';
import { loadKeystore } from '../../lib/keystore.js';
import { signMessage } from '../../lib/signer.js';
import { apiPost } from '../../lib/api.js';
import { printResult, printError } from '../../lib/output.js';

export const forfeitCmd = new Command('forfeit')
  .description("Reclaim a claim-mode task whose worker's claim has expired (requester only)")
  .argument('<taskId>', 'Task ID (0x-prefixed hex)')
  .action(async (taskId: string) => {
    try {
      const keystore = await loadKeystore();
      const message = `taskmarket:forfeit:${taskId}`;
      const signature = await signMessage(message, keystore);

      const result = (await apiPost(`/api/tasks/${taskId}/forfeit`, {
        taskId,
        requesterAddress: keystore.walletAddress,
        signature,
      })) as { txHash: string };

      printResult(result);
    } catch (err) {
      printError(err instanceof Error ? err.message : String(err));
    }
  });

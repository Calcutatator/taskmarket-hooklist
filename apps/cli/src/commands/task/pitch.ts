import { Command } from 'commander';
import { loadKeystore } from '../../lib/keystore.js';
import { signMessage } from '../../lib/signer.js';
import { x402Post } from '../../lib/x402.js';
import { printResult } from '../../lib/output.js';

export const pitchCmd = new Command('pitch')
  .description('Submit a pitch for a task (costs 0.001 USDC, anchors hash on-chain)')
  .argument('<taskId>', 'Task ID (0x-prefixed hex)')
  .requiredOption('--text <text>', 'Pitch text')
  .option('--duration <hours>', 'Estimated duration in hours')
  .action(async (taskId: string, opts: { text: string; duration?: string }) => {
    const keystore = await loadKeystore();
    // Signature is preserved in the body for backward shape compat but is no
    // longer the auth mechanism — the X402 payer must equal workerAddress.
    const signature = await signMessage(`taskmarket:pitch:${taskId}`, keystore);

    const { data: result, idempotencyKey } = await x402Post<{ pitchId: string }>(
      `/api/tasks/${taskId}/pitches`,
      {
        taskId,
        workerAddress: keystore.walletAddress,
        pitchText: opts.text,
        ...(opts.duration ? { estimatedDuration: parseInt(opts.duration, 10) } : {}),
        signature,
      }
    );

    printResult({ pitchId: result.pitchId }, { idempotencyKey });
  });

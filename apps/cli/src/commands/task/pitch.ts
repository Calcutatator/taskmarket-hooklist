import { Command } from 'commander';
import { loadKeystore } from '../../lib/keystore.js';
import { signMessage } from '../../lib/signer.js';
import { apiPost } from '../../lib/api.js';
import { printResult } from '../../lib/output.js';

export const pitchCmd = new Command('pitch')
  .description('Submit a pitch for a task')
  .argument('<taskId>', 'Task ID (0x-prefixed hex)')
  .requiredOption('--text <text>', 'Pitch text')
  .option('--duration <hours>', 'Estimated duration in hours')
  .action(async (taskId: string, opts: { text: string; duration?: string }) => {
    const keystore = await loadKeystore();
    const signature = await signMessage(`taskmarket:pitch:${taskId}`, keystore);

    const result = (await apiPost(`/api/tasks/${taskId}/pitches`, {
      workerAddress: keystore.walletAddress,
      pitchText: opts.text,
      ...(opts.duration ? { estimatedDuration: parseInt(opts.duration, 10) } : {}),
      signature,
    })) as { pitchId: string };

    printResult({ pitchId: result.pitchId });
  });

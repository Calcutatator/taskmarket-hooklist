import { Command } from 'commander';
import { keccak256, toBytes } from 'viem';
import { loadKeystore } from '../../lib/keystore.js';
import { signMessage } from '../../lib/signer.js';
import { apiPost } from '../../lib/api.js';
import { isHumanMode, printResult } from '../../lib/output.js';

export const pitchCmd = new Command('pitch')
  .description('Submit a pitch for a task')
  .argument('<taskId>', 'Task ID (0x-prefixed hex)')
  .requiredOption('--text <text>', 'Pitch text')
  .option('--duration <hours>', 'Estimated duration in hours')
  .option('--human', 'Human-readable output')
  .action(async (taskId: string, opts: { text: string; duration?: string; human?: boolean }) => {
    const human = isHumanMode(opts.human);
    const keystore = await loadKeystore();
    const pitchHash = keccak256(toBytes(opts.text));
    const signature = await signMessage(pitchHash, keystore);

    const result = (await apiPost(`/api/tasks/${taskId}/pitches`, {
      workerAddress: keystore.walletAddress,
      pitchText: opts.text,
      ...(opts.duration ? { estimatedDuration: parseInt(opts.duration, 10) } : {}),
      signature,
    })) as { pitchId: string };

    if (human) {
      console.log('Pitch submitted:', result.pitchId);
    } else {
      printResult({ pitchId: result.pitchId }, human);
    }
  });

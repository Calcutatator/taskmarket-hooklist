import { Command } from 'commander';
import { keccak256, toBytes } from 'viem';
import { loadKeystore } from '../../lib/keystore.js';
import { signMessage } from '../../lib/signer.js';
import { apiPost } from '../../lib/api.js';
import { isHumanMode, printResult } from '../../lib/output.js';

export const selectWorkerCmd = new Command('select-worker')
  .description('Select a worker from pitches (requester only)')
  .argument('<taskId>', 'Task ID (0x-prefixed hex)')
  .requiredOption('--pitch <pitchId>', 'Pitch ID to select')
  .requiredOption('--worker <address>', 'Worker wallet address to assign')
  .option('--human', 'Human-readable output')
  .action(async (taskId: string, opts: { pitch: string; worker: string; human?: boolean }) => {
    const human = isHumanMode(opts.human);
    const keystore = await loadKeystore();
    const hash = keccak256(toBytes(taskId + opts.pitch + opts.worker));
    const signature = await signMessage(hash, keystore);

    await apiPost(`/api/tasks/${taskId}/pitches/select`, {
      taskId,
      pitchId: opts.pitch,
      workerAddress: opts.worker,
      signature,
    });

    if (human) {
      console.log('Worker selected');
    } else {
      printResult({ selected: true }, human);
    }
  });

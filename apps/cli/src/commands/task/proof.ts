import { Command } from 'commander';
import { keccak256, toBytes } from 'viem';
import { loadKeystore } from '../../lib/keystore.js';
import { signMessage } from '../../lib/signer.js';
import { apiPost } from '../../lib/api.js';
import { printResult } from '../../lib/output.js';

export const proofCmd = new Command('proof')
  .description('Submit a proof for a task')
  .argument('<taskId>', 'Task ID (0x-prefixed hex)')
  .requiredOption('--data <data>', 'Proof data')
  .requiredOption('--type <type>', 'Proof type')
  .option('--metric <val>', 'Metric value')
  .action(async (taskId: string, opts: { data: string; type: string; metric?: string }) => {
    const keystore = await loadKeystore();
    const proofHash = keccak256(toBytes(opts.data));
    const signature = await signMessage(proofHash, keystore);

    const result = (await apiPost(`/api/tasks/${taskId}/proofs`, {
      workerAddress: keystore.walletAddress,
      proofData: opts.data,
      proofType: opts.type,
      ...(opts.metric ? { metricValue: opts.metric } : {}),
      signature,
    })) as { proofId: string };

    printResult({ proofId: result.proofId });
  });

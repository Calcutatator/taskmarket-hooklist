import { Command } from 'commander';
import { loadKeystore } from '../../lib/keystore.js';
import { signMessage } from '../../lib/signer.js';
import { x402Post } from '../../lib/x402.js';
import { printResult } from '../../lib/output.js';

export const proofCmd = new Command('proof')
  .description('Submit a benchmark proof (costs 0.001 USDC, anchors hash on-chain)')
  .argument('<taskId>', 'Task ID (0x-prefixed hex)')
  .requiredOption('--data <data>', 'Proof data')
  .requiredOption('--type <type>', 'Proof type')
  .option('--metric <val>', 'Metric value')
  .action(async (taskId: string, opts: { data: string; type: string; metric?: string }) => {
    const keystore = await loadKeystore();
    // Signature preserved for shape compat; X402 payer == workerAddress is the auth.
    const signature = await signMessage(`taskmarket:proof:${taskId}`, keystore);

    const { data: result, idempotencyKey } = await x402Post<{
      proofId: string;
      submissionId: string;
    }>(`/api/tasks/${taskId}/proofs`, {
      taskId,
      workerAddress: keystore.walletAddress,
      proofData: opts.data,
      proofType: opts.type,
      ...(opts.metric ? { metricValue: opts.metric } : {}),
      signature,
    });

    printResult({ proofId: result.proofId, submissionId: result.submissionId }, { idempotencyKey });
  });

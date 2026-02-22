import { Command } from 'commander';
import { keccak256, toBytes } from 'viem';
import { loadKeystore } from '../../lib/keystore.js';
import { signMessage } from '../../lib/signer.js';
import { apiPost } from '../../lib/api.js';

export const proposeCmd = new Command('propose')
  .description('Submit a proposal for a task')
  .argument('<taskId>', 'Task ID (0x-prefixed hex)')
  .requiredOption('--text <text>', 'Proposal text')
  .option('--duration <hours>', 'Estimated duration in hours')
  .action(async (taskId: string, opts: { text: string; duration?: string }) => {
    const keystore = await loadKeystore();
    const proposalHash = keccak256(toBytes(opts.text));
    const signature = await signMessage(proposalHash, keystore);

    const result = (await apiPost(`/api/tasks/${taskId}/proposals`, {
      workerAddress: keystore.walletAddress,
      proposalText: opts.text,
      ...(opts.duration ? { estimatedDuration: parseInt(opts.duration, 10) } : {}),
      signature,
    })) as { proposalId: string };

    console.log('Proposal submitted:', result.proposalId);
  });

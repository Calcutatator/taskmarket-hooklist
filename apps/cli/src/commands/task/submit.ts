import { Command } from 'commander';
import { promises as fs } from 'fs';
import { keccak256, toBytes } from 'viem';
import { loadKeystore } from '../../lib/keystore.js';
import { signMessage } from '../../lib/signer.js';
import { apiPost } from '../../lib/api.js';
import { isHumanMode, printResult } from '../../lib/output.js';

export const submitCmd = new Command('submit')
  .description('Submit work for a task')
  .argument('<taskId>', 'Task ID (0x-prefixed hex)')
  .requiredOption('--file <path>', 'Path to the submission file')
  .option('--human', 'Human-readable output')
  .action(async (taskId: string, opts: { file: string; human?: boolean }) => {
    const human = isHumanMode(opts.human);
    const fileContent = await fs.readFile(opts.file);
    const fileBase64 = fileContent.toString('base64');
    const fileHash = keccak256(toBytes(fileContent.toString('utf8')));

    const keystore = await loadKeystore();
    const signature = await signMessage(fileHash, keystore);

    const result = (await apiPost(`/api/tasks/${taskId}/submissions`, {
      workerAddress: keystore.walletAddress,
      file: fileBase64,
      signature,
    })) as { submissionId: string };

    if (human) {
      console.log('Submitted:', result.submissionId);
    } else {
      printResult({ submissionId: result.submissionId }, human);
    }
  });

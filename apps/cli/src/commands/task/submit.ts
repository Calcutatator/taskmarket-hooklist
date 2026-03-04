import { Command } from 'commander';
import { promises as fs } from 'fs';
import { loadKeystore } from '../../lib/keystore.js';
import { signMessage } from '../../lib/signer.js';
import { apiPost } from '../../lib/api.js';
import { printResult } from '../../lib/output.js';

export const submitCmd = new Command('submit')
  .description('Submit work for a task')
  .argument('<taskId>', 'Task ID (0x-prefixed hex)')
  .requiredOption('--file <path>', 'Path to the submission file')
  .action(async (taskId: string, opts: { file: string }) => {
    const fileContent = await fs.readFile(opts.file);
    const fileBase64 = fileContent.toString('base64');

    const keystore = await loadKeystore();
    const signature = await signMessage(`taskmarket:submit:${taskId}`, keystore);

    const result = (await apiPost(`/api/tasks/${taskId}/submissions`, {
      workerAddress: keystore.walletAddress,
      file: fileBase64,
      signature,
    })) as { submissionId: string };

    printResult({ submissionId: result.submissionId });
  });

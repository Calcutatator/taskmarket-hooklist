import { Command } from 'commander';
import { promises as fs } from 'fs';
import { basename, extname } from 'path';
import { loadKeystore } from '../../lib/keystore.js';
import { signMessage } from '../../lib/signer.js';
import { apiPost } from '../../lib/api.js';
import { printError, printResult } from '../../lib/output.js';

function collectFile(value: string, previous: string[]): string[] {
  return [...previous, value];
}

function mimeTypeForPath(filePath: string): string {
  switch (extname(filePath).toLowerCase()) {
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.webp':
      return 'image/webp';
    case '.gif':
      return 'image/gif';
    case '.svg':
      return 'image/svg+xml';
    case '.pdf':
      return 'application/pdf';
    case '.mp4':
      return 'video/mp4';
    case '.webm':
      return 'video/webm';
    case '.mp3':
      return 'audio/mpeg';
    case '.wav':
      return 'audio/wav';
    case '.md':
      return 'text/markdown';
    case '.txt':
      return 'text/plain';
    case '.json':
      return 'application/json';
    case '.zip':
      return 'application/zip';
    default:
      return 'application/octet-stream';
  }
}

export const submitCmd = new Command('submit')
  .description('Submit work for a task')
  .argument('<taskId>', 'Task ID (0x-prefixed hex)')
  .option('--file <path>', 'Path to a submission file (repeatable)', collectFile, [])
  .action(async (taskId: string, opts: { file: string[] }) => {
    try {
      if (!opts.file || opts.file.length === 0) {
        printError('--file is required');
      }

      const keystore = await loadKeystore();
      const signature = await signMessage(`taskmarket:submit:${taskId}`, keystore);

      const body: Record<string, unknown> = {
        workerAddress: keystore.walletAddress,
        signature,
        artifacts: await Promise.all(
          opts.file.map(async (filePath) => {
            const fileContent = await fs.readFile(filePath);
            return {
              fileName: basename(filePath),
              mimeType: mimeTypeForPath(filePath),
              role: 'attachment',
              file: fileContent.toString('base64'),
            };
          })
        ),
      };

      const result = (await apiPost(`/api/tasks/${taskId}/submissions`, {
        ...body,
      })) as { submissionId: string };

      printResult({ submissionId: result.submissionId });
    } finally {
      submitCmd.setOptionValue('file', []);
    }
  });

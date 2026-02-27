import { Command } from 'commander';
import { loadKeystore } from '../../lib/keystore.js';
import { apiPost } from '../../lib/api.js';
import { printError } from '../../lib/output.js';
import { writeFileSync } from 'fs';

export const downloadCmd = new Command('download')
  .description('Download a submission file (requester or worker)')
  .argument('<taskId>', 'Task ID (0x-prefixed hex)')
  .requiredOption('--submission <id>', 'Submission ID (from `task submissions`)')
  .option('--output <path>', 'Save to file instead of printing to stdout')
  .action(async (taskId: string, opts: { submission: string; output?: string }) => {
    const keystore = await loadKeystore();

    let presignedUrl: string;
    try {
      const result = (await apiPost(`/api/tasks/${taskId}/submissions/${opts.submission}/preview`, {
        taskId,
        submissionId: opts.submission,
        deviceId: keystore.deviceId,
        apiToken: keystore.apiToken,
      })) as { presignedUrl: string };
      presignedUrl = result.presignedUrl;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to get download URL.';
      printError(msg);
    }

    const res = await fetch(presignedUrl!);
    if (!res.ok) {
      printError(`Failed to download file: ${res.status}`);
    }
    const content = await res.text();

    if (opts.output) {
      writeFileSync(opts.output, content, 'utf8');
      process.stdout.write(JSON.stringify({ ok: true, data: { savedTo: opts.output } }) + '\n');
    } else {
      process.stdout.write(content);
    }
  });

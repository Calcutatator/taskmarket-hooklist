import { Command } from 'commander';
import { loadKeystore } from '../../lib/keystore.js';
import { apiPost } from '../../lib/api.js';
import { printError, renderFailure } from '../../lib/output.js';
import { writeFileSync } from 'fs';

// Strips bytes that a terminal would interpret as control sequences before writing
// downloaded text to stdout. ESC (0x1B) starts every ANSI/VT100 CSI and OSC sequence
// (including OSC 52 clipboard-write sequences), so removing it neutralizes any
// embedded escape sequence without needing to parse or allow-list specific ones.
// \n and \t are preserved; other C0 control bytes and DEL (0x7F) are also stripped.
function sanitizeForTerminal(text: string): string {
  // eslint-disable-next-line no-control-regex -- stripping control bytes is the point
  return text.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '');
}

export const downloadCmd = new Command('download')
  .description('Download a submission file (requester or worker)')
  .argument('<taskId>', 'Task ID (0x-prefixed hex)')
  .requiredOption('--submission <id>', 'Submission ID (from `task submissions`)')
  .option('--artifact <id>', 'Artifact ID for multi-artifact submissions')
  .option('--output <path>', 'Save to file instead of printing to stdout')
  .action(
    async (taskId: string, opts: { submission: string; artifact?: string; output?: string }) => {
      const keystore = await loadKeystore();

      let presignedUrl: string;
      try {
        const body: Record<string, unknown> = {
          taskId,
          submissionId: opts.submission,
          deviceId: keystore.deviceId,
          apiToken: keystore.apiToken,
        };
        if (opts.artifact) {
          body.artifactId = opts.artifact;
        }
        const result = (await apiPost(
          `/api/tasks/${taskId}/submissions/${opts.submission}/preview`,
          body
        )) as { presignedUrl: string };
        presignedUrl = result.presignedUrl;
      } catch (err: unknown) {
        renderFailure(err, { fallback: 'Failed to get download URL.' });
      }

      const res = await fetch(presignedUrl!);
      if (!res.ok) {
        printError(`Failed to download file: ${res.status}`);
      }
      const content = Buffer.from(await res.arrayBuffer());

      if (opts.output) {
        writeFileSync(opts.output, content);
        process.stdout.write(JSON.stringify({ ok: true, data: { savedTo: opts.output } }) + '\n');
      } else {
        let decoded: string;
        try {
          decoded = new TextDecoder('utf-8', { fatal: true }).decode(content);
        } catch {
          printError(
            'Downloaded content is not valid UTF-8 text and cannot be safely printed to the terminal. Use --output <path> to save it to a file instead.'
          );
        }
        process.stdout.write(sanitizeForTerminal(decoded!));
      }
    }
  );

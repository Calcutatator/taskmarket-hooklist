import { Command, Option } from 'commander';
import { promises as fsPromises } from 'fs';
import { basename, extname } from 'path';
import { createHash } from 'crypto';
import { Readable } from 'stream';
import https from 'https';
import http from 'http';
import { keccak256 } from 'viem';
import { buildSubmitMessage } from '@taskmarket/shared';
import { loadKeystore } from '../../lib/keystore.js';
import { signMessage } from '../../lib/signer.js';
import { apiPost } from '../../lib/api.js';
import { x402Post } from '../../lib/x402.js';
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

function streamingPut(
  uploadUrl: string,
  data: Buffer,
  mimeType: string,
  label: string
): Promise<void> {
  return new Promise((resolve, reject) => {
    const url = new URL(uploadUrl);
    const transport = url.protocol === 'https:' ? https : http;
    const req = transport.request(
      url,
      {
        method: 'PUT',
        headers: {
          'Content-Type': mimeType,
          'Content-Length': String(data.length),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            process.stderr.write('\n');
            resolve();
          } else {
            const body = Buffer.concat(chunks).toString('utf8').slice(0, 500);
            reject(
              new Error(
                `Upload failed (${res.statusCode ?? 'unknown'}): ${body || 'no response body'}`
              )
            );
          }
        });
      }
    );

    req.on('error', reject);

    let uploaded = 0;
    const stream = Readable.from([data]);
    stream.on('data', (chunk: Buffer) => {
      uploaded += chunk.length;
      const pct = Math.round((uploaded / data.length) * 100);
      process.stderr.write(`\r  ${label}: ${pct}%`);
    });
    stream.on('error', reject);
    stream.pipe(req);
  });
}

export const submitCmd = new Command('submit')
  .description('Submit work for a task')
  .argument('<taskId>', 'Task ID (0x-prefixed hex)')
  .option('--file <path>', 'Path to a submission file (repeatable)', collectFile, [])
  .addOption(
    new Option('--role <role>', 'Artifact role applied to all files')
      .choices(['preview', 'source', 'final', 'attachment'])
      .default('attachment')
  )
  .action(async (taskId: string, opts: { file: string[]; role: string }) => {
    try {
      if (!opts.file || opts.file.length === 0) {
        printError('--file is required');
        return;
      }

      const keystore = await loadKeystore();
      const signature = await signMessage(buildSubmitMessage(taskId), keystore);

      // Each file uploads concurrently and each upload is its own write. Nothing has to be done
      // to keep their keys apart: a failure carries the key of the upload that raised it, so the
      // concurrency here is invisible to the reporting.
      const artifactInputs = await Promise.all(
        opts.file.map(async (filePath) => {
          const mimeType = mimeTypeForPath(filePath);

          // Read file once — used for hashing and as the upload source
          const data = await fsPromises.readFile(filePath);

          if (data.length === 0) {
            throw new Error(`File is empty: ${basename(filePath)}`);
          }

          const {
            data: { uploadUrl, artifactKey },
          } = await apiPost<{ uploadUrl: string; artifactKey: string }>(
            `/api/tasks/${taskId}/submissions/request-upload-url`,
            {
              taskId,
              workerAddress: keystore.walletAddress,
              signature,
              fileName: basename(filePath),
              mimeType,
              role: opts.role,
              sizeBytes: data.length,
            }
          );

          const sha256Hash = createHash('sha256').update(data).digest('hex');
          const keccak256Hash = keccak256(new Uint8Array(data)) as string;

          process.stderr.write(`  Uploading ${basename(filePath)}...\n`);
          await streamingPut(uploadUrl, data, mimeType, basename(filePath));

          return {
            artifactKey,
            fileName: basename(filePath),
            mimeType,
            role: opts.role,
            sizeBytes: data.length,
            sha256Hash,
            keccak256Hash,
          };
        })
      );

      // Sign a second, content-bound message now that every artifactKey is known --
      // the earlier `signature` (unbound to any key) only ever authorized the
      // per-file upload-URL requests above, not the final submission (issue #323: a
      // signature not bound to its content can be replayed with different keys).
      const submitSignature = await signMessage(
        buildSubmitMessage(
          taskId,
          artifactInputs.map((artifact) => artifact.artifactKey)
        ),
        keystore
      );

      // /submissions/from-keys is gated by submissionAllowanceGate (RFC-0006) -- once the
      // free allowance is exhausted it responds 402, not a plain success/error. x402Post
      // handles both cases transparently: it returns the JSON body directly when the first
      // round already succeeds (still within the free allowance), and only runs the
      // sign-and-pay handshake when actually challenged with a 402.
      // The submission itself is the write this command reports, so its key is the one the
      // envelope carries -- not any of the per-file uploads that got it here.
      const { data: result, idempotencyKey } = await x402Post<{ submissionId: string }>(
        `/api/tasks/${taskId}/submissions/from-keys`,
        {
          taskId,
          workerAddress: keystore.walletAddress,
          artifacts: artifactInputs,
          signature: submitSignature,
        }
      );

      printResult({ submissionId: result.submissionId }, { idempotencyKey });
    } finally {
      submitCmd.setOptionValue('file', []);
    }
  });

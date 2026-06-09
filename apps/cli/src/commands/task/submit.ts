import { Command } from 'commander';
import { createReadStream, statSync, readFileSync } from 'fs';
import { basename, extname } from 'path';
import { createHash } from 'crypto';
import https from 'https';
import http from 'http';
import { keccak256 } from 'viem';
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

function streamingPut(uploadUrl: string, filePath: string, mimeType: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const stat = statSync(filePath);
    const url = new URL(uploadUrl);
    const transport = url.protocol === 'https:' ? https : http;
    const req = transport.request(
      url,
      {
        method: 'PUT',
        headers: {
          'Content-Type': mimeType,
          'Content-Length': String(stat.size),
        },
      },
      (res) => {
        res.resume();
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            process.stderr.write('\n');
            resolve();
          } else {
            reject(new Error(`Upload failed with status ${res.statusCode ?? 'unknown'}`));
          }
        });
      }
    );

    req.on('error', reject);

    let uploaded = 0;
    const name = basename(filePath);
    const stream = createReadStream(filePath);
    stream.on('data', (chunk: Buffer | string) => {
      uploaded += typeof chunk === 'string' ? Buffer.byteLength(chunk) : chunk.length;
      const pct = Math.round((uploaded / stat.size) * 100);
      process.stderr.write(`\r  ${name}: ${pct}%`);
    });
    stream.on('error', reject);
    stream.pipe(req);
  });
}

function computeFileHashes(filePath: string): { sha256Hash: string; keccak256Hash: string } {
  const data = readFileSync(filePath);
  const sha256Hash = createHash('sha256').update(data).digest('hex');
  const keccak256Hash = keccak256(new Uint8Array(data)) as string;
  return { sha256Hash, keccak256Hash };
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

      const artifactInputs = await Promise.all(
        opts.file.map(async (filePath) => {
          const mimeType = mimeTypeForPath(filePath);
          const stat = statSync(filePath);

          if (stat.size === 0) {
            printError(`File is empty: ${basename(filePath)}`);
          }

          // Request presigned upload URL
          const { uploadUrl, artifactKey } = (await apiPost(
            `/api/tasks/${taskId}/submissions/request-upload-url`,
            {
              taskId,
              workerAddress: keystore.walletAddress,
              signature,
              fileName: basename(filePath),
              mimeType,
              role: 'attachment',
              sizeBytes: stat.size,
            }
          )) as { uploadUrl: string; artifactKey: string };

          // Hash the file before uploading
          const { sha256Hash, keccak256Hash } = computeFileHashes(filePath);

          // Stream upload with progress on stderr
          process.stderr.write(`  Uploading ${basename(filePath)}...\n`);
          await streamingPut(uploadUrl, filePath, mimeType);

          return {
            artifactKey,
            fileName: basename(filePath),
            mimeType,
            role: 'attachment',
            sizeBytes: stat.size,
            sha256Hash,
            keccak256Hash,
          };
        })
      );

      const result = (await apiPost(`/api/tasks/${taskId}/submissions/from-keys`, {
        taskId,
        workerAddress: keystore.walletAddress,
        artifacts: artifactInputs,
        signature,
      })) as { submissionId: string };

      printResult({ submissionId: result.submissionId });
    } finally {
      submitCmd.setOptionValue('file', []);
    }
  });

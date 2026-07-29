/**
 * Submission hash smoke test: verifies deliverableHash and submitTxHash are populated
 * on submissions (migration 0012).
 *
 * Flow:
 *   1. Create claim task (X402)
 *   2. Worker claims
 *   3. Worker submits a known file payload
 *   4. GET /api/tasks/{taskId}/submissions
 *   5. Assert deliverableHash is a non-null 0x-prefixed hex string (keccak256 of file bytes)
 *   6. Assert submitTxHash is non-null (on-chain tx hash)
 *   7. Assert deliverableHash matches expected keccak256 of the submitted content
 *   8. Assert the legacy file also returns artifact metadata
 *
 * Usage:
 *   REQUESTER_PRIVATE_KEY=0x... WORKER_PRIVATE_KEY=0x... \
 *     npx tsx --env-file=../../.env src/scripts/smoke-submission-hash.ts
 */
import { createHash } from 'crypto';
import { keccak256 } from 'viem';
import { buildSubmitMessage } from '@taskmarket/shared';
import { log, ok, get, post, x402Post, getAccounts, API_URL, sleep } from './_x402';
import { buildArtifactManifestHash } from '../lib/canonical-hashes';

async function main() {
  const { requester, worker } = getAccounts();

  console.log('=== Taskmarket Smoke Test — Submission Hash ===');
  console.log('requester:', requester.address);
  console.log('worker:   ', worker.address);
  console.log('api:      ', API_URL);

  // 1. Create claim task
  log('1/5', 'Creating claim task (X402)...');
  const { taskId } = (await x402Post(
    '/api/tasks',
    {
      description: 'Submission hash smoke test task',
      reward: '1000',
      duration: 1,
      mode: 'claim',
      tags: ['smoke-submission-hash'],
    },
    requester
  )) as { taskId: string };
  ok('taskId', taskId);

  // 2. Worker claims the task
  log('2/5', 'Worker claiming task...');
  const claimSig = await worker.signMessage({ message: `taskmarket:claim:${taskId}` });
  await post(`/api/tasks/${taskId}/claim`, {
    taskId,
    workerAddress: worker.address,
    signature: claimSig,
  });
  ok('claimed', true);

  // 3. Worker submits a known file payload
  const filePayload = 'submission-hash-smoke-test-content-12345';
  const fileBytes = Buffer.from(filePayload);
  const fileBase64 = fileBytes.toString('base64');
  const expectedHash = keccak256(new Uint8Array(fileBytes)) as string;

  log('3/5', `Worker submitting work (expected hash: ${expectedHash.slice(0, 18)}...)...`);
  const contentHash = createHash('sha256').update(fileBytes).digest('hex');
  const submitSig = await worker.signMessage({
    message: buildSubmitMessage(taskId, [contentHash]),
  });
  const { submissionId } = (await post(`/api/tasks/${taskId}/submissions`, {
    taskId,
    workerAddress: worker.address,
    signature: submitSig,
    artifacts: [
      {
        fileName: 'submission-hash-smoke.txt',
        mimeType: 'text/plain',
        role: 'attachment',
        file: fileBase64,
      },
    ],
  })) as { submissionId: string };
  ok('submissionId', submissionId);

  // 4. Fetch submissions list
  log('4/5', 'Fetching submissions list...');
  const submissionsList = (await get(`/api/tasks/${taskId}/submissions`)) as Array<{
    id: string;
    deliverableHash: string | null;
    submitTxHash: string | null;
    artifacts?: Array<{
      role: 'preview' | 'source' | 'final' | 'attachment';
      fileName: string;
      mimeType: string;
      mediaKind: 'image' | 'video' | 'audio' | 'pdf' | 'text' | 'archive' | 'unknown';
      storageUri: string;
      sizeBytes: number;
      sha256Hash: string;
      keccak256Hash: `0x${string}`;
      displayOrder: number;
    }>;
  }>;

  if (submissionsList.length === 0) {
    throw new Error('Expected at least one submission in list');
  }

  const submission = submissionsList.find((s) => s.id === submissionId);
  if (!submission) {
    throw new Error(`Submission ${submissionId} not found in list`);
  }

  // 5. Assert deliverableHash
  log('5/5', 'Asserting deliverableHash and submitTxHash...');
  if (!submission.deliverableHash) {
    throw new Error(`Expected deliverableHash to be set, got: ${submission.deliverableHash}`);
  }
  if (!submission.deliverableHash.startsWith('0x')) {
    throw new Error(
      `Expected deliverableHash to be 0x-prefixed, got: ${submission.deliverableHash}`
    );
  }
  // deliverableHash is a manifest hash over every artifact's metadata (canonical-hashes.ts's
  // buildArtifactManifestHash), not a bare content hash -- recompute it from the artifact rows
  // the API actually returned rather than comparing against keccak256 of the raw file alone.
  if (!submission.artifacts || submission.artifacts.length === 0) {
    throw new Error(
      'Expected submission to include artifact metadata to recompute the manifest hash'
    );
  }
  const expectedManifestHash = buildArtifactManifestHash(submission.artifacts);
  if (submission.deliverableHash.toLowerCase() !== expectedManifestHash.toLowerCase()) {
    throw new Error(
      `deliverableHash mismatch: got ${submission.deliverableHash}, expected ${expectedManifestHash}`
    );
  }
  ok('deliverableHash matches artifact manifest hash', submission.deliverableHash);

  const artifact = submission.artifacts?.[0];
  if (!artifact) {
    throw new Error('Expected submission to include one artifact');
  }
  if (artifact.fileName !== 'submission-hash-smoke.txt') {
    throw new Error(
      `Expected artifact fileName submission-hash-smoke.txt, got ${artifact.fileName}`
    );
  }
  if (artifact.mimeType !== 'text/plain' || artifact.mediaKind !== 'text') {
    throw new Error(
      `Expected text/plain text artifact, got ${artifact.mimeType} ${artifact.mediaKind}`
    );
  }
  if ('previewUrl' in artifact || 'presignedUrl' in artifact) {
    throw new Error('Artifact metadata response must not include preview/download URLs');
  }
  if (artifact.keccak256Hash.toLowerCase() !== expectedHash.toLowerCase()) {
    throw new Error(
      `artifact hash mismatch: got ${artifact.keccak256Hash}, expected ${expectedHash}`
    );
  }
  ok('artifact metadata', `${artifact.fileName} (${artifact.mediaKind})`);

  // 6. Assert submitTxHash (allow brief async delay for on-chain settlement)
  let txHash = submission.submitTxHash;
  if (!txHash) {
    console.log('  submitTxHash not yet populated, retrying after 5s...');
    await sleep(5000);
    const retried = (await get(`/api/tasks/${taskId}/submissions`)) as Array<{
      id: string;
      submitTxHash: string | null;
    }>;
    txHash = retried.find((s) => s.id === submissionId)?.submitTxHash ?? null;
  }
  if (!txHash) {
    throw new Error('submitTxHash is null even after retry — on-chain submission may have failed');
  }
  ok('submitTxHash', txHash);

  console.log('\n=== Submission hash smoke test passed ===');
  console.log('taskId:', taskId);
  console.log('submissionId:', submissionId);
}

main().catch((err) => {
  console.error('\nFatal:', err);
  process.exit(1);
});

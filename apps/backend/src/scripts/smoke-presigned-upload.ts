/**
 * Smoke test for presigned S3 PUT upload flow.
 *
 * Verifies: requestUploadUrl -> direct PUT -> submitFromKeys -> artifact metadata
 * -> preview URL download roundtrip.
 *
 * Works against local dev (LocalStorage) or production (S3/R2) — no special config needed
 * beyond the standard env vars.
 *
 * Usage:
 *   REQUESTER_PRIVATE_KEY=0x... WORKER_PRIVATE_KEY=0x... \
 *     npx tsx --env-file=../../.env src/scripts/smoke-presigned-upload.ts
 */
import { createHash } from 'crypto';
import { keccak256 } from 'viem';
import { log, ok, get, post, x402Post, getAccounts, API_URL } from './_x402';

const TEXT_BYTES = Buffer.from('presigned upload smoke test payload');
const PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
  'base64'
);

function sha256Hex(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

async function putDirect(uploadUrl: string, data: Buffer, mimeType: string): Promise<void> {
  const res = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': mimeType },
    body: data,
  });
  if (!res.ok) {
    throw new Error(`PUT to presigned URL failed: ${res.status} ${await res.text()}`);
  }
}

async function main() {
  const { requester, worker } = getAccounts();

  console.log('=== Smoke Test: Presigned S3 Upload ===');
  console.log('requester:', requester.address);
  console.log('worker:   ', worker.address);
  console.log('api:      ', API_URL);

  log('1/6', 'Creating bounty task (X402)...');
  const { taskId } = (await x402Post(
    '/api/tasks',
    {
      description: 'Presigned upload smoke test task',
      reward: '1000',
      duration: 1,
      mode: 'bounty',
      tags: ['smoke-presigned-upload'],
    },
    requester
  )) as { taskId: string };
  ok('taskId', taskId);

  const signature = await worker.signMessage({ message: `taskmarket:submit:${taskId}` });

  log('2/6', 'Requesting presigned PUT URLs for two artifacts...');
  const files = [
    { fileName: 'notes.txt', mimeType: 'text/plain', role: 'preview' as const, data: TEXT_BYTES },
    { fileName: 'logo.png', mimeType: 'image/png', role: 'final' as const, data: PNG_BYTES },
  ];

  const uploadResults: Array<{
    artifactKey: string;
    fileName: string;
    mimeType: string;
    role: string;
    sizeBytes: number;
    sha256Hash: string;
    keccak256Hash: string;
  }> = [];

  for (const file of files) {
    const { uploadUrl, artifactKey } = (await post(
      `/api/tasks/${taskId}/submissions/request-upload-url`,
      {
        taskId,
        workerAddress: worker.address,
        signature,
        fileName: file.fileName,
        mimeType: file.mimeType,
        role: file.role,
        sizeBytes: file.data.byteLength,
      }
    )) as { uploadUrl: string; artifactKey: string };

    ok(`presigned URL (${file.fileName})`, uploadUrl.slice(0, 60) + '...');

    if (!artifactKey.startsWith(`submissions/${taskId}/`)) {
      throw new Error(`artifactKey prefix wrong: ${artifactKey}`);
    }

    log('3/6', `Uploading ${file.fileName} directly to storage...`);
    await putDirect(uploadUrl, file.data, file.mimeType);
    ok(`uploaded`, file.fileName);

    uploadResults.push({
      artifactKey,
      fileName: file.fileName,
      mimeType: file.mimeType,
      role: file.role,
      sizeBytes: file.data.byteLength,
      sha256Hash: sha256Hex(file.data),
      keccak256Hash: keccak256(new Uint8Array(file.data)),
    });
  }

  log('4/6', 'Calling submitFromKeys with artifact metadata...');
  const { submissionId } = (await post(`/api/tasks/${taskId}/submissions/from-keys`, {
    taskId,
    workerAddress: worker.address,
    artifacts: uploadResults,
    signature,
  })) as { submissionId: string };
  ok('submissionId', submissionId);

  log('5/6', 'Verifying artifact metadata in submission listing...');
  const submissions = (await get(`/api/tasks/${taskId}/submissions`)) as Array<{
    id: string;
    deliverableHash: string | null;
    artifacts?: Array<{
      id: string;
      fileName: string;
      mimeType: string;
      role: string;
      sizeBytes: number;
      sha256Hash: string;
      keccak256Hash: string;
      storageUri: string;
    }>;
  }>;

  const submission = submissions.find((s) => s.id === submissionId);
  if (!submission) throw new Error(`Submission ${submissionId} not found`);

  const artifacts = submission.artifacts ?? [];
  if (artifacts.length !== 2) throw new Error(`Expected 2 artifacts, got ${artifacts.length}`);

  for (const artifact of artifacts) {
    const expected = uploadResults.find((u) => u.fileName === artifact.fileName);
    if (!expected) throw new Error(`Unexpected artifact: ${artifact.fileName}`);
    if (artifact.sizeBytes !== expected.sizeBytes)
      throw new Error(`sizeBytes mismatch for ${artifact.fileName}`);
    if (artifact.sha256Hash !== expected.sha256Hash)
      throw new Error(`sha256Hash mismatch for ${artifact.fileName}`);
    if (artifact.keccak256Hash.toLowerCase() !== expected.keccak256Hash.toLowerCase())
      throw new Error(`keccak256Hash mismatch for ${artifact.fileName}`);
    if (!artifact.storageUri) throw new Error(`storageUri missing for ${artifact.fileName}`);
    ok(`artifact metadata (${artifact.fileName})`, artifact.storageUri);
  }

  if (!submission.deliverableHash) throw new Error('deliverableHash missing');
  ok('deliverableHash', submission.deliverableHash);

  log('6/6', 'Fetching preview URL and downloading artifact content...');
  for (const artifact of artifacts) {
    const { previewUrl } = (await get(
      `/api/tasks/${taskId}/artifacts/${artifact.id}/preview?taskId=${taskId}&artifactId=${artifact.id}`
    )) as { previewUrl: string };

    const res = await fetch(previewUrl);
    if (!res.ok) throw new Error(`Preview download failed for ${artifact.fileName}: ${res.status}`);

    const downloaded = Buffer.from(await res.arrayBuffer());
    const expected = uploadResults.find((u) => u.fileName === artifact.fileName)!;

    if (downloaded.byteLength !== expected.sizeBytes) {
      throw new Error(
        `Downloaded size mismatch for ${artifact.fileName}: got ${downloaded.byteLength}, expected ${expected.sizeBytes}`
      );
    }
    if (sha256Hex(downloaded) !== expected.sha256Hash) {
      throw new Error(`Downloaded content hash mismatch for ${artifact.fileName}`);
    }
    ok(`download verified (${artifact.fileName})`, `${downloaded.byteLength} bytes`);
  }

  console.log('\n=== Presigned upload smoke test passed ===');
  console.log('taskId:      ', taskId);
  console.log('submissionId:', submissionId);
}

main().catch((err) => {
  console.error('\nFatal:', err);
  process.exit(1);
});

/**
 * Generic artifact smoke test: verifies multi-artifact submissions, manifest hashes,
 * metadata-only listings, and requester-authenticated preview URLs.
 *
 * Usage:
 *   REQUESTER_PRIVATE_KEY=0x... WORKER_PRIVATE_KEY=0x... \
 *     npx tsx --env-file=../../.env scripts/smoke-artifacts.ts
 */
import { createHash } from 'crypto';
import { keccak256, toBytes } from 'viem';
import { log, ok, get, post, x402Post, getAccounts, API_URL } from './_x402.ts';

type ArtifactListing = {
  id: string;
  workerAddress: string;
  workerAgentId: string | null;
  role: string;
  fileName: string;
  mimeType: string;
  mediaKind: string;
  sizeBytes: number;
  sha256Hash: string;
  keccak256Hash: string;
  displayOrder: number;
  storageUri: string;
};

type SubmissionListing = {
  id: string;
  deliverableHash: string | null;
  submitTxHash: string | null;
  artifacts?: ArtifactListing[];
};

function sha256Hex(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((key) => [key, sortKeys((value as Record<string, unknown>)[key])])
    );
  }
  return value;
}

function manifestHash(artifacts: ArtifactListing[]): string {
  const manifest = sortKeys({
    version: 'taskmarket-artifacts-v1',
    artifacts: artifacts
      .slice()
      .sort((a, b) => a.displayOrder - b.displayOrder)
      .map((artifact) => ({
        role: artifact.role,
        fileName: artifact.fileName,
        mimeType: artifact.mimeType,
        mediaKind: artifact.mediaKind,
        sizeBytes: artifact.sizeBytes,
        sha256Hash: artifact.sha256Hash,
        keccak256Hash: artifact.keccak256Hash,
        displayOrder: artifact.displayOrder,
      })),
  });
  return keccak256(toBytes(JSON.stringify(manifest)));
}

function assertNoPreviewUrls(payload: unknown): void {
  const serialized = JSON.stringify(payload);
  if (serialized.includes('previewUrl') || serialized.includes('presignedUrl')) {
    throw new Error('Submission listing must not include preview or presigned URLs');
  }
}

async function expectPreviewDenied(
  taskId: string,
  artifactId: string,
  viewerAddress: string,
  signature: string
): Promise<void> {
  const res = await fetch(`${API_URL}/api/tasks/${taskId}/artifacts/${artifactId}/preview`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ taskId, artifactId, viewerAddress, signature }),
  });
  if (res.ok) {
    throw new Error('Expected non-requester artifact preview to be rejected');
  }
  ok('non-requester preview rejected', res.status);
}

async function expectDevicePreviewDenied(
  taskId: string,
  submissionId: string,
  deviceId: string,
  apiToken: string
): Promise<void> {
  const res = await fetch(`${API_URL}/api/tasks/${taskId}/submissions/${submissionId}/preview`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ taskId, submissionId, deviceId, apiToken }),
  });
  if (res.ok) {
    throw new Error('Expected multi-artifact device preview without artifactId to be rejected');
  }
  ok('device preview without artifact rejected', res.status);
}

async function requestPreview(
  taskId: string,
  artifactId: string,
  viewerAddress: string,
  signature: string
): Promise<string> {
  const result = (await post(`/api/tasks/${taskId}/artifacts/${artifactId}/preview`, {
    taskId,
    artifactId,
    viewerAddress,
    signature,
  })) as { previewUrl: string; expiresAt: string };

  if (!result.previewUrl || !result.expiresAt) {
    throw new Error(`Invalid preview response: ${JSON.stringify(result)}`);
  }
  return result.previewUrl;
}

async function requestDevicePreview(
  taskId: string,
  submissionId: string,
  artifactId: string,
  deviceId: string,
  apiToken: string
): Promise<string> {
  const result = (await post(`/api/tasks/${taskId}/submissions/${submissionId}/preview`, {
    taskId,
    submissionId,
    artifactId,
    deviceId,
    apiToken,
  })) as { presignedUrl: string };

  if (!result.presignedUrl) {
    throw new Error(`Invalid device preview response: ${JSON.stringify(result)}`);
  }
  return result.presignedUrl;
}

async function main() {
  const { requester, worker } = getAccounts();

  console.log('=== Taskmarket Smoke Test - Generic Artifacts ===');
  console.log('requester:', requester.address);
  console.log('worker:   ', worker.address);
  console.log('api:      ', API_URL);

  log('1/7', 'Creating bounty task (X402)...');
  const { taskId } = (await x402Post(
    '/api/tasks',
    {
      description: 'Generic artifact smoke test task',
      reward: '1000',
      duration: 1,
      mode: 'bounty',
      tags: ['smoke-artifacts'],
    },
    requester
  )) as { taskId: string };
  ok('taskId', taskId);

  const textPayload = Buffer.from('artifact smoke text preview');
  const pngPayload = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
    'base64'
  );
  const expectedByName = new Map([
    [
      'preview.txt',
      {
        role: 'preview',
        mimeType: 'text/plain',
        mediaKind: 'text',
        sizeBytes: textPayload.byteLength,
        sha256Hash: sha256Hex(textPayload),
        keccak256Hash: keccak256(new Uint8Array(textPayload)),
      },
    ],
    [
      'logo.png',
      {
        role: 'final',
        mimeType: 'image/png',
        mediaKind: 'image',
        sizeBytes: pngPayload.byteLength,
        sha256Hash: sha256Hex(pngPayload),
        keccak256Hash: keccak256(new Uint8Array(pngPayload)),
      },
    ],
  ]);

  log('2/7', 'Submitting multiple artifacts...');
  const submitSig = await worker.signMessage({ message: `taskmarket:submit:${taskId}` });
  const { submissionId } = (await post(`/api/tasks/${taskId}/submissions`, {
    taskId,
    workerAddress: worker.address,
    signature: submitSig,
    artifacts: [
      {
        fileName: 'preview.txt',
        mimeType: 'text/plain',
        role: 'preview',
        file: textPayload.toString('base64'),
      },
      {
        fileName: 'logo.png',
        mimeType: 'image/png',
        role: 'final',
        file: pngPayload.toString('base64'),
      },
    ],
  })) as { submissionId: string };
  ok('submissionId', submissionId);

  log('3/7', 'Fetching submission artifact metadata...');
  const submissions = (await get(`/api/tasks/${taskId}/submissions`)) as SubmissionListing[];
  assertNoPreviewUrls(submissions);

  const submission = submissions.find((item) => item.id === submissionId);
  if (!submission) {
    throw new Error(`Submission ${submissionId} not found in listing`);
  }

  const artifacts = (submission.artifacts ?? [])
    .slice()
    .sort((a, b) => a.displayOrder - b.displayOrder);
  if (artifacts.length !== 2) {
    throw new Error(`Expected two artifacts, got ${artifacts.length}`);
  }

  for (const artifact of artifacts) {
    const expected = expectedByName.get(artifact.fileName);
    if (!expected) {
      throw new Error(`Unexpected artifact ${artifact.fileName}`);
    }
    if (
      artifact.role !== expected.role ||
      artifact.mimeType !== expected.mimeType ||
      artifact.mediaKind !== expected.mediaKind ||
      artifact.sizeBytes !== expected.sizeBytes ||
      artifact.sha256Hash !== expected.sha256Hash ||
      artifact.keccak256Hash.toLowerCase() !== expected.keccak256Hash.toLowerCase()
    ) {
      throw new Error(`Artifact metadata mismatch: ${JSON.stringify(artifact)}`);
    }
  }
  ok('artifact metadata count', artifacts.length);

  for (const artifact of artifacts) {
    if (artifact.workerAddress.toLowerCase() !== worker.address.toLowerCase()) {
      throw new Error(
        `Artifact workerAddress mismatch: got ${artifact.workerAddress}, expected ${worker.address}`
      );
    }
  }
  ok('artifact workerAddress', worker.address);

  const expectedManifestHash = manifestHash(artifacts);
  if (submission.deliverableHash?.toLowerCase() !== expectedManifestHash.toLowerCase()) {
    throw new Error(
      `Manifest hash mismatch: got ${submission.deliverableHash}, expected ${expectedManifestHash}`
    );
  }
  ok('manifest deliverableHash', submission.deliverableHash);

  log('4/7', 'Verifying device-authenticated artifact preview...');
  const device = (await post('/api/devices', {
    walletAddress: worker.address,
  })) as { deviceId: string; apiToken: string };
  await expectDevicePreviewDenied(taskId, submissionId, device.deviceId, device.apiToken);
  const devicePreviewUrl = await requestDevicePreview(
    taskId,
    submissionId,
    artifacts[0]!.id,
    device.deviceId,
    device.apiToken
  );
  const devicePreviewRes = await fetch(devicePreviewUrl);
  if (!devicePreviewRes.ok) {
    throw new Error(`Device preview URL fetch failed: ${devicePreviewRes.status}`);
  }
  ok('device artifact preview URL', artifacts[0]!.fileName);

  log('5/7', 'Verifying requester-only preview authorization...');
  const firstArtifact = artifacts[0]!;
  const workerPreviewSig = await worker.signMessage({
    message: `taskmarket:artifact-preview:${taskId}:${firstArtifact.id}`,
  });
  await expectPreviewDenied(taskId, firstArtifact.id, worker.address, workerPreviewSig);

  log('6/7', 'Fetching requester-signed preview URLs...');
  for (const artifact of artifacts) {
    const previewSig = await requester.signMessage({
      message: `taskmarket:artifact-preview:${taskId}:${artifact.id}`,
    });
    const previewUrl = await requestPreview(taskId, artifact.id, requester.address, previewSig);
    const previewRes = await fetch(previewUrl);
    if (!previewRes.ok) {
      throw new Error(`Preview URL fetch failed for ${artifact.fileName}: ${previewRes.status}`);
    }
    if (artifact.fileName === 'preview.txt') {
      const text = await previewRes.text();
      if (text !== textPayload.toString('utf8')) {
        throw new Error(`Text preview mismatch: ${text}`);
      }
    } else {
      const bytes = new Uint8Array(await previewRes.arrayBuffer());
      if (bytes.byteLength !== pngPayload.byteLength) {
        throw new Error(`Binary preview length mismatch: ${bytes.byteLength}`);
      }
    }
  }
  ok('requester preview URLs', artifacts.length);

  log('7/7', 'Requester accepting multi-artifact submission (X402)...');
  await x402Post(`/api/tasks/${taskId}/accept`, { taskId, worker: worker.address }, requester);
  ok('accepted', true);

  console.log('\n=== Generic artifact smoke test passed ===');
  console.log('taskId:', taskId);
  console.log('submissionId:', submissionId);
}

main().catch((err) => {
  console.error('\nFatal:', err);
  process.exit(1);
});

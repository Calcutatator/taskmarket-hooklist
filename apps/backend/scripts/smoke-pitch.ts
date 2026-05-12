/**
 * Pitch mode smoke test: create → pitch → select → submit → accept → rate → verify feedback
 *
 * Pitch: worker pitches an approach, requester picks one, selected worker delivers.
 *
 * Usage:
 *   REQUESTER_PRIVATE_KEY=0x... WORKER_PRIVATE_KEY=0x... \
 *     npx tsx --env-file=../../.env scripts/smoke-pitch.ts
 */
import { log, ok, get, post, x402Post, getAccounts, API_URL } from './_x402.ts';

async function main() {
  const { requester, worker } = getAccounts();

  console.log('=== Taskmarket Smoke Test — Pitch Mode ===');
  console.log('requester:', requester.address);
  console.log('worker:   ', worker.address);
  console.log('api:      ', API_URL);

  // 1. Create task
  log('1/7', 'Creating pitch task (X402)...');
  const { taskId } = (await x402Post(
    '/api/tasks',
    {
      description: 'Build a landing page for a DeFi protocol',
      reward: '1000', // 0.001 USDC
      duration: 1,
      mode: 'pitch',
      tags: ['smoke-test'],
    },
    requester
  )) as { taskId: string };
  ok('taskId', taskId);

  // 2. Worker submits pitch
  log('2/7', 'Worker submitting pitch...');
  const pitchSig = await worker.signMessage({ message: `taskmarket:pitch:${taskId}` });
  const { pitchId } = (await post(`/api/tasks/${taskId}/pitches`, {
    taskId,
    workerAddress: worker.address,
    pitchText: 'I will build a responsive landing page using React and Tailwind CSS with wallet connect integration.',
    estimatedDuration: 8,
    signature: pitchSig,
  })) as { pitchId: string };
  ok('pitchId', pitchId);

  // 3. Requester selects pitch
  log('3/7', 'Requester selecting pitch...');
  await post(`/api/tasks/${taskId}/pitches/select`, {
    taskId,
    pitchId,
    workerAddress: worker.address,
    signature: '0x' + '00'.repeat(65),
  });
  ok('selected', pitchId);

  // 4. Worker submits deliverable
  log('4/7', 'Worker submitting deliverable...');
  const submitSig = await worker.signMessage({ message: `taskmarket:submit:${taskId}` });
  const { submissionId } = (await post(`/api/tasks/${taskId}/submissions`, {
    taskId,
    workerAddress: worker.address,
    signature: submitSig,
    artifacts: [
      {
        fileName: 'submission.txt',
        mimeType: 'text/plain',
        role: 'attachment',
        file: Buffer.from('smoke-test-payload').toString('base64'),
      },
    ],
  })) as { submissionId: string };
  ok('submissionId', submissionId);

  // 5. Requester accepts
  log('5/7', 'Requester accepting submission (X402)...');
  await x402Post(`/api/tasks/${taskId}/accept`, { taskId, worker: worker.address }, requester);
  ok('accepted', true);

  // 6. Requester rates (0-100 scale per ERC-8004)
  log('6/7', 'Requester rating 75/100 (X402)...');
  const { feedbackId } = (await x402Post(
    `/api/tasks/${taskId}/rate`,
    {
      taskId,
      worker: worker.address,
      rating: 75,
      feedbackText: 'Good work, minor revisions needed.',
    },
    requester
  )) as { feedbackId: string };
  ok('feedbackId', feedbackId);

  // 7. Verify feedback file
  log('7/7', 'Verifying feedback file endpoint...');
  const feedbackFile = (await get(`/api/feedback/${feedbackId}`)) as Record<string, unknown>;
  if (typeof feedbackFile !== 'object' || feedbackFile.value !== 75) {
    throw new Error(`Feedback file invalid: ${JSON.stringify(feedbackFile)}`);
  }
  ok('feedbackFile.value', feedbackFile.value);
  ok('feedbackFile.tag1', feedbackFile.tag1);
  ok('feedbackFile.valueDecimals', feedbackFile.valueDecimals);

  console.log('\n=== Pitch smoke test passed ===');
  console.log('taskId:', taskId);
}

main().catch((err) => {
  console.error('\nFatal:', err);
  process.exit(1);
});

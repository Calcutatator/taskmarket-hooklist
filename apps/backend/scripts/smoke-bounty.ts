/**
 * Bounty mode smoke test: create → submit → accept → rate → verify feedback
 *
 * Bounty: task is open, any worker can submit, requester picks winner.
 *
 * Usage:
 *   REQUESTER_PRIVATE_KEY=0x... WORKER_PRIVATE_KEY=0x... \
 *     npx tsx --env-file=../../.env scripts/smoke-bounty.ts
 */
import { log, ok, get, post, x402Post, getAccounts, API_URL } from './_x402.ts';

async function main() {
  const { requester, worker } = getAccounts();

  console.log('=== Taskmarket Smoke Test — Bounty Mode ===');
  console.log('requester:', requester.address);
  console.log('worker:   ', worker.address);
  console.log('api:      ', API_URL);

  // 1. Create task
  log('1/5', 'Creating bounty task (X402)...');
  const { taskId } = (await x402Post(
    '/api/tasks',
    {
      description: 'Write a haiku about Base L2',
      reward: '1000', // 0.001 USDC
      duration: 1,
      mode: 'bounty',
      tags: ['smoke-test'],
    },
    requester
  )) as { taskId: string };
  ok('taskId', taskId);

  // 2. Worker submits TWICE — multi-submission Bounty semantic.
  //    The contract emits TaskSubmitted per call without writing task.deliverable
  //    or changing status. The requester finalises at acceptance time.
  log('2/5', 'Worker submitting first artifact...');
  const submitSig = await worker.signMessage({ message: `taskmarket:submit:${taskId}` });
  const { submissionId: submissionId1 } = (await post(`/api/tasks/${taskId}/submissions`, {
    taskId,
    workerAddress: worker.address,
    signature: submitSig,
    artifacts: [
      {
        fileName: 'submission-v1.txt',
        mimeType: 'text/plain',
        role: 'attachment',
        file: Buffer.from('smoke-test-payload-v1').toString('base64'),
      },
    ],
  })) as { submissionId: string };
  ok('submissionId1', submissionId1);

  log('2b/5', 'Worker submitting refined artifact (multi-submission)...');
  const { submissionId: submissionId2 } = (await post(`/api/tasks/${taskId}/submissions`, {
    taskId,
    workerAddress: worker.address,
    signature: submitSig,
    artifacts: [
      {
        fileName: 'submission-v2.txt',
        mimeType: 'text/plain',
        role: 'attachment',
        file: Buffer.from('smoke-test-payload-v2-refined').toString('base64'),
      },
    ],
  })) as { submissionId: string };
  ok('submissionId2', submissionId2);

  // 3. Requester accepts the SECOND submission. Backend looks up the
  //    deliverable hash for (taskId, worker) and the contract writes it
  //    to task.deliverable at acceptance.
  log('3/5', 'Requester accepting submission (X402)...');
  await x402Post(`/api/tasks/${taskId}/accept`, { taskId, worker: worker.address }, requester);
  ok('accepted', true);

  // 4. Requester rates (0-100 scale per ERC-8004)
  log('4/5', 'Requester rating 85/100 (X402)...');
  const { feedbackId } = (await x402Post(
    `/api/tasks/${taskId}/rate`,
    {
      taskId,
      worker: worker.address,
      rating: 85,
      feedbackText: 'Excellent haiku, delivered promptly.',
    },
    requester
  )) as { feedbackId: string };
  ok('feedbackId', feedbackId);

  // 5. Verify feedback file is accessible and valid JSON
  log('5/5', 'Verifying feedback file endpoint...');
  const feedbackFile = (await get(`/api/feedback/${feedbackId}`)) as Record<string, unknown>;
  if (typeof feedbackFile !== 'object' || feedbackFile.value !== 85) {
    throw new Error(`Feedback file invalid: ${JSON.stringify(feedbackFile)}`);
  }
  ok('feedbackFile.value', feedbackFile.value);
  ok('feedbackFile.tag1', feedbackFile.tag1);
  ok('feedbackFile.valueDecimals', feedbackFile.valueDecimals);

  console.log('\n=== Bounty smoke test passed ===');
  console.log('taskId:', taskId);
}

main().catch((err) => {
  console.error('\nFatal:', err);
  process.exit(1);
});

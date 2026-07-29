/**
 * Pitch mode smoke test: create → pitch → select → submit → [assert pending_approval] → accept → rate → verify feedback
 *
 * Pitch: worker pitches an approach, requester picks one, selected worker delivers.
 * After the selected worker submits, the task flips to pending_approval (unlike bounty/benchmark
 * which stay open). The intermediate state is asserted before the requester accepts.
 *
 * Usage:
 *   REQUESTER_PRIVATE_KEY=0x... WORKER_PRIVATE_KEY=0x... \
 *     npx tsx --env-file=../../.env src/scripts/smoke-pitch.ts
 */
import { createHash } from 'crypto';
import { buildSelectWorkerMessage, buildSubmitMessage } from '@taskmarket/shared';
import { log, ok, get, post, x402Post, getAccounts, API_URL } from './_x402';

function contentHash(payload: string): string {
  return createHash('sha256').update(Buffer.from(payload)).digest('hex');
}

async function main() {
  const { requester, worker } = getAccounts();

  console.log('=== Taskmarket Smoke Test — Pitch Mode ===');
  console.log('requester:', requester.address);
  console.log('worker:   ', worker.address);
  console.log('api:      ', API_URL);

  // 1. Create task
  log('1/8', 'Creating pitch task (X402)...');
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

  // 2. Worker submits pitch (X402-paid, anchors hash on-chain)
  log('2/8', 'Worker submitting pitch (X402)...');
  const { pitchId } = (await x402Post(
    `/api/tasks/${taskId}/pitches`,
    {
      taskId,
      workerAddress: worker.address,
      pitchText:
        'I will build a responsive landing page using React and Tailwind CSS with wallet connect integration.',
      estimatedDuration: 8,
      signature: '0x',
    },
    worker
  )) as { pitchId: string };
  ok('pitchId', pitchId);

  // 3. Requester selects pitch
  log('3/8', 'Requester selecting pitch (X402)...');
  const selectMessage = buildSelectWorkerMessage(taskId, pitchId, worker.address);
  const selectSignature = await requester.signMessage({ message: selectMessage });
  await x402Post(
    `/api/tasks/${taskId}/pitches/select`,
    { taskId, pitchId, workerAddress: worker.address, signature: selectSignature },
    requester
  );
  ok('selected', pitchId);

  // 4. Worker submits deliverable
  log('4/8', 'Worker submitting deliverable...');
  const submitPayload = 'smoke-test-payload';
  const submitSig = await worker.signMessage({
    message: buildSubmitMessage(taskId, [contentHash(submitPayload)]),
  });
  const { submissionId } = (await post(`/api/tasks/${taskId}/submissions`, {
    taskId,
    workerAddress: worker.address,
    signature: submitSig,
    artifacts: [
      {
        fileName: 'submission.txt',
        mimeType: 'text/plain',
        role: 'attachment',
        file: Buffer.from(submitPayload).toString('base64'),
      },
    ],
  })) as { submissionId: string };
  ok('submissionId', submissionId);

  // 5. Assert pending_approval state and pendingActions after submission
  log('5/8', 'Asserting pending_approval state and pendingActions after submission...');
  const afterSubmit = (await get(`/api/tasks/${taskId}`)) as {
    status: string;
    submissionWindowOpen: boolean;
    pendingActions: { role: string; action: string; command: string }[];
  };
  if (afterSubmit.status !== 'pending_approval') {
    throw new Error(
      `Expected status=pending_approval after pitch submission. Got: ${afterSubmit.status}`
    );
  }
  if (afterSubmit.submissionWindowOpen !== false) {
    throw new Error(
      `Expected submissionWindowOpen=false in pending_approval. Got: ${afterSubmit.submissionWindowOpen}`
    );
  }
  const acceptAction = afterSubmit.pendingActions.find(
    (a) => a.action === 'accept' && a.role === 'requester'
  );
  if (!acceptAction) {
    throw new Error(
      `Expected accept action for requester in pending_approval. Got: ${JSON.stringify(afterSubmit.pendingActions)}`
    );
  }
  if (
    !acceptAction.command.includes(worker.address.toLowerCase()) &&
    !acceptAction.command.includes(worker.address)
  ) {
    throw new Error(
      `Expected accept command to include worker address. Got: ${acceptAction.command}`
    );
  }
  ok('pending_approval: status', afterSubmit.status);
  ok('pending_approval: submissionWindowOpen', afterSubmit.submissionWindowOpen);
  ok('pending_approval: accept action present', true);
  ok('pending_approval: accept command includes worker', true);

  // 6. Requester accepts
  log('6/8', 'Requester accepting submission (X402)...');
  await x402Post(`/api/tasks/${taskId}/accept`, { taskId, worker: worker.address }, requester);
  ok('accepted', true);

  // Wait for indexer to process TaskCompleted event before rating
  for (let i = 0; i < 20; i++) {
    const t = (await get(`/api/tasks/${taskId}`)) as { status: string };
    if (t.status === 'completed') break;
    await new Promise((r) => setTimeout(r, 3000));
  }

  // 7. Requester rates (0-100 scale per ERC-8004)
  log('7/8', 'Requester rating 75/100 (X402)...');
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

  // 8. Verify feedback file
  log('8/8', 'Verifying feedback file endpoint...');
  const feedbackFile = (await get(`/api/feedback/${feedbackId}`)) as Record<string, unknown>;
  if (typeof feedbackFile !== 'object' || feedbackFile.value !== 75) {
    throw new Error(`Feedback file invalid: ${JSON.stringify(feedbackFile)}`);
  }
  ok('feedbackFile.value', feedbackFile.value);
  ok('feedbackFile.tag1', feedbackFile.tag1);
  ok('feedbackFile.valueDecimals', feedbackFile.valueDecimals);

  console.log('\n=== Pitch smoke test passed (8 steps) ===');
  console.log('taskId:', taskId);
}

main().catch((err) => {
  console.error('\nFatal:', err);
  process.exit(1);
});

/**
 * Claim mode smoke test: create → claim → submit → [assert pending_approval] → accept → rate → verify feedback
 *
 * Claim: worker calls POST /claim, server handles on-chain claimTask on their behalf.
 * After the worker submits, the task flips to pending_approval (unlike bounty/benchmark
 * which stay open). The intermediate state is asserted before the requester accepts.
 *
 * Usage:
 *   REQUESTER_PRIVATE_KEY=0x... WORKER_PRIVATE_KEY=0x... \
 *     npx tsx --env-file=../../.env src/scripts/smoke-claim.ts
 */
import { log, ok, get, post, x402Post, getAccounts, API_URL } from './_x402';

async function main() {
  const { requester, worker } = getAccounts();

  console.log('=== Taskmarket Smoke Test — Claim Mode ===');
  console.log('requester:', requester.address);
  console.log('worker:   ', worker.address);
  console.log('api:      ', API_URL);

  // 1. Create task
  log('1/7', 'Creating claim task (X402)...');
  const { taskId } = (await x402Post(
    '/api/tasks',
    {
      description: 'Translate this paragraph to French',
      reward: '1000', // 0.001 USDC
      duration: 1,
      mode: 'claim',
      tags: ['translation'],
    },
    requester
  )) as { taskId: string };
  ok('taskId', taskId);

  // 2. Worker claims
  log('2/7', 'Worker claiming task...');
  const claimMessage = `taskmarket:claim:${taskId}`;
  const claimSignature = await worker.signMessage({ message: claimMessage });
  const { claimId } = (await post(`/api/tasks/${taskId}/claim`, {
    taskId,
    workerAddress: worker.address,
    signature: claimSignature,
  })) as { claimId: string };
  ok('claimId', claimId);

  // 3. Worker submits
  log('3/7', 'Worker submitting work...');
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

  // 4. Assert pending_approval state and pendingActions after submission
  log('4/7', 'Asserting pending_approval state and pendingActions after submission...');
  const afterSubmit = (await get(`/api/tasks/${taskId}`)) as {
    status: string;
    submissionWindowOpen: boolean;
    pendingActions: { role: string; action: string; command: string }[];
  };
  if (afterSubmit.status !== 'pending_approval') {
    throw new Error(
      `Expected status=pending_approval after claim submission. Got: ${afterSubmit.status}`
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

  // 5. Requester accepts
  log('5/7', 'Requester accepting submission (X402)...');
  await x402Post(`/api/tasks/${taskId}/accept`, { taskId, worker: worker.address }, requester);
  ok('accepted', true);

  // Wait for indexer to process TaskCompleted event before rating
  for (let i = 0; i < 20; i++) {
    const t = (await get(`/api/tasks/${taskId}`)) as { status: string };
    if (t.status === 'completed') break;
    await new Promise((r) => setTimeout(r, 3000));
  }

  // 6. Requester rates (0-100 scale per ERC-8004)
  log('6/7', 'Requester rating 90/100 (X402)...');
  const { feedbackId } = (await x402Post(
    `/api/tasks/${taskId}/rate`,
    {
      taskId,
      worker: worker.address,
      rating: 90,
      feedbackText: 'Fast and accurate translation.',
    },
    requester
  )) as { feedbackId: string };
  ok('feedbackId', feedbackId);

  // 7. Verify feedback file
  log('7/7', 'Verifying feedback file endpoint...');
  const feedbackFile = (await get(`/api/feedback/${feedbackId}`)) as Record<string, unknown>;
  if (typeof feedbackFile !== 'object' || feedbackFile.value !== 90) {
    throw new Error(`Feedback file invalid: ${JSON.stringify(feedbackFile)}`);
  }
  ok('feedbackFile.value', feedbackFile.value);
  ok('feedbackFile.tag1', feedbackFile.tag1);
  ok('feedbackFile.valueDecimals', feedbackFile.valueDecimals);

  console.log('\n=== Claim smoke test passed (7 steps) ===');
  console.log('taskId:', taskId);
}

main().catch((err) => {
  console.error('\nFatal:', err);
  process.exit(1);
});

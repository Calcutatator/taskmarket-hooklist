/**
 * Evaluator-timeout smoke test: creates a claim task with a 5-second evaluation
 * window, assigns an evaluator, worker claims and submits, requester accepts
 * (→ review), waits for evaluation window to expire, then triggers evaluator timeout.
 *
 * Usage:
 *   REQUESTER_PRIVATE_KEY=0x... WORKER_PRIVATE_KEY=0x... \
 *     EVALUATOR_PRIVATE_KEY=0x... WORKER_B_PRIVATE_KEY=0x... \
 *     npx tsx --env-file=../../.env src/scripts/smoke-evaluator-timeout.ts
 */
import { createHash } from 'crypto';
import { buildSubmitMessage } from '@taskmarket/shared';
import {
  log,
  ok,
  get,
  post,
  x402Post,
  API_URL,
  pollTaskStatus,
  sleep,
  nudgeChainForward,
  expectActionQueueIntent,
  expectRejected,
  getEvaluatorAccounts,
} from './_x402';

function contentHash(payload: string): string {
  return createHash('sha256').update(Buffer.from(payload)).digest('hex');
}

async function main() {
  const { requester, worker, evaluator } = getEvaluatorAccounts();

  console.log('=== Taskmarket Smoke Test — Evaluator Timeout ===');
  console.log('requester:', requester.address);
  console.log('worker:   ', worker.address);
  console.log('evaluator:', evaluator.address);
  console.log('api:      ', API_URL);

  // 1. Create claim task with evaluator assigned and a 5-second evaluation window.
  log('1/7', 'Creating claim task with evaluator...');
  const { taskId } = (await x402Post(
    '/api/tasks',
    {
      description: 'Evaluator timeout smoke test task',
      reward: '1000',
      duration: 300,
      mode: 'claim',
      tags: ['smoke-evaluator-timeout'],
      evaluator: evaluator.address,
      evaluationWindowHours: 0.00139, // ~5 seconds
      appealWindowHours: 1,
    },
    requester
  )) as { taskId: string };
  ok('taskId', taskId);

  // 2. Worker claims the task.
  log('2/7', 'Worker claiming task...');
  const claimSig = await worker.signMessage({ message: `taskmarket:claim:${taskId}` });
  await post(`/api/tasks/${taskId}/claim`, {
    taskId,
    workerAddress: worker.address,
    signature: claimSig,
  });
  const claimed = (await get(`/api/tasks/${taskId}`)) as { status: string };
  if (claimed.status !== 'claimed') throw new Error(`Expected claimed, got ${claimed.status}`);
  ok('status', claimed.status);

  // 3. Worker submits work.
  log('3/7', 'Worker submitting work...');
  const submitPayload = 'evaluator-timeout-smoke-payload';
  const submitSig = await worker.signMessage({
    message: buildSubmitMessage(taskId, [contentHash(submitPayload)]),
  });
  await post(`/api/tasks/${taskId}/submissions`, {
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
  });
  ok('submitted', true);

  // 4. Task auto-transitions to review once submitted -- evaluator-mode tasks skip the
  // requester accept step (that's for bounty/auction/claim tasks with no evaluator).
  log('4/7', 'Waiting for auto-transition to review (indexer poll)...');
  const reviewTask = await pollTaskStatus<{ status: string }>(taskId, ['review'], {
    timeoutMs: 45_000,
  });
  ok('status after submit', reviewTask.status);
  await expectActionQueueIntent(taskId, evaluator, 'evaluate_work', true);
  await expectRejected('early evaluator timeout', () =>
    x402Post(`/api/tasks/${taskId}/evaluator-timeout`, { taskId }, requester)
  );

  // 5. Wait for evaluation window to expire (~5 seconds).
  log('5/7', 'Waiting 7s for evaluation window to expire...');
  await sleep(7000);
  await nudgeChainForward();

  await expectActionQueueIntent(taskId, requester, 'evaluate_work', true);
  await expectRejected('wrong requester timeout', () =>
    x402Post(`/api/tasks/${taskId}/evaluator-timeout`, { taskId }, evaluator)
  );

  // 6. Trigger evaluator timeout.
  log('6/7', 'Triggering evaluator timeout...');
  const { txHash } = (await x402Post(
    `/api/tasks/${taskId}/evaluator-timeout`,
    { taskId },
    requester
  )) as { txHash: string };
  ok('txHash', txHash);

  // 7. Verify task is back in pending_approval.
  log('7/7', 'Verifying task status...');
  const finalTask = await pollTaskStatus<{ status: string }>(taskId, ['pending_approval'], {
    timeoutMs: 45_000,
  });
  ok('final status', finalTask.status);
  await expectActionQueueIntent(taskId, requester, 'evaluate_work', false);
  await expectActionQueueIntent(taskId, evaluator, 'evaluate_work', false);
  await expectRejected('stale evaluator verdict', () =>
    x402Post(
      `/api/tasks/${taskId}/evaluate`,
      { taskId, verdict: 'approve', score: 900, confidence: 900 },
      evaluator
    )
  );

  console.log('\nSmoke test passed.');
}

main().catch((err) => {
  console.error('Smoke test failed:', err.message ?? err);
  process.exit(1);
});

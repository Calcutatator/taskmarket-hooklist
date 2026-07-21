/**
 * Evaluator-timeout smoke test: creates a claim task with a 5-second evaluation
 * window, assigns an evaluator, worker claims and submits, requester accepts
 * (→ review), waits for evaluation window to expire, then triggers evaluator timeout.
 *
 * Usage:
 *   REQUESTER_PRIVATE_KEY=0x... WORKER_PRIVATE_KEY=0x... \
 *     npx tsx --env-file=../../.env scripts/smoke-evaluator-timeout.ts
 */
import { log, ok, get, x402Post, getAccounts, API_URL, sleep } from './_x402.ts';

async function main() {
  const { requester, worker } = getAccounts();

  console.log('=== Taskmarket Smoke Test — Evaluator Timeout ===');
  console.log('requester:', requester.address);
  console.log('worker:   ', worker.address);
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
      evaluator: requester.address,
      evaluationWindowHours: 0.00139, // ~5 seconds
      appealWindowHours: 1,
    },
    requester
  )) as { taskId: string };
  ok('taskId', taskId);

  // 2. Worker claims the task.
  log('2/7', 'Worker claiming task...');
  await x402Post(`/api/tasks/${taskId}/claim`, { taskId }, worker);
  const claimed = (await get(`/api/tasks/${taskId}`)) as { status: string };
  if (claimed.status !== 'claimed') throw new Error(`Expected claimed, got ${claimed.status}`);
  ok('status', claimed.status);

  // 3. Worker submits work.
  log('3/7', 'Worker submitting work...');
  await x402Post(
    `/api/tasks/${taskId}/submit`,
    { taskId, deliverable: `0x${'ab'.repeat(32)}` },
    worker
  );
  ok('submitted');

  // 4. Requester accepts submission — task should enter review state.
  log('4/7', 'Requester accepting submission (→ review)...');
  await x402Post(`/api/tasks/${taskId}/accept`, { taskId, worker: worker.address }, requester);

  // Give indexer a moment to process.
  await sleep(3000);
  const reviewTask = (await get(`/api/tasks/${taskId}`)) as { status: string };
  ok('status after accept', reviewTask.status);

  // 5. Wait for evaluation window to expire (~5 seconds).
  log('5/7', 'Waiting 7s for evaluation window to expire...');
  await sleep(7000);

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
  await sleep(2000);
  const finalTask = (await get(`/api/tasks/${taskId}`)) as { status: string };
  if (finalTask.status !== 'pending_approval') {
    throw new Error(`Expected pending_approval, got ${finalTask.status}`);
  }
  ok('final status', finalTask.status);

  console.log('\nSmoke test passed.');
}

main().catch((err) => {
  console.error('Smoke test failed:', err.message ?? err);
  process.exit(1);
});

/**
 * Contest mode smoke test: create → submit → accept → rate
 *
 * Contest: task is open, any worker can submit, requester picks winner.
 *
 * Usage:
 *   REQUESTER_PRIVATE_KEY=0x... WORKER_PRIVATE_KEY=0x... \
 *     npx tsx --env-file=../../.env scripts/smoke-contest.ts
 */
import { log, ok, post, x402Post, getAccounts, API_URL } from './_x402.ts';

async function main() {
  const { requester, worker } = getAccounts();

  console.log('=== Clawtasker Smoke Test — Contest Mode ===');
  console.log('requester:', requester.address);
  console.log('worker:   ', worker.address);
  console.log('api:      ', API_URL);

  // 1. Create task
  log('1/4', 'Creating contest task (X402)...');
  const { taskId } = (await x402Post(
    '/api/tasks',
    {
      description: 'Write a haiku about Base L2',
      reward: '1000', // 0.001 USDC
      duration: 1,
      mode: 'contest',
      tags: ['smoke-test'],
    },
    requester
  )) as { taskId: string };
  ok('taskId', taskId);

  // 2. Worker submits
  log('2/4', 'Worker submitting work...');
  const { submissionId } = (await post(`/api/tasks/${taskId}/submissions`, {
    taskId,
    workerAddress: worker.address,
    file: Buffer.from('smoke-test-payload').toString('base64'),
    signature: '0x' + '00'.repeat(65),
  })) as { submissionId: string };
  ok('submissionId', submissionId);

  // 3. Requester accepts
  log('3/4', 'Requester accepting submission (X402)...');
  await x402Post(`/api/tasks/${taskId}/accept`, { taskId, worker: worker.address }, requester);
  ok('accepted', true);

  // 4. Requester rates
  log('4/4', 'Requester rating 5 stars (X402)...');
  await x402Post(
    `/api/tasks/${taskId}/rate`,
    { taskId, worker: worker.address, rating: 5 },
    requester
  );
  ok('rated', '5 stars');

  console.log('\n=== Contest smoke test passed ✓ ===');
  console.log('taskId:', taskId);
}

main().catch((err) => {
  console.error('\nFatal:', err);
  process.exit(1);
});

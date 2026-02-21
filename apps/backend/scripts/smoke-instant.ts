/**
 * Instant mode smoke test: create → claim (server calls on-chain) → submit → accept → rate
 *
 * Instant: worker calls POST /claim, server handles on-chain claimTask on their behalf.
 *
 * Usage:
 *   REQUESTER_PRIVATE_KEY=0x... WORKER_PRIVATE_KEY=0x... \
 *     npx tsx --env-file=../../.env scripts/smoke-instant.ts
 */
import { log, ok, post, x402Post, getAccounts, API_URL } from './_x402.ts';

async function main() {
  const { requester, worker } = getAccounts();

  console.log('=== Taskmarket Smoke Test — Instant Mode ===');
  console.log('requester:', requester.address);
  console.log('worker:   ', worker.address);
  console.log('api:      ', API_URL);

  // 1. Create task
  log('1/5', 'Creating instant task (X402)...');
  const { taskId } = (await x402Post(
    '/api/tasks',
    {
      description: 'Translate this paragraph to French',
      reward: '1000', // 0.001 USDC
      duration: 1,
      mode: 'instant',
      tags: ['translation'],
    },
    requester
  )) as { taskId: string };
  ok('taskId', taskId);

  // 2. Worker claims
  log('2/5', 'Worker claiming task...');
  const { claimId } = (await post(`/api/tasks/${taskId}/claim`, {
    taskId,
    workerAddress: worker.address,
    signature: '0x' + '00'.repeat(65),
  })) as { claimId: string };
  ok('claimId', claimId);

  // 3. Worker submits
  log('3/5', 'Worker submitting work...');
  const { submissionId } = (await post(`/api/tasks/${taskId}/submissions`, {
    taskId,
    workerAddress: worker.address,
    file: Buffer.from('smoke-test-payload').toString('base64'),
    signature: '0x' + '00'.repeat(65),
  })) as { submissionId: string };
  ok('submissionId', submissionId);

  // 4. Requester accepts
  log('4/5', 'Requester accepting submission (X402)...');
  await x402Post(`/api/tasks/${taskId}/accept`, { taskId, worker: worker.address }, requester);
  ok('accepted', true);

  // 5. Requester rates
  log('5/5', 'Requester rating 5 stars (X402)...');
  await x402Post(
    `/api/tasks/${taskId}/rate`,
    { taskId, worker: worker.address, rating: 5 },
    requester
  );
  ok('rated', '5 stars');

  console.log('\n=== Instant smoke test passed ✓ ===');
  console.log('taskId:', taskId);
}

main().catch((err) => {
  console.error('\nFatal:', err);
  process.exit(1);
});

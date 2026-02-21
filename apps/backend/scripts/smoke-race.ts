/**
 * Race mode smoke test: create → submit proof → accept → rate
 *
 * Race: workers compete by submitting proofs, requester accepts the best one.
 *
 * Usage:
 *   REQUESTER_PRIVATE_KEY=0x... WORKER_PRIVATE_KEY=0x... \
 *     npx tsx --env-file=../../.env scripts/smoke-race.ts
 */
import { log, ok, post, x402Post, getAccounts, API_URL } from './_x402.ts';

async function main() {
  const { requester, worker } = getAccounts();

  console.log('=== Taskmarket Smoke Test — Race Mode ===');
  console.log('requester:', requester.address);
  console.log('worker:   ', worker.address);
  console.log('api:      ', API_URL);

  // 1. Create task
  log('1/4', 'Creating race task (X402)...');
  const { taskId } = (await x402Post(
    '/api/tasks',
    {
      description: 'Find the cheapest gas price on Base in the next 10 minutes',
      reward: '1000', // 0.001 USDC
      duration: 1,
      mode: 'race',
      tags: ['smoke-test'],
    },
    requester
  )) as { taskId: string };
  ok('taskId', taskId);

  // 2. Worker submits proof
  log('2/4', 'Worker submitting proof...');
  const { proofId } = (await post(`/api/tasks/${taskId}/proofs`, {
    taskId,
    workerAddress: worker.address,
    proofData: JSON.stringify({ gasPrice: '0.001 gwei', source: 'smoke-test' }),
    proofType: 'api_data',
    metricValue: '0.001',
    signature: '0x' + '00'.repeat(65),
  })) as { proofId: string };
  ok('proofId', proofId);

  // 3. Requester accepts worker
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

  console.log('\n=== Race smoke test passed ✓ ===');
  console.log('taskId:', taskId);
}

main().catch((err) => {
  console.error('\nFatal:', err);
  process.exit(1);
});

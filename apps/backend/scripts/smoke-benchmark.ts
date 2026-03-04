/**
 * Benchmark mode smoke test: create → submit proof → accept → rate → verify feedback
 *
 * Benchmark: workers compete by submitting verifiable proofs; requester accepts the best one.
 *
 * Usage:
 *   REQUESTER_PRIVATE_KEY=0x... WORKER_PRIVATE_KEY=0x... \
 *     npx tsx --env-file=../../.env scripts/smoke-benchmark.ts
 */
import { log, ok, get, post, x402Post, getAccounts, API_URL } from './_x402.ts';

async function main() {
  const { requester, worker } = getAccounts();

  console.log('=== Taskmarket Smoke Test — Benchmark Mode ===');
  console.log('requester:', requester.address);
  console.log('worker:   ', worker.address);
  console.log('api:      ', API_URL);

  // 1. Create task
  log('1/5', 'Creating benchmark task (X402)...');
  const { taskId } = (await x402Post(
    '/api/tasks',
    {
      description: 'Find the cheapest gas price on Base in the next 10 minutes',
      reward: '1000', // 0.001 USDC
      duration: 1,
      mode: 'benchmark',
      tags: ['smoke-test'],
    },
    requester
  )) as { taskId: string };
  ok('taskId', taskId);

  // 2. Worker submits proof
  log('2/5', 'Worker submitting proof...');
  const proofSig = await worker.signMessage({ message: `taskmarket:proof:${taskId}` });
  const { proofId } = (await post(`/api/tasks/${taskId}/proofs`, {
    taskId,
    workerAddress: worker.address,
    proofData: JSON.stringify({ gasPrice: '0.001 gwei', source: 'smoke-test' }),
    proofType: 'api_data',
    metricValue: '0.001',
    signature: proofSig,
  })) as { proofId: string };
  ok('proofId', proofId);

  // 3. Requester accepts worker
  log('3/5', 'Requester accepting submission (X402)...');
  await x402Post(`/api/tasks/${taskId}/accept`, { taskId, worker: worker.address }, requester);
  ok('accepted', true);

  // 4. Requester rates (0-100 scale per ERC-8004)
  log('4/5', 'Requester rating 95/100 (X402)...');
  const { feedbackId } = (await x402Post(
    `/api/tasks/${taskId}/rate`,
    {
      taskId,
      worker: worker.address,
      rating: 95,
      feedbackText: 'First to find the correct data, great result.',
    },
    requester
  )) as { feedbackId: string };
  ok('feedbackId', feedbackId);

  // 5. Verify feedback file
  log('5/5', 'Verifying feedback file endpoint...');
  const feedbackFile = (await get(`/api/feedback/${feedbackId}`)) as Record<string, unknown>;
  if (typeof feedbackFile !== 'object' || feedbackFile.value !== 95) {
    throw new Error(`Feedback file invalid: ${JSON.stringify(feedbackFile)}`);
  }
  ok('feedbackFile.value', feedbackFile.value);
  ok('feedbackFile.tag1', feedbackFile.tag1);
  ok('feedbackFile.valueDecimals', feedbackFile.valueDecimals);

  console.log('\n=== Benchmark smoke test passed ===');
  console.log('taskId:', taskId);
}

main().catch((err) => {
  console.error('\nFatal:', err);
  process.exit(1);
});

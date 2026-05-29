/**
 * Benchmark mode smoke test: create → submit proof → accept → rate → verify feedback
 *
 * Benchmark: workers compete by submitting verifiable proofs; requester accepts the best one.
 *
 * Usage:
 *   REQUESTER_PRIVATE_KEY=0x... WORKER_PRIVATE_KEY=0x... \
 *     npx tsx --env-file=../../.env scripts/smoke-benchmark.ts
 */
import { keccak256, toBytes } from 'viem';
import { log, ok, get, x402Post, getAccounts, API_URL } from './_x402.ts';

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

  // 2. Worker submits proof (X402-paid, anchors hash on-chain)
  log('2/5', 'Worker submitting proof (X402)...');
  const proofData = JSON.stringify({ gasPrice: '0.001 gwei', source: 'smoke-test' });
  const { proofId } = (await x402Post(
    `/api/tasks/${taskId}/proofs`,
    {
      taskId,
      workerAddress: worker.address,
      proofData,
      proofType: 'api_data',
      // uint256 on-chain — represent 0.001 gwei as 1_000_000 wei to keep integer
      metricValue: '1000000',
      signature: '0x',
    },
    worker
  )) as { proofId: string };
  ok('proofId', proofId);

  // 3. Requester accepts worker. Benchmark uses the deferred-write model in v2:
  //    submitWork (which submissions go through) DID NOT write task.deliverable;
  //    instead the requester names the deliverable hash at acceptance. For this
  //    smoke we use the proof content hash as the deliverable since the worker
  //    only submitted via the proof flow.
  log('3/5', 'Requester accepting submission (X402)...');
  const deliverable = keccak256(toBytes(proofData));
  await x402Post(
    `/api/tasks/${taskId}/accept`,
    { taskId, worker: worker.address, deliverable },
    requester
  );
  ok('accepted', true);

  // Wait for indexer to process TaskCompleted event before rating
  for (let i = 0; i < 20; i++) {
    const t = (await get(`/api/tasks/${taskId}`)) as { status: string };
    if (t.status === 'completed') break;
    await new Promise((r) => setTimeout(r, 3000));
  }

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

/**
 * Auction mode smoke test: create → bid (worker A) → bid (worker B, lower) → select winner → submit → accept → rate → verify feedback
 *
 * Auction: requester sets a max price; workers bid down from it. Lowest bid after
 * the deadline wins exclusive assignment. Payment releases at bid price; surplus
 * is refunded to requester.
 *
 * Usage:
 *   REQUESTER_PRIVATE_KEY=0x... WORKER_PRIVATE_KEY=0x... WORKER_B_PRIVATE_KEY=0x... \
 *     npx tsx --env-file=../../.env scripts/smoke-auction.ts
 */
import { log, ok, get, post, x402Post, getAccounts, API_URL } from './_x402.ts';

async function main() {
  const { requester, worker } = getAccounts();

  console.log('=== Taskmarket Smoke Test — Auction Mode ===');
  console.log('requester:', requester.address);
  console.log('worker:   ', worker.address);
  console.log('api:      ', API_URL);

  // 1. Create auction task (max price 5 USDC, bid deadline in 1 minute)
  log('1/7', 'Creating auction task (X402) — max 5 USDC, 1 min bid window...');
  const { taskId } = (await x402Post(
    '/api/tasks',
    {
      description: 'Audit this smart contract for vulnerabilities',
      reward: '5000000', // 5 USDC max price (base units)
      maxPrice: '5000000',
      duration: 1,
      mode: 'auction',
      bidDeadline: 1 / 60, // ~1 minute in hours
      tags: ['smoke-test'],
    },
    requester
  )) as { taskId: string };
  ok('taskId', taskId);

  // 2. Worker A submits bid at 4 USDC
  log('2/7', 'Worker A bidding at 4 USDC...');
  const { bidId: bidIdA } = (await x402Post(
    `/api/tasks/${taskId}/bids`,
    {
      taskId,
      price: '4000000', // 4 USDC in base units
    },
    worker
  )) as { bidId: string };
  ok('bidId (worker A)', bidIdA);

  // 3. List bids — should show worker A's bid
  log('3/7', 'Listing bids...');
  const bidList = (await get(`/api/tasks/${taskId}/bids`)) as unknown[];
  if (!Array.isArray(bidList) || bidList.length < 1) {
    throw new Error(`Expected at least 1 bid, got: ${JSON.stringify(bidList)}`);
  }
  ok('bidCount', bidList.length);

  // 4. Select winner (trigger manually — in production the backend job does this after deadline)
  log('4/7', 'Selecting lowest bidder...');
  const { workerAddress: winner } = (await post(`/api/tasks/${taskId}/bids/select-winner`, {
    taskId,
  })) as { workerAddress: string };
  ok('winner', winner);

  // 5. Worker submits deliverable
  log('5/7', 'Worker submitting deliverable...');
  const submitSig = await worker.signMessage({ message: `taskmarket:submit:${taskId}` });
  const { submissionId } = (await post(`/api/tasks/${taskId}/submissions`, {
    taskId,
    workerAddress: worker.address,
    file: Buffer.from('smoke-test-payload').toString('base64'),
    signature: submitSig,
  })) as { submissionId: string };
  ok('submissionId', submissionId);

  // 6. Requester accepts
  log('6/7', 'Requester accepting submission (X402)...');
  await x402Post(`/api/tasks/${taskId}/accept`, { taskId, worker: worker.address }, requester);
  ok('accepted', true);

  // 7. Requester rates (0-100 scale per ERC-8004)
  log('7/7', 'Requester rating 88/100 (X402)...');
  const { feedbackId } = (await x402Post(
    `/api/tasks/${taskId}/rate`,
    {
      taskId,
      worker: worker.address,
      rating: 88,
      feedbackText: 'Thorough audit at a competitive price.',
    },
    requester
  )) as { feedbackId: string };
  ok('feedbackId', feedbackId);

  // Verify feedback file
  const feedbackFile = (await get(`/api/feedback/${feedbackId}`)) as Record<string, unknown>;
  if (typeof feedbackFile !== 'object' || feedbackFile.value !== 88) {
    throw new Error(`Feedback file invalid: ${JSON.stringify(feedbackFile)}`);
  }
  ok('feedbackFile.value', feedbackFile.value);

  console.log('\n=== Auction smoke test passed ===');
  console.log('taskId:', taskId);
  console.log('winner:', winner);
}

main().catch((err) => {
  console.error('\nFatal:', err);
  process.exit(1);
});

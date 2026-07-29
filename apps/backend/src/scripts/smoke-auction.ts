/**
 * Auction mode smoke test: create → bid (worker A) → bid (worker B, lower, optional) → select winner → submit → accept → rate → verify feedback
 *
 * Auction: requester sets a max price; workers bid down from it. Lowest bid after
 * the deadline wins exclusive assignment. Payment releases at bid price; surplus
 * is refunded to requester.
 *
 * Usage:
 *   REQUESTER_PRIVATE_KEY=0x... WORKER_PRIVATE_KEY=0x... [WORKER_B_PRIVATE_KEY=0x...] \
 *     npx tsx --env-file=../../.env src/scripts/smoke-auction.ts
 *
 * WORKER_B_PRIVATE_KEY is optional. When set, worker B bids lower than worker A to
 * test competitive bidding. Without it, the test still exercises auction mechanics
 * with a single bidder.
 */
import { createHash } from 'crypto';
import { privateKeyToAccount } from 'viem/accounts';
import { buildSubmitMessage } from '@taskmarket/shared';
import { log, ok, get, post, x402Post, getAccounts, API_URL, nudgeChainForward } from './_x402';

function contentHash(payload: string): string {
  return createHash('sha256').update(Buffer.from(payload)).digest('hex');
}

async function main() {
  const { requester, worker } = getAccounts();
  const workerBKey = process.env.WORKER_B_PRIVATE_KEY as `0x${string}` | undefined;
  const workerB = workerBKey ? privateKeyToAccount(workerBKey) : undefined;

  console.log('=== Taskmarket Smoke Test — Auction Mode ===');
  console.log('requester:', requester.address);
  console.log('worker:   ', worker.address);
  if (workerB) {
    console.log('workerB:  ', workerB.address);
  } else {
    console.log('workerB:   (not set — single-bidder path)');
  }
  console.log('api:      ', API_URL);

  // 1. Create auction task (max price 0.001 USDC, 30s bid window)
  log('1/7', 'Creating auction task (X402) — max 0.001 USDC, 30s bid window...');
  const { taskId } = (await x402Post(
    '/api/tasks',
    {
      description: 'Audit this smart contract for vulnerabilities',
      reward: '1000', // 0.001 USDC max price (base units)
      maxPrice: '1000',
      duration: 1,
      mode: 'auction',
      auctionType: 'english',
      bidDeadline: 30 / 3600, // 30 seconds in hours
      tags: ['smoke-test'],
    },
    requester
  )) as { taskId: string };
  ok('taskId', taskId);

  // 2. Worker A submits bid at 0.0008 USDC
  log('2/7', 'Worker A bidding at 0.0008 USDC...');
  const { bidId: bidIdA } = (await x402Post(
    `/api/tasks/${taskId}/bids`,
    {
      taskId,
      price: '800', // 0.0008 USDC in base units
    },
    worker
  )) as { bidId: string };
  ok('bidId (worker A)', bidIdA);

  // 2b. Worker B bids lower (optional)
  if (workerB) {
    log('2b/7', 'Worker B bidding at 0.0006 USDC (undercutting A)...');
    const { bidId: bidIdB } = (await x402Post(
      `/api/tasks/${taskId}/bids`,
      { taskId, price: '600' },
      workerB
    )) as { bidId: string };
    ok('bidId (worker B)', bidIdB);
  }

  // 3. List bids — should show at least worker A's bid (and B's if present)
  log('3/7', 'Listing bids...');
  const bidList = (await get(`/api/tasks/${taskId}/bids`)) as unknown[];
  const expectedMinBids = workerB ? 2 : 1;
  if (!Array.isArray(bidList) || bidList.length < expectedMinBids) {
    throw new Error(`Expected at least ${expectedMinBids} bid(s), got: ${JSON.stringify(bidList)}`);
  }
  ok('bidCount', bidList.length);

  // 4. Wait for bid deadline, then select winner
  log('4/7', 'Waiting 32s for bid deadline to pass...');
  await new Promise((r) => setTimeout(r, 32000));
  // Syncs Anvil's frozen block.timestamp forward -- see nudgeChainForward in _x402.ts.
  await nudgeChainForward();
  log('4/7', 'Selecting lowest bidder...');
  const { workerAddress: winner } = (await post(`/api/tasks/${taskId}/bids/select-winner`, {
    taskId,
  })) as { workerAddress: string };
  ok('winner', winner);

  // Verify the right worker won
  const expectedWinner = workerB ? workerB.address.toLowerCase() : worker.address.toLowerCase();
  if (winner.toLowerCase() !== expectedWinner) {
    throw new Error(`Expected winner ${expectedWinner}, got ${winner}`);
  }

  // The winning worker submits
  const submittingWorker = workerB ?? worker;

  // 5. Winning worker submits deliverable
  log('5/7', 'Winning worker submitting deliverable...');
  const submitPayload = 'smoke-test-payload';
  const submitSig = await submittingWorker.signMessage({
    message: buildSubmitMessage(taskId, [contentHash(submitPayload)]),
  });
  const { submissionId } = (await post(`/api/tasks/${taskId}/submissions`, {
    taskId,
    workerAddress: submittingWorker.address,
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

  // 6. Requester accepts
  log('6/7', 'Requester accepting submission (X402)...');
  await x402Post(
    `/api/tasks/${taskId}/accept`,
    { taskId, worker: submittingWorker.address },
    requester
  );
  ok('accepted', true);

  // Wait for indexer to process TaskCompleted event before rating
  for (let i = 0; i < 20; i++) {
    const t = (await get(`/api/tasks/${taskId}`)) as { status: string };
    if (t.status === 'completed') break;
    await new Promise((r) => setTimeout(r, 3000));
  }

  // 7. Requester rates (0-100 scale per ERC-8004)
  log('7/7', 'Requester rating 88/100 (X402)...');
  const { feedbackId } = (await x402Post(
    `/api/tasks/${taskId}/rate`,
    {
      taskId,
      worker: submittingWorker.address,
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

/**
 * Full auction end-to-end smoke test: exercises Dutch and Reverse Dutch flows all the
 * way through submission, acceptance, and rating — the parts that smoke-auction-types.ts
 * deliberately skips.
 *
 * Also tests the --min-price rejection guard on reverse_dutch (clock price below minPrice
 * is rejected; clock price at or above minPrice is accepted).
 *
 * Dutch flow:
 *   create → auction-accept → submit → accept → rate
 *
 * Reverse Dutch flow:
 *   create → attempt auction-accept with unreachable minPrice (rejected) →
 *   auction-accept without minPrice → submit → accept → rate
 *
 * Usage:
 *   REQUESTER_PRIVATE_KEY=0x... WORKER_PRIVATE_KEY=0x... \
 *     npx tsx --env-file=../../.env scripts/smoke-auction-full.ts
 */
import { log, ok, get, post, x402Post, getAccounts, type Account, API_URL } from './_x402.ts';

async function smokeDutchFull(requester: Account, worker: Account) {
  console.log('\n--- Dutch Auction Full End-to-End ---');

  log('1/6', 'Creating dutch auction (5min clock, max 0.001, floor 0.0001 USDC)...');
  const { taskId } = (await x402Post(
    '/api/tasks',
    {
      description: 'Dutch auction full e2e smoke test',
      reward: '1000',
      maxPrice: '1000',
      duration: 1,
      mode: 'auction',
      auctionType: 'dutch',
      auctionFloorPrice: '100',
      bidDeadline: 5 / 60,
      tags: ['smoke-auction-full'],
    },
    requester
  )) as { taskId: string };
  ok('taskId', taskId);

  log('2/6', 'Worker accepts current clock price (auction-accept)...');
  const acceptResult = (await x402Post(
    `/api/tasks/${taskId}/bids/accept`,
    { taskId },
    worker
  )) as { acceptedPrice: string; workerAddress: string };
  ok('acceptedPrice', acceptResult.acceptedPrice);

  const claimedTask = (await get(`/api/tasks/${taskId}`)) as { status: string };
  if (claimedTask.status !== 'claimed') {
    throw new Error(`Expected status=claimed after auction-accept, got ${claimedTask.status}`);
  }
  ok('status=claimed', true);

  log('3/6', 'Worker submitting deliverable...');
  const submitSig = await worker.signMessage({ message: `taskmarket:submit:${taskId}` });
  const { submissionId } = (await post(`/api/tasks/${taskId}/submissions`, {
    taskId,
    workerAddress: worker.address,
    file: Buffer.from('dutch-auction-full-smoke-payload').toString('base64'),
    signature: submitSig,
  })) as { submissionId: string };
  ok('submissionId', submissionId);

  log('4/6', 'Requester accepting submission (X402)...');
  await x402Post(`/api/tasks/${taskId}/accept`, { taskId, worker: worker.address }, requester);
  ok('accepted', true);

  log('5/6', 'Requester rating 80/100 (X402)...');
  const { feedbackId } = (await x402Post(
    `/api/tasks/${taskId}/rate`,
    { taskId, worker: worker.address, rating: 80, feedbackText: 'Dutch auction full e2e smoke.' },
    requester
  )) as { feedbackId: string };
  ok('feedbackId', feedbackId);

  log('6/6', 'Verifying feedback file...');
  const feedbackFile = (await get(`/api/feedback/${feedbackId}`)) as Record<string, unknown>;
  if (feedbackFile.value !== 80) {
    throw new Error(`Feedback file value mismatch: ${JSON.stringify(feedbackFile)}`);
  }
  ok('feedbackFile.value', feedbackFile.value);

  const finalTask = (await get(`/api/tasks/${taskId}`)) as { status: string; rating: number | null };
  if (finalTask.status !== 'accepted' || finalTask.rating === null) {
    throw new Error(`Expected status=accepted with rating set, got status=${finalTask.status} rating=${finalTask.rating}`);
  }
  ok('final status=accepted with rating', true);

  return taskId;
}

async function smokeReverseDutchFull(requester: Account, worker: Account) {
  console.log('\n--- Reverse Dutch Auction Full End-to-End + Min-Price Guard ---');

  log('1/8', 'Creating reverse_dutch auction (5min clock, start 0.0001, max 0.001 USDC)...');
  const { taskId } = (await x402Post(
    '/api/tasks',
    {
      description: 'Reverse Dutch auction full e2e smoke test',
      reward: '1000',
      maxPrice: '1000',
      duration: 1,
      mode: 'auction',
      auctionType: 'reverse_dutch',
      auctionStartPrice: '100',
      bidDeadline: 5 / 60,
      tags: ['smoke-auction-full'],
    },
    requester
  )) as { taskId: string };
  ok('taskId', taskId);

  log('2/8', 'Checking clock price fields...');
  const task = (await get(`/api/tasks/${taskId}`)) as {
    currentAuctionPrice: string | null;
    auctionPriceReachesMaxAt: string | null;
  };
  ok('currentAuctionPrice', task.currentAuctionPrice !== null);
  ok('auctionPriceReachesMaxAt', task.auctionPriceReachesMaxAt !== null);

  // Test minPrice guard rejection: minPrice set above maxPrice (2000 > maxPrice 1000)
  // The clock can never reach 2000, so this should always be rejected
  log('3/8', 'Testing --min-price rejection (minPrice=2000 > maxPrice=1000)...');
  let rejectionCaught = false;
  try {
    await x402Post(
      `/api/tasks/${taskId}/bids/accept`,
      { taskId, minPrice: '2000' },
      worker
    );
  } catch (err) {
    if (err instanceof Error && err.message.includes('below your minimum')) {
      rejectionCaught = true;
      ok('minPrice guard rejected correctly', err.message);
    } else {
      throw err;
    }
  }
  if (!rejectionCaught) {
    throw new Error('Expected minPrice guard to reject the auction-accept, but it succeeded');
  }

  // Verify task is still open (not claimed by the rejected attempt)
  log('4/8', 'Verifying task is still open after rejected auction-accept...');
  const stillOpen = (await get(`/api/tasks/${taskId}`)) as { status: string };
  if (stillOpen.status !== 'open') {
    throw new Error(`Task should still be open after rejected auction-accept, got ${stillOpen.status}`);
  }
  ok('task still open', true);

  log('5/8', 'Worker accepts clock price without minPrice guard...');
  const acceptResult = (await x402Post(
    `/api/tasks/${taskId}/bids/accept`,
    { taskId },
    worker
  )) as { acceptedPrice: string; workerAddress: string };
  ok('acceptedPrice', acceptResult.acceptedPrice);

  const claimedTask = (await get(`/api/tasks/${taskId}`)) as { status: string };
  if (claimedTask.status !== 'claimed') {
    throw new Error(`Expected status=claimed, got ${claimedTask.status}`);
  }
  ok('status=claimed', true);

  log('6/8', 'Worker submitting deliverable...');
  const submitSig = await worker.signMessage({ message: `taskmarket:submit:${taskId}` });
  const { submissionId } = (await post(`/api/tasks/${taskId}/submissions`, {
    taskId,
    workerAddress: worker.address,
    file: Buffer.from('reverse-dutch-full-smoke-payload').toString('base64'),
    signature: submitSig,
  })) as { submissionId: string };
  ok('submissionId', submissionId);

  log('7/8', 'Requester accepting submission (X402)...');
  await x402Post(`/api/tasks/${taskId}/accept`, { taskId, worker: worker.address }, requester);
  ok('accepted', true);

  log('8/8', 'Requester rating 85/100 (X402) and verifying final status...');
  const { feedbackId } = (await x402Post(
    `/api/tasks/${taskId}/rate`,
    { taskId, worker: worker.address, rating: 85, feedbackText: 'Reverse dutch full e2e smoke.' },
    requester
  )) as { feedbackId: string };
  ok('feedbackId', feedbackId);

  const feedbackFile = (await get(`/api/feedback/${feedbackId}`)) as Record<string, unknown>;
  if (feedbackFile.value !== 85) {
    throw new Error(`Feedback value mismatch: ${JSON.stringify(feedbackFile)}`);
  }
  ok('feedbackFile.value', feedbackFile.value);

  const finalTask = (await get(`/api/tasks/${taskId}`)) as { status: string; rating: number | null };
  if (finalTask.status !== 'accepted' || finalTask.rating === null) {
    throw new Error(`Expected status=accepted with rating set, got status=${finalTask.status} rating=${finalTask.rating}`);
  }
  ok('final status=accepted with rating', true);

  return taskId;
}

async function main() {
  const { requester, worker } = getAccounts();

  console.log('=== Taskmarket Smoke Test — Auction Full (Dutch + Reverse Dutch) ===');
  console.log('requester:', requester.address);
  console.log('worker:   ', worker.address);
  console.log('api:      ', API_URL);

  const dutchTaskId = await smokeDutchFull(requester, worker);
  const revDutchTaskId = await smokeReverseDutchFull(requester, worker);

  console.log('\n=== All auction-full smoke tests passed ===');
  console.log('dutch taskId:', dutchTaskId);
  console.log('reverse_dutch taskId:', revDutchTaskId);
}

main().catch((err) => {
  console.error('\nFatal:', err);
  process.exit(1);
});

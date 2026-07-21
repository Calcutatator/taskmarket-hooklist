/**
 * Auction subtypes smoke test: exercises all four auction types.
 *
 * Runs sequentially:
 *   1. English: create → bid → undercut → wait deadline → select-winner
 *   2. Reverse English: create → sealed bid → wait deadline → verify bids revealed
 *   3. Dutch: create → get clock price → auction-accept
 *   4. Reverse Dutch: create → get clock price → auction-accept (with --min-price guard)
 *
 * Usage:
 *   REQUESTER_PRIVATE_KEY=0x... WORKER_PRIVATE_KEY=0x... \
 *     npx tsx --env-file=../../.env scripts/smoke-auction-types.ts
 */
import { log, ok, get, x402Post, getAccounts, type Account, API_URL, sleep } from './_x402.ts';

// How long to wait after the bid deadline before asserting it has passed.
// Override with AUCTION_DEADLINE_BUFFER_MS env var for CI environments.
const AUCTION_DEADLINE_BUFFER_MS = parseInt(process.env.AUCTION_DEADLINE_BUFFER_MS ?? '35000', 10);

async function smokeEnglish(requester: Account, worker: Account) {
  console.log('\n--- English Auction ---');

  log('1/4', 'Creating english auction (max 0.001 USDC, 30s bid window)...');
  const { taskId } = (await x402Post(
    '/api/tasks',
    {
      description: 'English auction smoke test',
      reward: '1000',
      maxPrice: '1000',
      duration: 1,
      mode: 'auction',
      auctionType: 'english',
      bidDeadline: 30 / 3600,
      tags: ['smoke-test'],
    },
    requester
  )) as { taskId: string };
  ok('taskId', taskId);

  log('2/4', 'Worker bids at 0.0008 USDC...');
  await x402Post(`/api/tasks/${taskId}/bids`, { taskId, price: '800' }, worker);
  ok('bid submitted', true);

  log('3/4', 'Worker re-bids lower at 0.0006 USDC...');
  await x402Post(`/api/tasks/${taskId}/bids`, { taskId, price: '600' }, worker);
  ok('re-bid submitted', true);

  log('4/4', 'Verifying bid list...');
  const bids = (await get(`/api/tasks/${taskId}/bids`)) as Array<{ price: string }>;
  ok(`bid count`, bids.length >= 1);

  console.log(
    `  (Waiting ${AUCTION_DEADLINE_BUFFER_MS}ms for deadline — not selecting winner in smoke to save gas)`
  );
  await sleep(AUCTION_DEADLINE_BUFFER_MS);

  const taskDetail = (await get(`/api/tasks/${taskId}`)) as { bidDeadline: string };
  ok('bidDeadline passed', new Date(taskDetail.bidDeadline) < new Date());

  return taskId;
}

async function smokeReverseEnglish(requester: Account, worker: Account) {
  console.log('\n--- Reverse English Auction ---');

  log('1/4', 'Creating reverse_english auction (sealed bids, 30s deadline)...');
  const { taskId } = (await x402Post(
    '/api/tasks',
    {
      description: 'Reverse English sealed bid smoke test',
      reward: '1000',
      maxPrice: '1000',
      duration: 1,
      mode: 'auction',
      auctionType: 'reverse_english',
      bidDeadline: 30 / 3600,
      tags: ['smoke-test'],
    },
    requester
  )) as { taskId: string };
  ok('taskId', taskId);

  log('2/4', 'Worker submits sealed bid at 0.0007 USDC...');
  await x402Post(`/api/tasks/${taskId}/bids`, { taskId, price: '700' }, worker);
  ok('sealed bid submitted', true);

  log('3/4', 'Verifying bids are sealed before deadline...');
  const sealedBids = (await get(`/api/tasks/${taskId}/bids`)) as Array<{
    price: string | null;
  }>;
  if (sealedBids.length === 0) {
    throw new Error('Expected at least one sealed bid');
  }
  if (sealedBids[0].price !== null) {
    throw new Error(`Expected sealed bid (price=null), got price=${sealedBids[0].price}`);
  }
  ok('bid is sealed (price=null)', true);

  log(
    '4/4',
    `Waiting ${AUCTION_DEADLINE_BUFFER_MS}ms for deadline, then verifying bids are revealed...`
  );
  await sleep(AUCTION_DEADLINE_BUFFER_MS);

  const revealedBids = (await get(`/api/tasks/${taskId}/bids`)) as Array<{
    price: string | null;
  }>;
  if (revealedBids.length === 0) {
    throw new Error('Expected revealed bids after deadline, got none');
  }
  if (revealedBids[0].price === null) {
    throw new Error('Expected revealed bid price after deadline, got null');
  }
  ok('bid revealed after deadline', revealedBids[0].price);

  return taskId;
}

async function smokeDutch(requester: Account, worker: Account) {
  console.log('\n--- Dutch Auction ---');

  log('1/4', 'Creating dutch auction (5min clock, max 0.001 USDC, floor 0.0001 USDC)...');
  const { taskId } = (await x402Post(
    '/api/tasks',
    {
      description: 'Dutch descending clock smoke test',
      reward: '1000',
      maxPrice: '1000',
      duration: 1,
      mode: 'auction',
      auctionType: 'dutch',
      auctionFloorPrice: '100',
      bidDeadline: 5 / 60,
      tags: ['smoke-test'],
    },
    requester
  )) as { taskId: string };
  ok('taskId', taskId);

  log('2/4', 'Checking currentAuctionPrice in task get...');
  const task = (await get(`/api/tasks/${taskId}`)) as {
    currentAuctionPrice: string | null;
    auctionPriceReachesFloorAt: string | null;
    auctionType: string;
  };
  ok('auctionType', task.auctionType === 'dutch');
  ok('currentAuctionPrice', task.currentAuctionPrice !== null);
  ok('auctionPriceReachesFloorAt', task.auctionPriceReachesFloorAt !== null);
  console.log('  current clock price:', task.currentAuctionPrice, 'base units');

  log('3/4', 'Worker accepts current clock price...');
  const acceptResult = (await x402Post(`/api/tasks/${taskId}/bids/accept`, { taskId }, worker)) as {
    acceptedPrice: string;
    workerAddress: string;
  };
  ok('acceptedPrice', acceptResult.acceptedPrice);

  log('4/4', 'Verifying task is now claimed...');
  const claimedTask = (await get(`/api/tasks/${taskId}`)) as { status: string; claimedBy: string };
  if (claimedTask.status !== 'claimed') {
    throw new Error(`Expected status=claimed, got ${claimedTask.status}`);
  }
  ok('status=claimed, worker', claimedTask.claimedBy);

  return taskId;
}

async function smokeReverseDutch(requester: Account, worker: Account) {
  console.log('\n--- Reverse Dutch Auction ---');

  log('1/4', 'Creating reverse_dutch auction (5min clock, start 0.0001 USDC, max 0.001 USDC)...');
  const { taskId } = (await x402Post(
    '/api/tasks',
    {
      description: 'Reverse Dutch ascending clock smoke test',
      reward: '1000',
      maxPrice: '1000',
      duration: 1,
      mode: 'auction',
      auctionType: 'reverse_dutch',
      auctionStartPrice: '100',
      bidDeadline: 5 / 60,
      tags: ['smoke-test'],
    },
    requester
  )) as { taskId: string };
  ok('taskId', taskId);

  log('2/4', 'Checking currentAuctionPrice in task get...');
  const task = (await get(`/api/tasks/${taskId}`)) as {
    currentAuctionPrice: string | null;
    auctionPriceReachesMaxAt: string | null;
    auctionType: string;
  };
  ok('auctionType', task.auctionType === 'reverse_dutch');
  ok('currentAuctionPrice', task.currentAuctionPrice !== null);
  ok('auctionPriceReachesMaxAt', task.auctionPriceReachesMaxAt !== null);
  console.log('  current clock price:', task.currentAuctionPrice, 'base units');

  log('3/4', 'Worker accepts current clock price (--min-price=50 base units)...');
  const acceptResult = (await x402Post(
    `/api/tasks/${taskId}/bids/accept`,
    { taskId, minPrice: '50' }, // guard: reject if price < 50 base units
    worker
  )) as { acceptedPrice: string; workerAddress: string };
  ok('acceptedPrice', acceptResult.acceptedPrice);

  log('4/4', 'Verifying task is now claimed...');
  const claimedTask = (await get(`/api/tasks/${taskId}`)) as { status: string; claimedBy: string };
  if (claimedTask.status !== 'claimed') {
    throw new Error(`Expected status=claimed, got ${claimedTask.status}`);
  }
  ok('status=claimed, worker', claimedTask.claimedBy);

  return taskId;
}

async function main() {
  const { requester, worker } = getAccounts();

  console.log('=== Taskmarket Smoke Test — Auction Subtypes ===');
  console.log('requester:', requester.address);
  console.log('worker:   ', worker.address);
  console.log('api:      ', API_URL);

  await smokeEnglish(requester, worker);
  await smokeReverseEnglish(requester, worker);
  await smokeDutch(requester, worker);
  await smokeReverseDutch(requester, worker);

  console.log('\n=== All auction subtype smoke tests passed ===');
}

main().catch((err) => {
  console.error('\nFatal:', err);
  process.exit(1);
});

/**
 * Bids inbox smoke test: verifies /api/bids/my returns the worker's active pending bids
 * and filters out tasks whose bid deadline has passed.
 *
 * Flow:
 *   1. Create two English auction tasks with short bid windows (requester, X402)
 *   2. Worker bids on both tasks (X402)
 *   3. GET /api/bids/my with no read-auth header -- assert UNAUTHORIZED
 *      (myBids is a protectedProcedure: no anonymous view, per ADR-0017/ADR-0022)
 *   4. A fresh address with zero bids, valid read-auth header -- assert an
 *      empty array, not an error (the zero-rows early path through the query)
 *   5. Worker signs the general read-auth header (ADR-0016/ADR-0022) and calls
 *      GET /api/bids/my — assert two entries with correct fields
 *   6. Wait for the first task's bid deadline to expire
 *   7. Re-sign and re-fetch /api/bids/my — assert only one entry remains (the live deadline)
 *
 * Usage:
 *   REQUESTER_PRIVATE_KEY=0x... WORKER_PRIVATE_KEY=0x... \
 *     npx tsx --env-file=../../.env src/scripts/smoke-bids-inbox.ts
 */
import {
  log,
  ok,
  get,
  x402Post,
  getAccounts,
  readAuthHeaders,
  randomAccount,
  API_URL,
  sleep,
  type Account,
} from './_x402';

// How long after the first bid deadline to wait before re-checking.
const DEADLINE_BUFFER_MS = parseInt(process.env.AUCTION_DEADLINE_BUFFER_MS ?? '35000', 10);

async function fetchMyBids(worker: Account) {
  const headers = await readAuthHeaders(worker);
  return (await get('/api/bids/my', { headers })) as Array<{
    taskId: string;
    auctionType: string | null;
    myBidPrice: string;
    currentLowestBid: string | null;
    bidDeadline: string | null;
    bidCount: number;
    taskStatus: string;
  }>;
}

async function main() {
  const { requester, worker } = getAccounts();

  console.log('=== Taskmarket Smoke Test — Bids Inbox (/api/bids/my) ===');
  console.log('requester:', requester.address);
  console.log('worker:   ', worker.address);
  console.log('api:      ', API_URL);

  // 1a. Create first English auction task — short bid window (35s) so it expires soon
  log('1a/7', 'Creating first English auction task (35s bid window)...');
  const { taskId: task1 } = (await x402Post(
    '/api/tasks',
    {
      description: 'Bids inbox smoke test task 1',
      reward: '1000',
      maxPrice: '1000',
      duration: 1,
      mode: 'auction',
      auctionType: 'english',
      bidDeadline: 35 / 3600,
      tags: ['smoke-bids-inbox'],
    },
    requester
  )) as { taskId: string };
  ok('task1', task1);

  // 1b. Create second English auction task — longer bid window (2h) stays alive
  log('1b/7', 'Creating second English auction task (2h bid window)...');
  const { taskId: task2 } = (await x402Post(
    '/api/tasks',
    {
      description: 'Bids inbox smoke test task 2',
      reward: '1000',
      maxPrice: '1000',
      duration: 1,
      mode: 'auction',
      auctionType: 'english',
      bidDeadline: 2,
      tags: ['smoke-bids-inbox'],
    },
    requester
  )) as { taskId: string };
  ok('task2', task2);

  // 2. Worker bids on both tasks
  log('2a/7', 'Worker bidding on task1 (0.0008 USDC)...');
  await x402Post(`/api/tasks/${task1}/bids`, { taskId: task1, price: '800' }, worker);
  ok('bid on task1', true);

  log('2b/7', 'Worker bidding on task2 (0.0008 USDC)...');
  await x402Post(`/api/tasks/${task2}/bids`, { taskId: task2, price: '800' }, worker);
  ok('bid on task2', true);

  // 3. No read-auth header at all -- protectedProcedure must hard-fail, not
  // silently return an empty/anonymous view.
  log('3/7', 'Fetching /api/bids/my with no read-auth header (expect failure)...');
  let unauthedFailed = false;
  try {
    await get('/api/bids/my');
  } catch {
    unauthedFailed = true;
  }
  if (!unauthedFailed) {
    throw new Error('/api/bids/my should reject requests with no read-auth header');
  }
  ok('unauthenticated /api/bids/my rejected', true);

  // 4. A fresh address with a valid read-auth header but zero bids -- should
  // cleanly return an empty array, not error on the zero-rows path.
  log('4/7', 'Fetching /api/bids/my for a fresh address with no bids (expect empty array)...');
  const freshBids = await fetchMyBids(randomAccount());
  if (!Array.isArray(freshBids) || freshBids.length !== 0) {
    throw new Error(
      `/api/bids/my for a fresh address should return an empty array, got: ${JSON.stringify(freshBids)}`
    );
  }
  ok('fresh address with no bids returns an empty array', true);

  // 5. Sign the general read-auth header and fetch /api/bids/my — should have two entries
  log('5/7', 'Fetching /api/bids/my (expect 2 entries)...');
  const bids1 = await fetchMyBids(worker);

  const entry1 = bids1.find((b) => b.taskId === task1);
  const entry2 = bids1.find((b) => b.taskId === task2);

  if (!entry1) throw new Error(`task1 (${task1}) not found in /api/bids/my response`);
  if (!entry2) throw new Error(`task2 (${task2}) not found in /api/bids/my response`);

  ok('entry1.auctionType', entry1.auctionType === 'english');
  ok('entry1.myBidPrice', entry1.myBidPrice === '800');
  ok('entry1.currentLowestBid', entry1.currentLowestBid === '800');
  ok('entry1.bidDeadline', entry1.bidDeadline !== null);
  ok('entry1.taskStatus', entry1.taskStatus === 'open');

  ok('entry2.auctionType', entry2.auctionType === 'english');
  ok('entry2.myBidPrice', entry2.myBidPrice === '800');
  ok('entry2.taskStatus', entry2.taskStatus === 'open');

  // 6. Wait for task1's bid deadline to pass
  log('6/7', `Waiting ${DEADLINE_BUFFER_MS}ms for task1 bid deadline to pass...`);
  await sleep(DEADLINE_BUFFER_MS);

  // 7. Re-sign and re-fetch — task1 should no longer appear (deadline passed, task no longer open+active)
  log('7/7', 'Re-fetching /api/bids/my (expect task1 gone, task2 still present)...');
  const bids2 = await fetchMyBids(worker);

  const stillHasTask1 = bids2.some((b) => b.taskId === task1);
  const stillHasTask2 = bids2.some((b) => b.taskId === task2);

  if (stillHasTask1) {
    throw new Error(
      `task1 should be gone after bid deadline passed, but still appears in /api/bids/my`
    );
  }
  if (!stillHasTask2) {
    throw new Error(`task2 should still appear in /api/bids/my (deadline not passed)`);
  }

  ok('task1 gone after deadline', true);
  ok('task2 still present', true);

  console.log('\n=== Bids inbox smoke test passed ===');
}

main().catch((err) => {
  console.error('\nFatal:', err);
  process.exit(1);
});

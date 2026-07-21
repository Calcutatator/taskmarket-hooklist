/**
 * Bids inbox smoke test: verifies /api/bids/my returns the worker's active pending bids
 * and filters out tasks whose bid deadline has passed.
 *
 * Flow:
 *   1. Create two English auction tasks with short bid windows (requester, X402)
 *   2. Worker bids on both tasks (X402)
 *   3. Worker signs the canonical my-bids self-auth message and calls GET /api/bids/my —
 *      assert two entries with correct fields
 *   4. Wait for the first task's bid deadline to expire
 *   5. Re-sign and re-fetch /api/bids/my — assert only one entry remains (the live deadline)
 *
 * Usage:
 *   REQUESTER_PRIVATE_KEY=0x... WORKER_PRIVATE_KEY=0x... \
 *     npx tsx --env-file=../../.env scripts/smoke-bids-inbox.ts
 */
import { buildMyBidsMessage } from '@taskmarket/shared';
import { log, ok, get, x402Post, getAccounts, API_URL, sleep, type Account } from './_x402.ts';

// How long after the first bid deadline to wait before re-checking.
const DEADLINE_BUFFER_MS = parseInt(process.env.AUCTION_DEADLINE_BUFFER_MS ?? '35000', 10);

async function fetchMyBids(worker: Account) {
  const signature = await worker.signMessage({ message: buildMyBidsMessage(worker.address) });
  return (await get(
    `/api/bids/my?address=${encodeURIComponent(worker.address)}&signature=${encodeURIComponent(signature)}`
  )) as Array<{
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
  log('1a/5', 'Creating first English auction task (35s bid window)...');
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
  log('1b/5', 'Creating second English auction task (2h bid window)...');
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
  log('2a/5', 'Worker bidding on task1 (0.0008 USDC)...');
  await x402Post(`/api/tasks/${task1}/bids`, { taskId: task1, price: '800' }, worker);
  ok('bid on task1', true);

  log('2b/5', 'Worker bidding on task2 (0.0008 USDC)...');
  await x402Post(`/api/tasks/${task2}/bids`, { taskId: task2, price: '800' }, worker);
  ok('bid on task2', true);

  // 3. Sign the canonical my-bids self-auth message and fetch /api/bids/my — should have two entries
  log('3/5', 'Fetching /api/bids/my (expect 2 entries)...');
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

  // 4. Wait for task1's bid deadline to pass
  log('4/5', `Waiting ${DEADLINE_BUFFER_MS}ms for task1 bid deadline to pass...`);
  await sleep(DEADLINE_BUFFER_MS);

  // 5. Re-sign and re-fetch — task1 should no longer appear (deadline passed, task no longer open+active)
  log('5/5', 'Re-fetching /api/bids/my (expect task1 gone, task2 still present)...');
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

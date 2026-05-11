/**
 * Bids inbox smoke test: verifies /api/bids/my returns the worker's active pending bids
 * and filters out tasks whose bid deadline has passed.
 *
 * Flow:
 *   1. Register worker device (POST /api/devices)
 *   2. Create two English auction tasks with short bid windows (requester, X402)
 *   3. Worker bids on both tasks (X402)
 *   4. GET /api/bids/my — assert two entries with correct fields
 *   5. Wait for the first task's bid deadline to expire
 *   6. Re-fetch /api/bids/my — assert only one entry remains (the live deadline)
 *
 * Usage:
 *   REQUESTER_PRIVATE_KEY=0x... WORKER_PRIVATE_KEY=0x... \
 *     npx tsx --env-file=../../.env scripts/smoke-bids-inbox.ts
 */
import { log, ok, get, post, x402Post, getAccounts, API_URL } from './_x402.ts';

// How long after the first bid deadline to wait before re-checking.
const DEADLINE_BUFFER_MS = parseInt(process.env.AUCTION_DEADLINE_BUFFER_MS ?? '35000', 10);

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const { requester, worker } = getAccounts();

  console.log('=== Taskmarket Smoke Test — Bids Inbox (/api/bids/my) ===');
  console.log('requester:', requester.address);
  console.log('worker:   ', worker.address);
  console.log('api:      ', API_URL);

  // 1. Register a device for the worker so we can call /api/bids/my
  log('1/6', 'Registering worker device...');
  const device = (await post('/api/devices', { walletAddress: worker.address })) as {
    deviceId: string;
    apiToken: string;
  };
  ok('deviceId', device.deviceId);

  // 2. Create first English auction task — short bid window (35s) so it expires soon
  log('2a/6', 'Creating first English auction task (35s bid window)...');
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

  // 2b. Create second English auction task — longer bid window (2h) stays alive
  log('2b/6', 'Creating second English auction task (2h bid window)...');
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

  // 3. Worker bids on both tasks
  log('3a/6', 'Worker bidding on task1 (0.0008 USDC)...');
  await x402Post(`/api/tasks/${task1}/bids`, { taskId: task1, price: '800' }, worker);
  ok('bid on task1', true);

  log('3b/6', 'Worker bidding on task2 (0.0008 USDC)...');
  await x402Post(`/api/tasks/${task2}/bids`, { taskId: task2, price: '800' }, worker);
  ok('bid on task2', true);

  // 4. Fetch /api/bids/my — should have two entries
  log('4/6', 'Fetching /api/bids/my (expect 2 entries)...');
  const bids1 = (await get(`/api/bids/my?deviceId=${encodeURIComponent(device.deviceId)}`, {
    headers: { 'x-taskmarket-api-token': device.apiToken },
  })) as Array<{
    taskId: string;
    auctionType: string | null;
    myBidPrice: string;
    currentLowestBid: string | null;
    bidDeadline: string | null;
    bidCount: number;
    taskStatus: string;
  }>;

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

  // 5. Wait for task1's bid deadline to pass
  log('5/6', `Waiting ${DEADLINE_BUFFER_MS}ms for task1 bid deadline to pass...`);
  await sleep(DEADLINE_BUFFER_MS);

  // 6. Re-fetch — task1 should no longer appear (deadline passed, task no longer open+active)
  log('6/6', 'Re-fetching /api/bids/my (expect task1 gone, task2 still present)...');
  const bids2 = (await get(`/api/bids/my?deviceId=${encodeURIComponent(device.deviceId)}`, {
    headers: { 'x-taskmarket-api-token': device.apiToken },
  })) as Array<{ taskId: string }>;

  const stillHasTask1 = bids2.some((b) => b.taskId === task1);
  const stillHasTask2 = bids2.some((b) => b.taskId === task2);

  if (stillHasTask1) {
    throw new Error(`task1 should be gone after bid deadline passed, but still appears in /api/bids/my`);
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

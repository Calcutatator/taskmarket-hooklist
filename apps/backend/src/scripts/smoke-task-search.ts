/**
 * Task search smoke test: verifies the auctionType filter in GET /api/tasks
 * and the presence of auction-specific computed fields.
 *
 * Flow:
 *   1. Create one task per auction subtype (dutch, english, reverse_dutch, reverse_english)
 *   2. Create one bounty task
 *   3. Filter by each auctionType — verify only the correct task is found
 *   4. List without filter — verify all created tasks appear
 *   5. Verify clock price fields on dutch/reverse_dutch tasks
 *   6. Verify bidCount field on english/reverse_english tasks
 *
 * Usage:
 *   REQUESTER_PRIVATE_KEY=0x... WORKER_PRIVATE_KEY=0x... \
 *     npx tsx --env-file=../../.env src/scripts/smoke-task-search.ts
 */
import { log, ok, get, x402Post, getAccounts, API_URL } from './_x402';

type TaskListResponse = {
  tasks: Array<{
    id: string;
    mode: string;
    auctionType: string | null;
    currentAuctionPrice: string | null;
    auctionBidCount: number | null;
  }>;
  hasMore: boolean;
};

async function main() {
  const { requester } = getAccounts();

  console.log('=== Taskmarket Smoke Test — Task Search (auctionType filter) ===');
  console.log('requester:', requester.address);
  console.log('api:      ', API_URL);

  // 1. Create one task per auction subtype
  log('1a/6', 'Creating dutch auction task...');
  const { taskId: dutchId } = (await x402Post(
    '/api/tasks',
    {
      description: 'Task search smoke test — dutch',
      reward: '1000',
      maxPrice: '1000',
      duration: 1,
      mode: 'auction',
      auctionType: 'dutch',
      auctionFloorPrice: '100',
      bidDeadline: 1,
      tags: ['smoke-task-search'],
    },
    requester
  )) as { taskId: string };
  ok('dutch taskId', dutchId);

  log('1b/6', 'Creating english auction task...');
  const { taskId: englishId } = (await x402Post(
    '/api/tasks',
    {
      description: 'Task search smoke test — english',
      reward: '1000',
      maxPrice: '1000',
      duration: 1,
      mode: 'auction',
      auctionType: 'english',
      bidDeadline: 1,
      tags: ['smoke-task-search'],
    },
    requester
  )) as { taskId: string };
  ok('english taskId', englishId);

  log('1c/6', 'Creating reverse_dutch auction task...');
  const { taskId: revDutchId } = (await x402Post(
    '/api/tasks',
    {
      description: 'Task search smoke test — reverse_dutch',
      reward: '1000',
      maxPrice: '1000',
      duration: 1,
      mode: 'auction',
      auctionType: 'reverse_dutch',
      auctionStartPrice: '100',
      bidDeadline: 1,
      tags: ['smoke-task-search'],
    },
    requester
  )) as { taskId: string };
  ok('reverse_dutch taskId', revDutchId);

  log('1d/6', 'Creating reverse_english auction task...');
  const { taskId: revEnglishId } = (await x402Post(
    '/api/tasks',
    {
      description: 'Task search smoke test — reverse_english',
      reward: '1000',
      maxPrice: '1000',
      duration: 1,
      mode: 'auction',
      auctionType: 'reverse_english',
      bidDeadline: 1,
      tags: ['smoke-task-search'],
    },
    requester
  )) as { taskId: string };
  ok('reverse_english taskId', revEnglishId);

  log('1e/6', 'Creating bounty task...');
  const { taskId: bountyId } = (await x402Post(
    '/api/tasks',
    {
      description: 'Task search smoke test — bounty',
      reward: '1000',
      duration: 1,
      mode: 'bounty',
      tags: ['smoke-task-search'],
    },
    requester
  )) as { taskId: string };
  ok('bounty taskId', bountyId);

  const allCreated = [dutchId, englishId, revDutchId, revEnglishId, bountyId];

  // 2. Filter by dutch — only dutch task should appear
  log('2/6', 'Filtering by auctionType=dutch...');
  const dutchList = (await get('/api/tasks?auctionType=dutch&limit=100')) as TaskListResponse;
  const dutchFound = dutchList.tasks.some((t) => t.id === dutchId);
  const nonDutchFound = dutchList.tasks.some(
    (t) => t.id === englishId || t.id === revDutchId || t.id === revEnglishId || t.id === bountyId
  );
  if (!dutchFound) throw new Error(`Dutch task ${dutchId} not found in dutch-filtered list`);
  if (nonDutchFound) throw new Error('Non-dutch tasks appeared in dutch-filtered list');
  ok('dutch filter: correct task found', dutchFound);
  ok('dutch filter: no non-dutch tasks', !nonDutchFound);

  // 3. Filter by english
  log('3/6', 'Filtering by auctionType=english...');
  const englishList = (await get('/api/tasks?auctionType=english&limit=100')) as TaskListResponse;
  if (!englishList.tasks.some((t) => t.id === englishId)) {
    throw new Error(`English task ${englishId} not found in english-filtered list`);
  }
  if (englishList.tasks.some((t) => t.id === dutchId || t.id === revDutchId)) {
    throw new Error('Dutch/reverse_dutch tasks appeared in english-filtered list');
  }
  ok('english filter works', true);

  // 4. Filter by reverse_dutch and reverse_english
  log('4/6', 'Filtering by reverse_dutch and reverse_english...');
  const revDutchList = (await get(
    '/api/tasks?auctionType=reverse_dutch&limit=100'
  )) as TaskListResponse;
  if (!revDutchList.tasks.some((t) => t.id === revDutchId)) {
    throw new Error(`reverse_dutch task not found in reverse_dutch-filtered list`);
  }
  ok('reverse_dutch filter works', true);

  const revEnglishList = (await get(
    '/api/tasks?auctionType=reverse_english&limit=100'
  )) as TaskListResponse;
  if (!revEnglishList.tasks.some((t) => t.id === revEnglishId)) {
    throw new Error(`reverse_english task not found in reverse_english-filtered list`);
  }
  ok('reverse_english filter works', true);

  // 5. No filter — all created tasks should be findable
  log('5/6', 'Listing all tasks (no filter) — verifying all created tasks present...');
  // Use tags filter to scope to our smoke test tasks
  const allList = (await get('/api/tasks?limit=100')) as TaskListResponse;
  for (const id of allCreated) {
    if (!allList.tasks.some((t) => t.id === id)) {
      throw new Error(`Task ${id} not found in unfiltered list (may need to increase limit)`);
    }
  }
  ok('all created tasks visible without filter', true);

  // 6. Verify computed fields
  log('6/6', 'Verifying computed fields on auction tasks...');

  // Dutch and reverse_dutch should have currentAuctionPrice
  const dutchTask = dutchList.tasks.find((t) => t.id === dutchId);
  if (!dutchTask) throw new Error('Dutch task not in filtered list for field check');
  if (dutchTask.currentAuctionPrice === undefined) {
    throw new Error('Dutch task missing currentAuctionPrice field');
  }
  ok('dutch: currentAuctionPrice field present', dutchTask.currentAuctionPrice !== undefined);

  const revDutchTask = revDutchList.tasks.find((t) => t.id === revDutchId);
  if (!revDutchTask) throw new Error('reverse_dutch task not in filtered list for field check');
  ok(
    'reverse_dutch: currentAuctionPrice field present',
    revDutchTask.currentAuctionPrice !== undefined
  );

  // English and reverse_english should have auctionBidCount
  const englishTask = englishList.tasks.find((t) => t.id === englishId);
  if (!englishTask) throw new Error('English task not in filtered list for field check');
  ok('english: auctionBidCount field present', typeof englishTask.auctionBidCount === 'number');

  const revEnglishTask = revEnglishList.tasks.find((t) => t.id === revEnglishId);
  if (!revEnglishTask) throw new Error('reverse_english task not in filtered list for field check');
  ok(
    'reverse_english: auctionBidCount field present',
    typeof revEnglishTask.auctionBidCount === 'number'
  );

  console.log('\n=== Task search smoke test passed ===');
}

main().catch((err) => {
  console.error('\nFatal:', err);
  process.exit(1);
});

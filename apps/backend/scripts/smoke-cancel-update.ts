/**
 * Cancel/update smoke test: covers cancel, update (off-chain and on-chain), and error cases.
 *
 * Usage:
 *   REQUESTER_PRIVATE_KEY=0x... WORKER_PRIVATE_KEY=0x... \
 *     npx tsx --env-file=../../.env scripts/smoke-cancel-update.ts
 */
import { log, ok, get, post, x402Post, getAccounts, API_URL } from './_x402.ts';

async function main() {
  const { requester, worker } = getAccounts();

  console.log('=== Taskmarket Smoke Test — Cancel/Update ===');
  console.log('requester:', requester.address);
  console.log('worker:   ', worker.address);
  console.log('api:      ', API_URL);

  // 1. Create bounty → cancel → verify status
  log('1/7', 'Creating bounty task...');
  const { taskId: task1 } = (await x402Post(
    '/api/tasks',
    {
      description: 'Cancel test task',
      reward: '1000',
      duration: 1,
      mode: 'bounty',
      tags: ['smoke-cancel'],
    },
    requester
  )) as { taskId: string };
  ok('taskId', task1);

  log('1/7', 'Cancelling task...');
  const cancelResult = (await x402Post(
    `/api/tasks/${task1}/cancel`,
    { taskId: task1 },
    requester
  )) as {
    txHash: string;
  };
  ok('txHash', cancelResult.txHash);

  const t1 = (await get(`/api/tasks/${task1}`)) as { status: string };
  if (t1.status !== 'cancelled') throw new Error(`Expected cancelled, got ${t1.status}`);
  ok('status', t1.status);

  // 2. Create bounty → update title/description (off-chain only)
  log('2/7', 'Creating bounty task for off-chain update...');
  const { taskId: task2 } = (await x402Post(
    '/api/tasks',
    {
      description: 'Original description',
      reward: '1000',
      duration: 1,
      mode: 'bounty',
      tags: ['smoke-cancel'],
    },
    requester
  )) as { taskId: string };
  ok('taskId', task2);

  log('2/7', 'Updating description (off-chain)...');
  const updateResult2 = (await x402Post(
    `/api/tasks/${task2}/update`,
    { taskId: task2, description: 'Updated description' },
    requester
  )) as { description: string };
  if (updateResult2.description !== 'Updated description') {
    throw new Error(`Description not updated: ${updateResult2.description}`);
  }
  ok('description', updateResult2.description);

  // 3. Create bounty → increase reward (on-chain)
  log('3/7', 'Creating bounty task for reward increase...');
  const { taskId: task3 } = (await x402Post(
    '/api/tasks',
    {
      description: 'Reward increase test',
      reward: '1000',
      duration: 1,
      mode: 'bounty',
      tags: ['smoke-cancel'],
    },
    requester
  )) as { taskId: string };
  ok('taskId', task3);

  log('3/7', 'Increasing reward to 2000...');
  const updateResult3 = (await x402Post(
    `/api/tasks/${task3}/update`,
    { taskId: task3, reward: '2000' },
    requester
  )) as { reward: string };
  if (updateResult3.reward !== '2000') {
    throw new Error(`Reward not updated: ${updateResult3.reward}`);
  }
  ok('reward', updateResult3.reward);

  // 4. Create bounty → decrease reward (partial refund)
  log('4/7', 'Creating bounty task for reward decrease...');
  const { taskId: task4 } = (await x402Post(
    '/api/tasks',
    {
      description: 'Reward decrease test',
      reward: '2000',
      duration: 1,
      mode: 'bounty',
      tags: ['smoke-cancel'],
    },
    requester
  )) as { taskId: string };
  ok('taskId', task4);

  log('4/7', 'Decreasing reward to 1000...');
  const updateResult4 = (await x402Post(
    `/api/tasks/${task4}/update`,
    { taskId: task4, reward: '1000' },
    requester
  )) as { reward: string };
  if (updateResult4.reward !== '1000') {
    throw new Error(`Reward not updated: ${updateResult4.reward}`);
  }
  ok('reward', updateResult4.reward);

  // 5. Create auction → submit bid → attempt cancel → expect error
  log('5/7', 'Creating auction task...');
  const { taskId: task5 } = (await x402Post(
    '/api/tasks',
    {
      description: 'Auction cancel with bids test',
      reward: '1000',
      maxPrice: '1000',
      duration: 1,
      mode: 'auction',
      auctionType: 'english',
      bidDeadline: 1,
      tags: ['smoke-cancel'],
    },
    requester
  )) as { taskId: string };
  ok('taskId', task5);

  log('5/7', 'Submitting bid...');
  await x402Post(`/api/tasks/${task5}/bids`, { taskId: task5, price: '800' }, worker);
  ok('bid submitted', true);

  log('5/7', 'Attempting cancel with bids (should fail)...');
  try {
    await x402Post(`/api/tasks/${task5}/cancel`, { taskId: task5 }, requester);
    throw new Error('Expected cancel to fail but it succeeded');
  } catch (err) {
    if (err instanceof Error && err.message.includes('Bids exist')) {
      ok('error caught', 'Bids exist');
    } else {
      throw err;
    }
  }

  // 6. Create claim → claim it → attempt cancel → expect error
  log('6/7', 'Creating claim task...');
  const { taskId: task6 } = (await x402Post(
    '/api/tasks',
    {
      description: 'Claim task cancel test',
      reward: '1000',
      duration: 1,
      mode: 'claim',
      tags: ['smoke-cancel'],
    },
    requester
  )) as { taskId: string };
  ok('taskId', task6);

  log('6/7', 'Claiming task...');
  const claimSig6 = await worker.signMessage({ message: `taskmarket:claim:${task6}` });
  await post(`/api/tasks/${task6}/claim`, {
    taskId: task6,
    workerAddress: worker.address,
    signature: claimSig6,
  });
  ok('claimed', true);

  log('6/7', 'Attempting cancel on claimed task (should fail)...');
  try {
    await x402Post(`/api/tasks/${task6}/cancel`, { taskId: task6 }, requester);
    throw new Error('Expected cancel to fail but it succeeded');
  } catch (err) {
    // taskActionPreflight (services/task-action-preflight.ts) intercepts before
    // the router mutation now, with "Task is not open" -- not the router's own
    // "Task not open" duplicate check, which this path no longer reaches.
    if (err instanceof Error && err.message.includes('Task is not open')) {
      ok('error caught', 'Task is not open');
    } else {
      throw err;
    }
  }

  // 7. Create auction (no bids) → cancel → verify
  log('7/7', 'Creating auction task (no bids)...');
  const { taskId: task7 } = (await x402Post(
    '/api/tasks',
    {
      description: 'Auction cancel no bids test',
      reward: '1000',
      maxPrice: '1000',
      duration: 1,
      mode: 'auction',
      auctionType: 'english',
      bidDeadline: 1,
      tags: ['smoke-cancel'],
    },
    requester
  )) as { taskId: string };
  ok('taskId', task7);

  log('7/7', 'Cancelling auction with no bids...');
  const cancelResult7 = (await x402Post(
    `/api/tasks/${task7}/cancel`,
    { taskId: task7 },
    requester
  )) as { txHash: string };
  ok('txHash', cancelResult7.txHash);

  const t7 = (await get(`/api/tasks/${task7}`)) as { status: string };
  if (t7.status !== 'cancelled') throw new Error(`Expected cancelled, got ${t7.status}`);
  ok('status', t7.status);

  console.log('\n=== All cancel/update smoke tests passed ===');
}

main().catch((err) => {
  console.error('\nSmoke test failed:', err);
  process.exit(1);
});

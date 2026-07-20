/**
 * Task visibility smoke test (ADR-0014, ADR-0015): verifies an 'unlisted'
 * task is hidden from Taskmarket's own discovery surfaces while staying
 * reachable by direct link, and that only the owner -- proven via the
 * agents.inbox self-auth signature -- can see it in their own inbox.
 *
 * Steps:
 *  1. Create one unlisted task and one public control task (requester)
 *  2. List/search (GET /api/tasks) as a third party -- unlisted task absent,
 *     public control task present
 *  3. Fetch the unlisted task directly by ID -- still reachable (visibility
 *     only opts out of discovery, never out of direct access)
 *  4. Requester checks their own inbox with no signature -- unlisted task
 *     absent (same as any third party, no free pass just for being the
 *     requester)
 *  5. Requester checks their own inbox with a valid `taskmarket:inbox:<address>`
 *     signature -- unlisted task now appears in asRequester
 *  6. A signature from a different account does not unlock it
 *
 * Usage:
 *   REQUESTER_PRIVATE_KEY=0x... WORKER_PRIVATE_KEY=0x... \
 *     npx tsx --env-file=../../.env scripts/smoke-visibility.ts
 */
import { log, ok, get, x402Post, getAccounts, API_URL } from './_x402.ts';

type TaskListResponse = {
  tasks: Array<{ id: string }>;
};

type InboxResponse = {
  asRequester: Array<{ id: string; taskVisibilityMode?: string }>;
  asWorker: Array<{ id: string }>;
};

async function main() {
  const { requester, worker } = getAccounts();

  console.log('=== Taskmarket Smoke Test — Task Visibility ===');
  console.log('requester:', requester.address);
  console.log('worker:   ', worker.address);
  console.log('api:      ', API_URL);

  // 1. Create one unlisted task and one public control task.
  log('1/6', 'Creating unlisted task...');
  const { taskId: unlistedId } = (await x402Post(
    '/api/tasks',
    {
      description: 'Visibility smoke test — unlisted',
      reward: '1000',
      duration: 1,
      mode: 'bounty',
      taskVisibilityMode: 'unlisted',
      tags: ['smoke-visibility'],
    },
    requester
  )) as { taskId: string };
  ok('unlisted taskId', unlistedId);

  log('1b/6', 'Creating public control task...');
  const { taskId: publicId } = (await x402Post(
    '/api/tasks',
    {
      description: 'Visibility smoke test — public control',
      reward: '1000',
      duration: 1,
      mode: 'bounty',
      tags: ['smoke-visibility'],
    },
    requester
  )) as { taskId: string };
  ok('public taskId', publicId);

  // 2. List/search as a third party. No tags filter -- array query-param
  // encoding for the openapi bridge isn't exercised elsewhere in these smoke
  // tests, so this checks membership by ID over the unfiltered page instead.
  log('2/6', 'Listing tasks (GET /api/tasks) as a third party...');
  const list = (await get('/api/tasks?limit=100')) as TaskListResponse;
  const unlistedInList = list.tasks.some((t) => t.id === unlistedId);
  const publicInList = list.tasks.some((t) => t.id === publicId);
  if (unlistedInList) throw new Error(`Unlisted task ${unlistedId} appeared in tasks.list`);
  if (!publicInList) throw new Error(`Public control task ${publicId} missing from tasks.list`);
  ok('unlisted task absent from tasks.list', !unlistedInList);
  ok('public control task present in tasks.list', publicInList);

  // 3. Direct fetch by ID stays reachable regardless of visibility.
  log('3/6', 'Fetching unlisted task directly by ID...');
  const direct = (await get(`/api/tasks/${unlistedId}`)) as { id: string };
  if (direct.id !== unlistedId)
    throw new Error('Direct fetch by ID did not return the unlisted task');
  ok('unlisted task reachable by direct ID', true);

  // 4. Requester's own inbox, unauthenticated -- no free pass.
  log('4/6', "Checking requester's own inbox with no signature...");
  const inboxNoAuth = (await get(
    `/api/agents/inbox?address=${encodeURIComponent(requester.address)}`
  )) as InboxResponse;
  const unlistedInUnauthedInbox = inboxNoAuth.asRequester.some((t) => t.id === unlistedId);
  if (unlistedInUnauthedInbox) {
    throw new Error('Unlisted task visible in inbox without a self-auth signature');
  }
  ok('unlisted task absent from unauthenticated inbox', !unlistedInUnauthedInbox);
  ok(
    'public control task still present in unauthenticated inbox',
    inboxNoAuth.asRequester.some((t) => t.id === publicId)
  );

  // 5. Requester's own inbox, with a valid self-auth signature (ADR-0015).
  log('5/6', 'Checking inbox with a valid taskmarket:inbox self-auth signature...');
  const validSig = await requester.signMessage({
    message: `taskmarket:inbox:${requester.address}`,
  });
  const inboxAuthed = (await get(
    `/api/agents/inbox?address=${encodeURIComponent(requester.address)}&signature=${encodeURIComponent(validSig)}`
  )) as InboxResponse;
  const unlistedInAuthedInbox = inboxAuthed.asRequester.some((t) => t.id === unlistedId);
  if (!unlistedInAuthedInbox) {
    throw new Error('Unlisted task missing from inbox despite a valid self-auth signature');
  }
  ok('unlisted task visible with a valid self-auth signature', true);

  // 6. A signature from a different account must not unlock it.
  log('6/6', 'Checking inbox with a mismatched signature (signed by worker, not requester)...');
  const mismatchedSig = await worker.signMessage({
    message: `taskmarket:inbox:${requester.address}`,
  });
  const inboxMismatched = (await get(
    `/api/agents/inbox?address=${encodeURIComponent(requester.address)}&signature=${encodeURIComponent(mismatchedSig)}`
  )) as InboxResponse;
  const unlistedWithMismatch = inboxMismatched.asRequester.some((t) => t.id === unlistedId);
  if (unlistedWithMismatch) {
    throw new Error('Unlisted task visible with a signature from a different account');
  }
  ok('mismatched signature does not unlock the unlisted task', !unlistedWithMismatch);

  console.log('\n=== Task visibility smoke test passed ===');
  console.log('unlistedTaskId:', unlistedId);
  console.log('publicTaskId:  ', publicId);
}

main().catch((err) => {
  console.error('\nFatal:', err);
  process.exit(1);
});

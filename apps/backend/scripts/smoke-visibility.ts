/**
 * Task visibility smoke test (ADR-0014, ADR-0016/ADR-0022): verifies an
 * 'unlisted' task is hidden from Taskmarket's own discovery surfaces while
 * staying reachable by direct link, and that only the owner -- proven via the
 * general read-auth header (agents.inbox's ctx.caller check) -- can see it in
 * their own inbox, on BOTH the requester side (asRequester) and the worker
 * side (asWorker): `agents.inbox` applies the same unlisted-task filter to
 * both halves of the response, so a worker who worked on an unlisted task
 * needs to prove ownership of their own address just like the requester does.
 *
 * Steps:
 *  1. Create one unlisted task and one public control task (requester)
 *  2. List/search (GET /api/tasks) as a third party -- unlisted task absent,
 *     public control task present
 *  3. Fetch the unlisted task directly by ID -- still reachable (visibility
 *     only opts out of discovery, never out of direct access)
 *  4. Requester checks their own inbox with no read-auth header -- unlisted
 *     task absent (same as any third party, no free pass just for being the
 *     requester)
 *  5. Requester checks their own inbox with a valid read-auth header --
 *     unlisted task now appears in asRequester
 *  6. A signature from a different account does not unlock it
 *  7. Worker submits to the unlisted task and is accepted (records a
 *     task_awards row linking worker.address to the task)
 *  8. Worker's own inbox, unauthenticated -- unlisted task absent from
 *     asWorker (no free pass for being the linked worker either)
 *  9. Worker's own inbox, with a valid read-auth header -- unlisted task now
 *     appears in asWorker
 *
 * Usage:
 *   REQUESTER_PRIVATE_KEY=0x... WORKER_PRIVATE_KEY=0x... \
 *     npx tsx --env-file=../../.env scripts/smoke-visibility.ts
 */
import { buildReadAuthMessage } from '@taskmarket/shared';
import {
  log,
  ok,
  get,
  post,
  x402Post,
  getAccounts,
  readAuthHeaders,
  pollTaskStatus,
  API_URL,
} from './_x402.ts';

type TaskListResponse = {
  tasks: Array<{ id: string }>;
};

type InboxResponse = {
  asRequester: Array<{ id: string; taskVisibility?: string }>;
  asWorker: Array<{ id: string }>;
};

async function main() {
  const { requester, worker } = getAccounts();

  console.log('=== Taskmarket Smoke Test — Task Visibility ===');
  console.log('requester:', requester.address);
  console.log('worker:   ', worker.address);
  console.log('api:      ', API_URL);

  // 1. Create one unlisted task and one public control task.
  log('1/9', 'Creating unlisted task...');
  const { taskId: unlistedId } = (await x402Post(
    '/api/tasks',
    {
      description: 'Visibility smoke test — unlisted',
      reward: '1000',
      duration: 1,
      mode: 'bounty',
      taskVisibility: 'unlisted',
      tags: ['smoke-visibility'],
    },
    requester
  )) as { taskId: string };
  ok('unlisted taskId', unlistedId);

  log('1b/9', 'Creating public control task...');
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
  log('2/9', 'Listing tasks (GET /api/tasks) as a third party...');
  const list = (await get('/api/tasks?limit=100')) as TaskListResponse;
  const unlistedInList = list.tasks.some((t) => t.id === unlistedId);
  const publicInList = list.tasks.some((t) => t.id === publicId);
  if (unlistedInList) throw new Error(`Unlisted task ${unlistedId} appeared in tasks.list`);
  if (!publicInList) throw new Error(`Public control task ${publicId} missing from tasks.list`);
  ok('unlisted task absent from tasks.list', !unlistedInList);
  ok('public control task present in tasks.list', publicInList);

  // 3. Direct fetch by ID stays reachable regardless of visibility.
  log('3/9', 'Fetching unlisted task directly by ID...');
  const direct = (await get(`/api/tasks/${unlistedId}`)) as { id: string };
  if (direct.id !== unlistedId)
    throw new Error('Direct fetch by ID did not return the unlisted task');
  ok('unlisted task reachable by direct ID', true);

  // 4. Requester's own inbox, unauthenticated -- no free pass.
  log('4/9', "Checking requester's own inbox with no read-auth header...");
  const inboxNoAuth = (await get(
    `/api/agents/inbox?address=${encodeURIComponent(requester.address)}`
  )) as InboxResponse;
  const unlistedInUnauthedInbox = inboxNoAuth.asRequester.some((t) => t.id === unlistedId);
  if (unlistedInUnauthedInbox) {
    throw new Error('Unlisted task visible in inbox without a read-auth header');
  }
  ok('unlisted task absent from unauthenticated inbox', !unlistedInUnauthedInbox);
  ok(
    'public control task still present in unauthenticated inbox',
    inboxNoAuth.asRequester.some((t) => t.id === publicId)
  );

  // 5. Requester's own inbox, with a valid read-auth header (ADR-0016/ADR-0022).
  log('5/9', 'Checking inbox with a valid read-auth header...');
  const inboxAuthed = (await get(
    `/api/agents/inbox?address=${encodeURIComponent(requester.address)}`,
    { headers: await readAuthHeaders(requester) }
  )) as InboxResponse;
  const unlistedInAuthedInbox = inboxAuthed.asRequester.some((t) => t.id === unlistedId);
  if (!unlistedInAuthedInbox) {
    throw new Error('Unlisted task missing from inbox despite a valid read-auth header');
  }
  ok('unlisted task visible with a valid read-auth header', true);

  // 6. A signature from a different account must not unlock it.
  log(
    '6/9',
    'Checking inbox with a mismatched read-auth header (signed by worker, not requester)...'
  );
  const mismatchedSignature = await worker.signMessage({
    message: buildReadAuthMessage(requester.address),
  });
  const inboxMismatched = (await get(
    `/api/agents/inbox?address=${encodeURIComponent(requester.address)}`,
    {
      headers: {
        'X-Taskmarket-Caller-Address': requester.address,
        'X-Taskmarket-Caller-Signature': mismatchedSignature,
      },
    }
  )) as InboxResponse;
  const unlistedWithMismatch = inboxMismatched.asRequester.some((t) => t.id === unlistedId);
  if (unlistedWithMismatch) {
    throw new Error('Unlisted task visible with a signature from a different account');
  }
  ok('mismatched signature does not unlock the unlisted task', !unlistedWithMismatch);

  // 7. Worker submits to the unlisted task and is accepted, linking
  // worker.address to it via a task_awards row (the same isWorker match
  // agents.inbox's asWorker query uses).
  log('7/9', 'Worker submitting to the unlisted task...');
  const submitSig = await worker.signMessage({ message: `taskmarket:submit:${unlistedId}` });
  await post(`/api/tasks/${unlistedId}/submissions`, {
    taskId: unlistedId,
    workerAddress: worker.address,
    artifacts: [
      {
        fileName: 'submission.txt',
        mimeType: 'text/plain',
        role: 'attachment',
        file: Buffer.from('visibility smoke test submission').toString('base64'),
      },
    ],
    signature: submitSig,
  });
  ok('worker submitted to unlisted task', true);

  log('7b/9', 'Requester accepting the submission (X402)...');
  await x402Post(
    `/api/tasks/${unlistedId}/accept`,
    { taskId: unlistedId, worker: worker.address },
    requester
  );
  await pollTaskStatus(unlistedId, 'completed');
  ok('unlisted task completed and awarded to worker', true);

  // 8. Worker's own inbox, unauthenticated -- no free pass for being the
  // linked worker either.
  log('8/9', "Checking worker's own inbox with no read-auth header...");
  const workerInboxNoAuth = (await get(
    `/api/agents/inbox?address=${encodeURIComponent(worker.address)}`
  )) as InboxResponse;
  const unlistedInUnauthedWorkerInbox = workerInboxNoAuth.asWorker.some((t) => t.id === unlistedId);
  if (unlistedInUnauthedWorkerInbox) {
    throw new Error('Unlisted task visible in asWorker without a read-auth header');
  }
  ok('unlisted task absent from unauthenticated asWorker', !unlistedInUnauthedWorkerInbox);

  // 9. Worker's own inbox, with a valid read-auth header -- unlisted task
  // now appears in asWorker.
  log('9/9', "Checking worker's own inbox with a valid read-auth header...");
  const workerInboxAuthed = (await get(
    `/api/agents/inbox?address=${encodeURIComponent(worker.address)}`,
    { headers: await readAuthHeaders(worker) }
  )) as InboxResponse;
  const unlistedInAuthedWorkerInbox = workerInboxAuthed.asWorker.some((t) => t.id === unlistedId);
  if (!unlistedInAuthedWorkerInbox) {
    throw new Error('Unlisted task missing from asWorker despite a valid read-auth header');
  }
  ok('unlisted task visible in asWorker with a valid read-auth header', true);

  console.log('\n=== Task visibility smoke test passed ===');
  console.log('unlistedTaskId:', unlistedId);
  console.log('publicTaskId:  ', publicId);
}

main().catch((err) => {
  console.error('\nFatal:', err);
  process.exit(1);
});

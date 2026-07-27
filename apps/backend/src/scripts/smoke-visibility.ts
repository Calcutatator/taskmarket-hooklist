/**
 * Task visibility smoke test (ADR-0014, ADR-0016/ADR-0022, ADR-0030): covers
 * both tiers of Taskmarket's task-visibility model end to end against a live
 * backend.
 *
 * Part A (steps 1-9, Phase 1/2, 'unlisted'): verifies an 'unlisted' task is
 * hidden from Taskmarket's own discovery surfaces while staying reachable by
 * direct link, and that only the owner -- proven via the general read-auth
 * header (agents.inbox's ctx.caller check) -- can see it in their own inbox,
 * on BOTH the requester side (asRequester) and the worker side (asWorker):
 * `agents.inbox` applies the same unlisted-task filter to both halves of the
 * response, so a worker who worked on an unlisted task needs to prove
 * ownership of their own address just like the requester does.
 *
 * Part B (steps 10-19, Phase 3, 'private'): verifies a 'private' task is
 * genuinely access-controlled, not just discovery-hidden -- hidden from
 * tasks.list and from an unrelated caller's direct fetch even when signed,
 * viewable only by the requester, allowlisted wallet(s), and a caller
 * holding a valid password-unlock grant -- and that this same gate is
 * composed into a retrofitted sibling endpoint (bids.listByTask), not just
 * tasks.get itself.
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
 *  10. Create three private tasks: allowlist-only, password-only, both
 *      mechanisms (plus a fresh public control task)
 *  11. List tasks as a third party -- all three private tasks absent, both
 *      public control tasks present
 *  12. Requester's own inbox with a valid read-auth header -- sees all three
 *      private tasks
 *  13. Allowlisted worker's inbox with a valid read-auth header -- sees the
 *      two allowlist tasks in invitedPrivateTasks, but not the
 *      password-only one
 *  14. A validly-signed but non-allowlisted caller still can't view any of
 *      the three via direct fetch (proves canView isn't fooled by "any
 *      authenticated caller")
 *  15. Wrong password against the password-only task is rejected with a
 *      generic error; the same generic error is returned for a nonexistent
 *      task (no existence leak)
 *  16. Repeated wrong guesses against the password-only task hit the rate
 *      limit (TOO_MANY_REQUESTS)
 *  17. Correct password against the both-mechanisms task issues a grant; an
 *      otherwise-anonymous request carrying just the grant header can now
 *      fetch that task directly
 *  18. That same grant does not unlock a different private task
 *      (task-scoped)
 *  19. Spot-check a retrofitted sibling endpoint: bids.listByTask on the
 *      auction-mode both-mechanisms task -- an outsider gets an empty list,
 *      the requester's own signed read does not
 *
 * Usage:
 *   REQUESTER_PRIVATE_KEY=0x... WORKER_PRIVATE_KEY=0x... \
 *     npx tsx --env-file=../../.env src/scripts/smoke-visibility.ts
 */
import { buildReadAuthMessage, TASK_ACCESS_GRANT_HEADER } from '@taskmarket/shared';
import {
  log,
  ok,
  get,
  post,
  x402Post,
  getAccounts,
  randomAccount,
  readAuthHeaders,
  pollTaskStatus,
  API_URL,
} from './_x402';

type TaskListResponse = {
  tasks: Array<{ id: string }>;
};

type InboxResponse = {
  asRequester: Array<{ id: string; taskVisibility?: string }>;
  asWorker: Array<{ id: string }>;
  invitedPrivateTasks: Array<{ id: string }>;
};

const PRIVATE_PASSWORD = 'correct horse battery staple';

async function main() {
  const { requester, worker } = getAccounts();

  console.log('=== Taskmarket Smoke Test — Task Visibility ===');
  console.log('requester:', requester.address);
  console.log('worker:   ', worker.address);
  console.log('api:      ', API_URL);

  // 1. Create one unlisted task and one public control task.
  log('1/19', 'Creating unlisted task...');
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

  log('1b/19', 'Creating public control task...');
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
  log('2/19', 'Listing tasks (GET /api/tasks) as a third party...');
  const list = (await get('/api/tasks?limit=100')) as TaskListResponse;
  const unlistedInList = list.tasks.some((t) => t.id === unlistedId);
  const publicInList = list.tasks.some((t) => t.id === publicId);
  if (unlistedInList) throw new Error(`Unlisted task ${unlistedId} appeared in tasks.list`);
  if (!publicInList) throw new Error(`Public control task ${publicId} missing from tasks.list`);
  ok('unlisted task absent from tasks.list', !unlistedInList);
  ok('public control task present in tasks.list', publicInList);

  // 3. Direct fetch by ID stays reachable regardless of visibility.
  log('3/19', 'Fetching unlisted task directly by ID...');
  const direct = (await get(`/api/tasks/${unlistedId}`)) as { id: string };
  if (direct.id !== unlistedId)
    throw new Error('Direct fetch by ID did not return the unlisted task');
  ok('unlisted task reachable by direct ID', true);

  // 4. Requester's own inbox, unauthenticated -- no free pass.
  log('4/19', "Checking requester's own inbox with no read-auth header...");
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
  log('5/19', 'Checking inbox with a valid read-auth header...');
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
    '6/19',
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
  log('7/19', 'Worker submitting to the unlisted task...');
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

  log('7b/19', 'Requester accepting the submission (X402)...');
  await x402Post(
    `/api/tasks/${unlistedId}/accept`,
    { taskId: unlistedId, worker: worker.address },
    requester
  );
  await pollTaskStatus(unlistedId, 'completed');
  ok('unlisted task completed and awarded to worker', true);

  // 8. Worker's own inbox, unauthenticated -- no free pass for being the
  // linked worker either.
  log('8/19', "Checking worker's own inbox with no read-auth header...");
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
  log('9/19', "Checking worker's own inbox with a valid read-auth header...");
  const workerInboxAuthed = (await get(
    `/api/agents/inbox?address=${encodeURIComponent(worker.address)}`,
    { headers: await readAuthHeaders(worker) }
  )) as InboxResponse;
  const unlistedInAuthedWorkerInbox = workerInboxAuthed.asWorker.some((t) => t.id === unlistedId);
  if (!unlistedInAuthedWorkerInbox) {
    throw new Error('Unlisted task missing from asWorker despite a valid read-auth header');
  }
  ok('unlisted task visible in asWorker with a valid read-auth header', true);

  // === Part B: private tasks (Phase 3, ADR-0030) ===
  const outsider = randomAccount();
  console.log('\n--- Part B: private tasks (Phase 3, ADR-0030) ---');
  console.log('outsider:', outsider.address, '(signed, but never allowlisted or invited)');

  // 10. Create three private tasks and a fresh public control task.
  log('10/19', 'Creating allowlist-only private task...');
  const { taskId: allowlistOnlyId } = (await x402Post(
    '/api/tasks',
    {
      description: 'Visibility smoke test — private, allowlist only',
      reward: '1000',
      duration: 1,
      mode: 'bounty',
      taskVisibility: 'private',
      allowedViewers: [worker.address],
      tags: ['smoke-visibility'],
    },
    requester
  )) as { taskId: string };
  ok('allowlist-only taskId', allowlistOnlyId);

  log('10b/19', 'Creating password-only private task...');
  const { taskId: passwordOnlyId } = (await x402Post(
    '/api/tasks',
    {
      description: 'Visibility smoke test — private, password only',
      reward: '1000',
      duration: 1,
      mode: 'bounty',
      taskVisibility: 'private',
      accessPassword: PRIVATE_PASSWORD,
      tags: ['smoke-visibility'],
    },
    requester
  )) as { taskId: string };
  ok('password-only taskId', passwordOnlyId);

  log(
    '10c/19',
    'Creating both-mechanisms private task (auction mode, for the sibling endpoint spot-check)...'
  );
  const { taskId: bothId } = (await x402Post(
    '/api/tasks',
    {
      description: 'Visibility smoke test — private, both mechanisms',
      reward: '1000',
      maxPrice: '1000',
      duration: 1,
      mode: 'auction',
      auctionType: 'english',
      bidDeadline: 30 / 3600,
      taskVisibility: 'private',
      allowedViewers: [worker.address],
      accessPassword: PRIVATE_PASSWORD,
      tags: ['smoke-visibility'],
    },
    requester
  )) as { taskId: string };
  ok('both-mechanisms taskId', bothId);

  log('10d/19', 'Creating a second public control task...');
  const { taskId: publicId2 } = (await x402Post(
    '/api/tasks',
    {
      description: 'Visibility smoke test — public control 2',
      reward: '1000',
      duration: 1,
      mode: 'bounty',
      tags: ['smoke-visibility'],
    },
    requester
  )) as { taskId: string };
  ok('second public control taskId', publicId2);

  // 11. List as a third party -- none of the three private tasks appear;
  // both public control tasks (and the already-completed unlisted task,
  // which stays absent regardless of status) do not include the private
  // ones.
  log('11/19', 'Listing tasks (GET /api/tasks) as a third party...');
  const privateList = (await get('/api/tasks?limit=100')) as TaskListResponse;
  const privateListedIds = new Set(privateList.tasks.map((t) => t.id));
  for (const id of [allowlistOnlyId, passwordOnlyId, bothId]) {
    if (privateListedIds.has(id)) throw new Error(`Private task ${id} appeared in tasks.list`);
  }
  if (!privateListedIds.has(publicId2)) {
    throw new Error('Second public control task missing from tasks.list');
  }
  ok('all three private tasks absent from tasks.list', true);
  ok('public control tasks present in tasks.list', true);

  // 12. Requester's own inbox, signed -- sees all three private tasks.
  log('12/19', "Checking requester's own inbox with a valid read-auth header...");
  const requesterInbox = (await get(
    `/api/agents/inbox?address=${encodeURIComponent(requester.address)}`,
    { headers: await readAuthHeaders(requester) }
  )) as InboxResponse;
  const requesterSeenIds = new Set(requesterInbox.asRequester.map((t) => t.id));
  for (const id of [allowlistOnlyId, passwordOnlyId, bothId]) {
    if (!requesterSeenIds.has(id)) {
      throw new Error(`Requester's own inbox is missing private task ${id}`);
    }
  }
  ok('requester sees all three private tasks in their own inbox', true);

  // 13. Allowlisted worker's inbox -- sees the two allowlist tasks via
  // invitedPrivateTasks, but not the password-only one.
  log('13/19', "Checking allowlisted worker's inbox with a valid read-auth header...");
  const workerInboxForPrivate = (await get(
    `/api/agents/inbox?address=${encodeURIComponent(worker.address)}`,
    { headers: await readAuthHeaders(worker) }
  )) as InboxResponse;
  const invitedIds = new Set(workerInboxForPrivate.invitedPrivateTasks.map((t) => t.id));
  if (!invitedIds.has(allowlistOnlyId)) {
    throw new Error("Allowlist-only task missing from invited worker's invitedPrivateTasks");
  }
  if (!invitedIds.has(bothId)) {
    throw new Error("Both-mechanisms task missing from invited worker's invitedPrivateTasks");
  }
  if (invitedIds.has(passwordOnlyId)) {
    throw new Error('Password-only task incorrectly appeared in a non-allowlisted invite list');
  }
  ok('allowlisted worker sees exactly the tasks they were invited to', true);

  // 14. A validly-signed but non-allowlisted caller still can't view any of
  // the three -- proves canView isn't fooled by "any authenticated caller".
  log('14/19', 'Fetching all three private tasks as a signed-but-uninvited outsider...');
  const outsiderHeaders = await readAuthHeaders(outsider);
  for (const id of [allowlistOnlyId, passwordOnlyId, bothId]) {
    const fetched = (await get(`/api/tasks/${id}`, { headers: outsiderHeaders })) as unknown;
    if (fetched !== null) {
      throw new Error(`Signed outsider could view private task ${id} (expected null)`);
    }
  }
  ok('signed-but-uninvited outsider cannot view any private task', true);

  // 15. Wrong password is rejected generically; a nonexistent task returns
  // the exact same error (no existence leak).
  log('15/19', 'Verifying a wrong password is rejected...');
  let wrongPasswordRejected = false;
  try {
    await post(`/api/tasks/${passwordOnlyId}/private-access/verify`, {
      taskId: passwordOnlyId,
      password: 'definitely wrong',
    });
  } catch (err) {
    wrongPasswordRejected = err instanceof Error && /Invalid task or password/.test(err.message);
  }
  if (!wrongPasswordRejected) throw new Error('Wrong password was not rejected as expected');
  ok('wrong password rejected with a generic error', true);

  log('15b/19', 'Confirming the same generic error for a nonexistent task...');
  let nonexistentRejected = false;
  try {
    await post(`/api/tasks/does-not-exist-${Date.now()}/private-access/verify`, {
      taskId: `does-not-exist-${Date.now()}`,
      password: PRIVATE_PASSWORD,
    });
  } catch (err) {
    nonexistentRejected = err instanceof Error && /Invalid task or password/.test(err.message);
  }
  if (!nonexistentRejected) throw new Error('Nonexistent task did not return the generic error');
  ok('nonexistent task returns the same generic error (no existence leak)', true);

  // 16. Repeated wrong guesses against the same task hit the rate limit.
  // passwordOnlyId already has one wrong-password attempt recorded from step
  // 15 -- keep guessing wrong until the endpoint starts returning
  // TOO_MANY_REQUESTS, with a generous upper bound so this doesn't hang if
  // the limit is ever raised.
  log('16/19', 'Confirming repeated wrong guesses hit the rate limit...');
  let rateLimited = false;
  for (let i = 0; i < 20 && !rateLimited; i++) {
    try {
      await post(`/api/tasks/${passwordOnlyId}/private-access/verify`, {
        taskId: passwordOnlyId,
        password: `still wrong ${i}`,
      });
    } catch (err) {
      if (err instanceof Error && /too many attempts/i.test(err.message)) {
        rateLimited = true;
      }
      // A generic "Invalid task or password" is expected on every attempt
      // before the limit is hit -- keep looping.
    }
  }
  if (!rateLimited) {
    throw new Error('verifyPassword did not rate-limit repeated wrong guesses against one task');
  }
  ok('repeated wrong guesses against one task eventually hit the rate limit', true);

  // 17. Correct password against a DIFFERENT task (bothId, not rate-limited
  // above) issues a grant; an otherwise-anonymous request carrying just the
  // grant header can now fetch that task directly.
  log('17/19', 'Verifying the correct password issues a grant (both-mechanisms task)...');
  const { grant } = (await post(`/api/tasks/${bothId}/private-access/verify`, {
    taskId: bothId,
    password: PRIVATE_PASSWORD,
  })) as { grant: string; expiresAt: string };
  ok('grant issued', `${grant.slice(0, 12)}...`);

  const unlockedFetch = (await get(`/api/tasks/${bothId}`, {
    headers: { [TASK_ACCESS_GRANT_HEADER]: grant },
  })) as { id: string };
  if (unlockedFetch.id !== bothId) {
    throw new Error('Grant did not unlock the both-mechanisms task for an anonymous caller');
  }
  ok('anonymous caller with a valid grant can view the both-mechanisms task', true);

  // 18. That same grant is task-scoped -- it does not unlock a different
  // private task.
  log('18/19', 'Confirming the grant does not unlock a different private task...');
  const crossTaskFetch = (await get(`/api/tasks/${allowlistOnlyId}`, {
    headers: { [TASK_ACCESS_GRANT_HEADER]: grant },
  })) as unknown;
  if (crossTaskFetch !== null) {
    throw new Error('A grant scoped to one task incorrectly unlocked a different private task');
  }
  ok('grant is task-scoped -- does not leak to a different private task', true);

  // 19. Spot-check a retrofitted sibling endpoint: bids.listByTask on the
  // auction-mode both-mechanisms task. The canView gate composes as an AND
  // with the existing sealed-bid logic, not a replacement for it.
  log('19/19', 'Spot-checking bids.listByTask on the auction-mode private task...');
  const outsiderBids = (await get(`/api/tasks/${bothId}/bids`, {
    headers: outsiderHeaders,
  })) as unknown[];
  if (!Array.isArray(outsiderBids) || outsiderBids.length !== 0) {
    throw new Error('bids.listByTask leaked bids to a non-viewable caller on a private task');
  }
  ok('bids.listByTask returns [] for a non-viewable caller on a private task', true);

  const requesterBids = (await get(`/api/tasks/${bothId}/bids`, {
    headers: await readAuthHeaders(requester),
  })) as unknown[];
  if (!Array.isArray(requesterBids)) {
    throw new Error('bids.listByTask did not return an array for the requester');
  }
  ok('bids.listByTask does not deny the requester on their own private task', true);

  console.log('\n=== Task visibility smoke test passed ===');
  console.log('unlistedTaskId:      ', unlistedId);
  console.log('publicTaskId:        ', publicId);
  console.log('allowlistOnlyTaskId: ', allowlistOnlyId);
  console.log('passwordOnlyTaskId:  ', passwordOnlyId);
  console.log('bothMechanismsTaskId:', bothId);
  console.log('publicTaskId2:       ', publicId2);
}

main().catch((err) => {
  console.error('\nFatal:', err);
  process.exit(1);
});

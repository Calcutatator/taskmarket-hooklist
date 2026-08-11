/**
 * Task visibility smoke test (ADR-0014, ADR-0016/ADR-0022, ADR-0030, ADR-0042): covers
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
 * Part C (steps 20-26, PR #314): Part A/B only ever exercise the READ side of
 * private-task access control -- viewing. They never attempt an uninvited
 * outsider actually participating in a private task by submitting, bidding,
 * pitching, proving, or claiming. That write-path gap (an outsider who merely
 * learns a private task's id could still act on it, since the on-chain escrow
 * contract has no concept of privacy) is what PR #314 closed at five separate
 * endpoints, and it was previously only unit-tested with a mocked DB/context --
 * never end to end against a live backend. Part C covers all five endpoints,
 * both the rejected (outsider) and accepted (allowlisted worker) side of each,
 * plus a regression check for the pre-auth-oracle fix in #314's follow-up
 * commit (step 26).
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
 *  19b. Assigned evaluator and dispute resolver can directly read a private
 *      task and its never-mode submission; an outsider cannot read either,
 *      and the task remains absent from public discovery
 *  20. An outsider cannot submit work on a private (allowlist-only) bounty
 *      task; the allowlisted worker can
 *  21. An outsider cannot bid on a private (both-mechanisms, english) auction
 *      task; the allowlisted worker can
 *  22. An outsider cannot auction-accept a private dutch-auction task; the
 *      allowlisted worker can -- this endpoint had zero private-task check
 *      before #314
 *  23. An outsider cannot submit a pitch on a private pitch task; the
 *      allowlisted worker can
 *  24. An outsider cannot submit a proof on a private benchmark task; the
 *      allowlisted worker can
 *  25. An outsider cannot claim a private claim task; the allowlisted worker
 *      can, and the task moves to 'claimed'
 *  26. Regression check for the claimedBy pre-auth oracle fix: an outsider
 *      submitting with a signature that does not match their claimed address
 *      gets a signature error, not the claimedBy-mismatch or private-task
 *      FORBIDDEN message -- confirming an attacker can't distinguish "wrong
 *      worker" from "bad signature" without first proving key ownership
 *
 * Usage:
 *   REQUESTER_PRIVATE_KEY=0x... WORKER_PRIVATE_KEY=0x... \
 *     npx tsx --env-file=../../.env src/scripts/smoke-visibility.ts
 */
import { createHash } from 'crypto';
import {
  buildReadAuthMessage,
  buildSubmitMessage,
  buildClaimMessage,
  TASK_ACCESS_GRANT_HEADER,
} from '@taskmarket/shared';

function contentHash(payload: string): string {
  return createHash('sha256').update(Buffer.from(payload)).digest('hex');
}
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
  fundWithUsdc,
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

/**
 * Runs `fn`, asserting it rejects with an error whose message contains
 * `expectedSubstring` -- the shared shape behind Part C's write-path
 * authorization checks (each one is "call an endpoint, expect FORBIDDEN with
 * this exact message", same pattern steps 15/16 use inline for the
 * password-verify checks, generalized since Part C repeats it five times).
 */
async function assertRejects(
  fn: () => Promise<unknown>,
  expectedSubstring: string,
  label: string
): Promise<void> {
  try {
    await fn();
  } catch (err) {
    if (err instanceof Error && err.message.includes(expectedSubstring)) {
      ok(label, true);
      return;
    }
    throw new Error(
      `${label}: expected an error containing "${expectedSubstring}", got: ${err instanceof Error ? err.message : err}`
    );
  }
  throw new Error(
    `${label}: expected a rejection containing "${expectedSubstring}", but the call succeeded`
  );
}

// Verifies: ADR-0042
async function main() {
  const { requester, worker } = getAccounts();

  console.log('=== Taskmarket Smoke Test — Task Visibility ===');
  console.log('requester:', requester.address);
  console.log('worker:   ', worker.address);
  console.log('api:      ', API_URL);

  // 1. Create one unlisted task and one public control task.
  log('1/26', 'Creating unlisted task...');
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

  log('1b/26', 'Creating public control task...');
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
  log('2/26', 'Listing tasks (GET /api/tasks) as a third party...');
  const list = (await get('/api/tasks?limit=100')) as TaskListResponse;
  const unlistedInList = list.tasks.some((t) => t.id === unlistedId);
  const publicInList = list.tasks.some((t) => t.id === publicId);
  if (unlistedInList) throw new Error(`Unlisted task ${unlistedId} appeared in tasks.list`);
  if (!publicInList) throw new Error(`Public control task ${publicId} missing from tasks.list`);
  ok('unlisted task absent from tasks.list', !unlistedInList);
  ok('public control task present in tasks.list', publicInList);

  // 3. Direct fetch by ID stays reachable regardless of visibility.
  log('3/26', 'Fetching unlisted task directly by ID...');
  const direct = (await get(`/api/tasks/${unlistedId}`)) as { id: string };
  if (direct.id !== unlistedId)
    throw new Error('Direct fetch by ID did not return the unlisted task');
  ok('unlisted task reachable by direct ID', true);

  // 4. Requester's own inbox, unauthenticated -- no free pass.
  log('4/26', "Checking requester's own inbox with no read-auth header...");
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
  log('5/26', 'Checking inbox with a valid read-auth header...');
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
    '6/26',
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
  log('7/26', 'Worker submitting to the unlisted task...');
  const unlistedPayload = 'visibility smoke test submission';
  const submitSig = await worker.signMessage({
    message: buildSubmitMessage(unlistedId, [contentHash(unlistedPayload)]),
  });
  await post(`/api/tasks/${unlistedId}/submissions`, {
    taskId: unlistedId,
    workerAddress: worker.address,
    artifacts: [
      {
        fileName: 'submission.txt',
        mimeType: 'text/plain',
        role: 'attachment',
        file: Buffer.from(unlistedPayload).toString('base64'),
      },
    ],
    signature: submitSig,
  });
  ok('worker submitted to unlisted task', true);

  log('7b/26', 'Requester accepting the submission (X402)...');
  await x402Post(
    `/api/tasks/${unlistedId}/accept`,
    { taskId: unlistedId, worker: worker.address },
    requester
  );
  await pollTaskStatus(unlistedId, 'completed');
  ok('unlisted task completed and awarded to worker', true);

  // 8. Worker's own inbox, unauthenticated -- no free pass for being the
  // linked worker either.
  log('8/26', "Checking worker's own inbox with no read-auth header...");
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
  log('9/26', "Checking worker's own inbox with a valid read-auth header...");
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
  const evaluator = randomAccount();
  const disputeResolver = randomAccount();
  console.log('\n--- Part B: private tasks (Phase 3, ADR-0030) ---');
  console.log('outsider:', outsider.address, '(signed, but never allowlisted or invited)');
  console.log('evaluator:', evaluator.address);
  console.log('dispute resolver:', disputeResolver.address);

  // 10. Create three private tasks and a fresh public control task.
  log('10/26', 'Creating allowlist-only private task...');
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

  log('10b/26', 'Creating password-only private task...');
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
    '10c/26',
    'Creating both-mechanisms private task (auction mode, for the sibling endpoint spot-check and Part C bid test)...'
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
      // 10 minutes, not the usual 30s smoke-test window -- this task's bid
      // deadline also has to still be open by Part C's step 21 (bids.submit
      // write-auth check), which runs after the rest of Part B's password/grant
      // steps.
      bidDeadline: 10 / 60,
      taskVisibility: 'private',
      allowedViewers: [worker.address],
      accessPassword: PRIVATE_PASSWORD,
      tags: ['smoke-visibility'],
    },
    requester
  )) as { taskId: string };
  ok('both-mechanisms taskId', bothId);

  log('10d/26', 'Creating private never-mode task with assigned evidence roles...');
  const { taskId: assignedEvidenceId } = (await x402Post(
    '/api/tasks',
    {
      description: 'Visibility smoke test — private assigned evidence roles',
      reward: '1000',
      duration: 1,
      mode: 'bounty',
      taskVisibility: 'private',
      submissionVisibility: 'never',
      allowedViewers: [worker.address],
      evaluator: evaluator.address,
      disputeResolver: disputeResolver.address,
      tags: ['smoke-visibility'],
    },
    requester
  )) as { taskId: string };
  ok('assigned-evidence taskId', assignedEvidenceId);

  const assignedEvidencePayload = 'private evidence for assigned decision roles';
  const assignedEvidenceSignature = await worker.signMessage({
    message: buildSubmitMessage(assignedEvidenceId, [contentHash(assignedEvidencePayload)]),
  });
  const { submissionId: assignedEvidenceSubmissionId } = (await post(
    `/api/tasks/${assignedEvidenceId}/submissions`,
    {
      taskId: assignedEvidenceId,
      workerAddress: worker.address,
      artifacts: [
        {
          fileName: 'private-evidence.txt',
          mimeType: 'text/plain',
          role: 'attachment',
          file: Buffer.from(assignedEvidencePayload).toString('base64'),
        },
      ],
      signature: assignedEvidenceSignature,
    }
  )) as { submissionId: string };
  ok('assigned-evidence submissionId', assignedEvidenceSubmissionId);

  log('10e/26', 'Creating a second public control task...');
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
  log('11/26', 'Listing tasks (GET /api/tasks) as a third party...');
  const privateList = (await get('/api/tasks?limit=100')) as TaskListResponse;
  const privateListedIds = new Set(privateList.tasks.map((t) => t.id));
  for (const id of [allowlistOnlyId, passwordOnlyId, bothId, assignedEvidenceId]) {
    if (privateListedIds.has(id)) throw new Error(`Private task ${id} appeared in tasks.list`);
  }
  if (!privateListedIds.has(publicId2)) {
    throw new Error('Second public control task missing from tasks.list');
  }
  ok('all private tasks, including assigned-role evidence, absent from tasks.list', true);
  ok('public control tasks present in tasks.list', true);

  // 12. Requester's own inbox, signed -- sees all three private tasks.
  log('12/26', "Checking requester's own inbox with a valid read-auth header...");
  const requesterInbox = (await get(
    `/api/agents/inbox?address=${encodeURIComponent(requester.address)}`,
    { headers: await readAuthHeaders(requester) }
  )) as InboxResponse;
  const requesterSeenIds = new Set(requesterInbox.asRequester.map((t) => t.id));
  for (const id of [allowlistOnlyId, passwordOnlyId, bothId, assignedEvidenceId]) {
    if (!requesterSeenIds.has(id)) {
      throw new Error(`Requester's own inbox is missing private task ${id}`);
    }
  }
  ok('requester sees all three private tasks in their own inbox', true);

  // 13. Allowlisted worker's inbox -- sees the two allowlist tasks via
  // invitedPrivateTasks, but not the password-only one.
  log('13/26', "Checking allowlisted worker's inbox with a valid read-auth header...");
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
  if (!invitedIds.has(assignedEvidenceId)) {
    throw new Error("Assigned-evidence task missing from invited worker's invitedPrivateTasks");
  }
  if (invitedIds.has(passwordOnlyId)) {
    throw new Error('Password-only task incorrectly appeared in a non-allowlisted invite list');
  }
  ok('allowlisted worker sees exactly the tasks they were invited to', true);

  // 14. A validly-signed but non-allowlisted caller still can't view any of
  // the three -- proves canView isn't fooled by "any authenticated caller".
  log('14/26', 'Fetching all three private tasks as a signed-but-uninvited outsider...');
  const outsiderHeaders = await readAuthHeaders(outsider);
  for (const id of [allowlistOnlyId, passwordOnlyId, bothId, assignedEvidenceId]) {
    const fetched = (await get(`/api/tasks/${id}`, { headers: outsiderHeaders })) as unknown;
    if (fetched !== null) {
      throw new Error(`Signed outsider could view private task ${id} (expected null)`);
    }
  }
  ok('signed-but-uninvited outsider cannot view any private task', true);

  log('14b/26', 'Verifying assigned evaluator/resolver evidence reads and outsider denial...');
  const outsiderEvidenceRows = (await get(`/api/tasks/${assignedEvidenceId}/submissions`, {
    headers: outsiderHeaders,
  })) as unknown[];
  if (outsiderEvidenceRows.length !== 0) {
    throw new Error('Signed outsider could read never-mode private task evidence');
  }

  for (const [label, account] of [
    ['evaluator', evaluator],
    ['dispute resolver', disputeResolver],
  ] as const) {
    const headers = await readAuthHeaders(account);
    const task = (await get(`/api/tasks/${assignedEvidenceId}`, { headers })) as {
      id: string;
    } | null;
    if (task?.id !== assignedEvidenceId) {
      throw new Error(`Assigned ${label} could not directly read the private task`);
    }
    const rows = (await get(`/api/tasks/${assignedEvidenceId}/submissions`, {
      headers,
    })) as Array<{ id: string }>;
    if (!rows.some((row) => row.id === assignedEvidenceSubmissionId)) {
      throw new Error(`Assigned ${label} could not read the private never-mode submission`);
    }
  }
  ok('assigned evaluator and resolver can read private never-mode evidence', true);
  ok('outsider remains denied private never-mode evidence', true);

  // 15. Wrong password is rejected generically; a nonexistent task returns
  // the exact same error (no existence leak).
  log('15/26', 'Verifying a wrong password is rejected...');
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

  log('15b/26', 'Confirming the same generic error for a nonexistent task...');
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
  log('16/26', 'Confirming repeated wrong guesses hit the rate limit...');
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
  log('17/26', 'Verifying the correct password issues a grant (both-mechanisms task)...');
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
  log('18/26', 'Confirming the grant does not unlock a different private task...');
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
  log('19/26', 'Spot-checking bids.listByTask on the auction-mode private task...');
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

  // === Part C: private-task write-path authorization (PR #314) ===
  console.log('\n--- Part C: private-task write-path authorization (PR #314) ---');

  // Fund the outsider with mock USDC before any of Part C's X402-gated attempts
  // (bid, auction-accept, pitch, proof) -- see fundWithUsdc's doc comment.
  log('20-pre/26', 'Funding the outsider account with mock USDC for X402 payment settlement...');
  await fundWithUsdc(requester, outsider.address, 1_000_000_000_000n);
  ok('outsider funded with mock USDC', outsider.address);

  // 20. An outsider cannot submit work on the allowlist-only private (bounty
  // mode) task; the allowlisted worker can.
  log('20/26', 'Outsider attempting to submit work on the allowlist-only private task...');
  const outsiderSubmitPayload = 'outsider should not be able to submit this';
  const outsiderSubmitSig = await outsider.signMessage({
    message: buildSubmitMessage(allowlistOnlyId, [contentHash(outsiderSubmitPayload)]),
  });
  await assertRejects(
    () =>
      post(`/api/tasks/${allowlistOnlyId}/submissions`, {
        taskId: allowlistOnlyId,
        workerAddress: outsider.address,
        artifacts: [
          {
            fileName: 'submission.txt',
            mimeType: 'text/plain',
            role: 'attachment',
            file: Buffer.from(outsiderSubmitPayload).toString('base64'),
          },
        ],
        signature: outsiderSubmitSig,
      }),
    'Not authorized to submit to this private task',
    'outsider rejected submitting to the allowlist-only private task'
  );

  log('20b/26', 'Allowlisted worker submitting work on the allowlist-only private task...');
  const workerSubmitPayload = 'allowlisted worker submission';
  const workerSubmitSig = await worker.signMessage({
    message: buildSubmitMessage(allowlistOnlyId, [contentHash(workerSubmitPayload)]),
  });
  const { submissionId: allowlistSubmissionId } = (await post(
    `/api/tasks/${allowlistOnlyId}/submissions`,
    {
      taskId: allowlistOnlyId,
      workerAddress: worker.address,
      artifacts: [
        {
          fileName: 'submission.txt',
          mimeType: 'text/plain',
          role: 'attachment',
          file: Buffer.from(workerSubmitPayload).toString('base64'),
        },
      ],
      signature: workerSubmitSig,
    }
  )) as { success: boolean; submissionId: string };
  ok('allowlisted worker submitted to the allowlist-only private task', allowlistSubmissionId);

  // 21. An outsider cannot bid on the both-mechanisms private (english
  // auction) task; the allowlisted worker can.
  log('21/26', 'Outsider attempting to bid on the both-mechanisms private auction task...');
  await assertRejects(
    () => x402Post(`/api/tasks/${bothId}/bids`, { taskId: bothId, price: '500' }, outsider),
    'Not authorized to bid on this private task',
    'outsider rejected bidding on the both-mechanisms private task'
  );

  log('21b/26', 'Allowlisted worker bidding on the both-mechanisms private task...');
  const workerBid = (await x402Post(
    `/api/tasks/${bothId}/bids`,
    { taskId: bothId, price: '400' },
    worker
  )) as { success: boolean; bidId: string };
  if (!workerBid.success) {
    throw new Error('Allowlisted worker bid on the both-mechanisms private task did not succeed');
  }
  ok('allowlisted worker bid on the both-mechanisms private task', workerBid.bidId);

  // 22. bothId is english mode, which doesn't use auction-accept -- a
  // dedicated dutch-auction private task is needed to cover
  // bids.auctionAccept, the endpoint that had zero private-task check at all
  // before #314.
  log('22/26', 'Creating a private dutch-auction task...');
  const { taskId: dutchPrivateId } = (await x402Post(
    '/api/tasks',
    {
      description: 'Visibility smoke test — private, dutch auction',
      reward: '1000',
      maxPrice: '1000',
      duration: 1,
      mode: 'auction',
      auctionType: 'dutch',
      auctionFloorPrice: '100',
      bidDeadline: 10 / 60,
      taskVisibility: 'private',
      allowedViewers: [worker.address],
      tags: ['smoke-visibility'],
    },
    requester
  )) as { taskId: string };
  ok('dutch-auction private taskId', dutchPrivateId);

  log('22b/26', 'Outsider attempting to auction-accept the private dutch-auction task...');
  await assertRejects(
    () =>
      x402Post(`/api/tasks/${dutchPrivateId}/bids/accept`, { taskId: dutchPrivateId }, outsider),
    'Not authorized to accept this private task',
    'outsider rejected auction-accepting the private dutch-auction task'
  );

  log('22c/26', 'Allowlisted worker accepting the current clock price...');
  const acceptResult = (await x402Post(
    `/api/tasks/${dutchPrivateId}/bids/accept`,
    { taskId: dutchPrivateId },
    worker
  )) as { success: boolean; acceptedPrice: string; workerAddress: string };
  ok('allowlisted worker accepted the private dutch-auction task', acceptResult.acceptedPrice);

  const claimedDutchTask = (await get(`/api/tasks/${dutchPrivateId}`, {
    headers: await readAuthHeaders(requester),
  })) as {
    status: string;
    claimedBy: string | null;
  };
  if (claimedDutchTask.status !== 'claimed') {
    throw new Error(
      `Expected the private dutch-auction task to be claimed after accept. Got: ${claimedDutchTask.status}`
    );
  }
  ok('private dutch-auction task moved to claimed', claimedDutchTask.claimedBy);

  // 23. An outsider cannot submit a pitch on a private pitch task; the
  // allowlisted worker can.
  log('23/26', 'Creating a private pitch task...');
  const { taskId: pitchPrivateId } = (await x402Post(
    '/api/tasks',
    {
      description: 'Visibility smoke test — private, pitch',
      reward: '1000',
      duration: 1,
      mode: 'pitch',
      taskVisibility: 'private',
      allowedViewers: [worker.address],
      tags: ['smoke-visibility'],
    },
    requester
  )) as { taskId: string };
  ok('pitch private taskId', pitchPrivateId);

  log('23b/26', 'Outsider attempting to submit a pitch on the private pitch task...');
  await assertRejects(
    () =>
      x402Post(
        `/api/tasks/${pitchPrivateId}/pitches`,
        {
          taskId: pitchPrivateId,
          workerAddress: outsider.address,
          pitchText: 'Outsider pitch that should be rejected',
          signature: '0x',
        },
        outsider
      ),
    'Not authorized to submit a pitch on this private task',
    'outsider rejected pitching on the private pitch task'
  );

  log('23c/26', 'Allowlisted worker submitting a pitch on the private pitch task...');
  const { pitchId: privatePitchId } = (await x402Post(
    `/api/tasks/${pitchPrivateId}/pitches`,
    {
      taskId: pitchPrivateId,
      workerAddress: worker.address,
      pitchText: 'Allowlisted worker pitch',
      signature: '0x',
    },
    worker
  )) as { pitchId: string };
  ok('allowlisted worker pitched on the private pitch task', privatePitchId);

  // 24. An outsider cannot submit a proof on a private benchmark task; the
  // allowlisted worker can.
  log('24/26', 'Creating a private benchmark task...');
  const { taskId: benchmarkPrivateId } = (await x402Post(
    '/api/tasks',
    {
      description: 'Visibility smoke test — private, benchmark',
      reward: '1000',
      duration: 1,
      mode: 'benchmark',
      taskVisibility: 'private',
      allowedViewers: [worker.address],
      tags: ['smoke-visibility'],
    },
    requester
  )) as { taskId: string };
  ok('benchmark private taskId', benchmarkPrivateId);

  log('24b/26', 'Outsider attempting to submit a proof on the private benchmark task...');
  await assertRejects(
    () =>
      x402Post(
        `/api/tasks/${benchmarkPrivateId}/proofs`,
        {
          taskId: benchmarkPrivateId,
          workerAddress: outsider.address,
          proofData: 'outsider proof that should be rejected',
          proofType: 'api_data',
          signature: '0x',
        },
        outsider
      ),
    'Not authorized to submit a proof on this private task',
    'outsider rejected proving on the private benchmark task'
  );

  log('24c/26', 'Allowlisted worker submitting a proof on the private benchmark task...');
  const { proofId: privateProofId } = (await x402Post(
    `/api/tasks/${benchmarkPrivateId}/proofs`,
    {
      taskId: benchmarkPrivateId,
      workerAddress: worker.address,
      proofData: 'allowlisted worker proof',
      proofType: 'api_data',
      signature: '0x',
    },
    worker
  )) as { proofId: string };
  ok('allowlisted worker proved on the private benchmark task', privateProofId);

  // 25. An outsider cannot claim a private claim task; the allowlisted worker
  // can, and the task moves to 'claimed'.
  log('25/26', 'Creating a private claim task...');
  const { taskId: claimPrivateId } = (await x402Post(
    '/api/tasks',
    {
      description: 'Visibility smoke test — private, claim',
      reward: '1000',
      duration: 1,
      mode: 'claim',
      taskVisibility: 'private',
      allowedViewers: [worker.address],
      tags: ['smoke-visibility'],
    },
    requester
  )) as { taskId: string };
  ok('claim private taskId', claimPrivateId);

  log('25b/26', 'Outsider attempting to claim the private claim task...');
  const outsiderClaimSig = await outsider.signMessage({
    message: buildClaimMessage(claimPrivateId),
  });
  await assertRejects(
    () =>
      post(`/api/tasks/${claimPrivateId}/claim`, {
        taskId: claimPrivateId,
        workerAddress: outsider.address,
        signature: outsiderClaimSig,
      }),
    'Not authorized to claim this private task',
    'outsider rejected claiming the private claim task'
  );

  log('25c/26', 'Allowlisted worker claiming the private claim task...');
  const workerClaimSig = await worker.signMessage({ message: buildClaimMessage(claimPrivateId) });
  const { claimId: privateClaimId } = (await post(`/api/tasks/${claimPrivateId}/claim`, {
    taskId: claimPrivateId,
    workerAddress: worker.address,
    signature: workerClaimSig,
  })) as { claimId: string };
  ok('allowlisted worker claimed the private claim task', privateClaimId);

  const claimedTask = (await get(`/api/tasks/${claimPrivateId}`, {
    headers: await readAuthHeaders(requester),
  })) as {
    status: string;
    claimedBy: string | null;
  };
  if (
    claimedTask.status !== 'claimed' ||
    claimedTask.claimedBy?.toLowerCase() !== worker.address.toLowerCase()
  ) {
    throw new Error(
      `Expected the private claim task to move to claimed with claimedBy the allowlisted worker. Got: ${JSON.stringify(claimedTask)}`
    );
  }
  ok('private claim task moved to claimed, claimedBy the allowlisted worker', true);

  // 26. Regression check for the claimedBy pre-auth oracle fix (the follow-up
  // commit already pushed to #314, not just its original F1 scope). On the
  // now-claimed private claim task, an outsider submits with
  // workerAddress=outsider.address but a signature that does NOT correspond
  // to it (signed by worker instead). Before the fix, submissions.submit
  // compared task.claimedBy against the caller-supplied workerAddress BEFORE
  // verifying the signature -- so an attacker could learn "this address isn't
  // the assigned worker" (the claimedBy-mismatch error) or "this address has
  // no standing" (the new FORBIDDEN check) for an address they never proved
  // they controlled. The fix moved signature verification first; this
  // asserts that ordering holds by requiring the signature error specifically
  // -- assertRejects fails the run if either pre-auth-oracle message comes
  // back instead.
  log(
    '26/26',
    'Regression: outsider submitting with a signature that does not match their claimed address...'
  );
  const mismatchedSubmitSig = await worker.signMessage({
    message: buildSubmitMessage(claimPrivateId),
  });
  await assertRejects(
    () =>
      post(`/api/tasks/${claimPrivateId}/submissions`, {
        taskId: claimPrivateId,
        workerAddress: outsider.address,
        artifacts: [
          {
            fileName: 'submission.txt',
            mimeType: 'text/plain',
            role: 'attachment',
            file: Buffer.from('mismatched signature regression check').toString('base64'),
          },
        ],
        signature: mismatchedSubmitSig,
      }),
    'Signature does not match worker address',
    'outsider with a mismatched signature gets a signature error, not a claimedBy/FORBIDDEN oracle'
  );

  console.log('\n=== Task visibility smoke test passed ===');
  console.log('unlistedTaskId:        ', unlistedId);
  console.log('publicTaskId:          ', publicId);
  console.log('allowlistOnlyTaskId:   ', allowlistOnlyId);
  console.log('passwordOnlyTaskId:    ', passwordOnlyId);
  console.log('bothMechanismsTaskId:  ', bothId);
  console.log('assignedEvidenceTaskId:', assignedEvidenceId);
  console.log('publicTaskId2:         ', publicId2);
  console.log('dutchPrivateTaskId:    ', dutchPrivateId);
  console.log('pitchPrivateTaskId:    ', pitchPrivateId);
  console.log('benchmarkPrivateTaskId:', benchmarkPrivateId);
  console.log('claimPrivateTaskId:    ', claimPrivateId);
}

main().catch((err) => {
  console.error('\nFatal:', err);
  process.exit(1);
});

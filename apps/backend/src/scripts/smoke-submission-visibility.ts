/**
 * Submission visibility smoke test (ADR-0016, Phase 2 of
 * docs/specs/task-visibility-and-submission-visibility.md): verifies the
 * `submissionVisibility` field's role/lifecycle gating over real HTTP, across
 * `submissions.listByTask`, `previewArtifact`, `agents/{address}/work`, and
 * `submissions.mine`, for all three non-public modes, all three caller roles
 * (requester, submitting worker, other worker/public), and both lifecycle
 * states (active, ended) -- plus a `public`-mode control case confirming zero
 * behavior change for the default.
 *
 * `submissions.download` is deliberately NOT covered here: it has no
 * `.meta({ openapi })` block (unlike every other procedure in
 * submissions.router.ts) and so has no `/api/...` REST route to hit with this
 * script's plain-fetch helpers -- it is reachable only via raw tRPC. It also
 * has no CLI or web caller today (the CLI's `task download` command calls the
 * separately-gated `preview` endpoint instead), so there is no real HTTP path
 * to exercise. Its role/mode gating is covered at the unit-test layer instead
 * -- see apps/backend/test/unit/routers/submissions.test.ts's `download`
 * describe block, which calls the tRPC procedure directly.
 *
 * Caller identity for these reads is proven via a signed
 * `taskmarket:read:<address>` message sent as the `X-Taskmarket-Caller-Address`
 * / `X-Taskmarket-Caller-Signature` headers (Phase 2's general read-auth
 * foundation, ctx.caller) -- this is the first end-to-end exercise of that
 * mechanism over real HTTP, not just backend unit tests.
 *
 * Usage:
 *   REQUESTER_PRIVATE_KEY=0x... WORKER_PRIVATE_KEY=0x... WORKER_B_PRIVATE_KEY=0x... \
 *     npx tsx --env-file=../../.env src/scripts/smoke-submission-visibility.ts
 */
import { privateKeyToAccount } from 'viem/accounts';
import { buildSubmitMessage } from '@taskmarket/shared';
import {
  log,
  ok,
  get,
  post,
  x402Post,
  getAccounts,
  readAuthHeaders,
  API_URL,
  type Account,
} from './_x402';

type SubmissionRow = {
  id: string;
  workerAddress: string;
  artifacts: Array<{ id: string }>;
};

type TaskRow = { status: string };

async function submitBounty(taskId: string, worker: Account, payload: string) {
  const signature = await worker.signMessage({ message: buildSubmitMessage(taskId) });
  const { submissionId } = (await post(`/api/tasks/${taskId}/submissions`, {
    taskId,
    workerAddress: worker.address,
    signature,
    artifacts: [
      {
        fileName: 'submission.txt',
        mimeType: 'text/plain',
        role: 'attachment',
        file: Buffer.from(payload).toString('base64'),
      },
    ],
  })) as { submissionId: string };
  return submissionId;
}

async function listByTask(taskId: string, account?: Account): Promise<SubmissionRow[]> {
  const headers = account ? await readAuthHeaders(account) : undefined;
  return (await get(`/api/tasks/${taskId}/submissions`, { headers })) as SubmissionRow[];
}

type MySubmissionRow = { taskId: string };

async function mySubmissions(workerAddress: string, account?: Account): Promise<MySubmissionRow[]> {
  const headers = account ? await readAuthHeaders(account) : undefined;
  return (await get(`/api/submissions/mine?workerAddress=${encodeURIComponent(workerAddress)}`, {
    headers,
  })) as MySubmissionRow[];
}

function submissionIds(rows: SubmissionRow[]): string[] {
  return rows.map((row) => row.id).sort();
}

function assertEqualSets(label: string, actual: string[], expected: string[]) {
  const a = [...actual].sort();
  const e = [...expected].sort();
  if (JSON.stringify(a) !== JSON.stringify(e)) {
    throw new Error(`${label}: expected [${e.join(', ')}], got [${a.join(', ')}]`);
  }
  ok(label, actual.length);
}

async function pollCompleted(taskId: string): Promise<void> {
  for (let i = 0; i < 20; i++) {
    const t = (await get(`/api/tasks/${taskId}`)) as TaskRow;
    if (t.status === 'completed') return;
    await new Promise((r) => setTimeout(r, 3000));
  }
  throw new Error(`task ${taskId} never reached completed`);
}

async function createTask(
  requester: Account,
  submissionVisibility: string,
  description: string
): Promise<string> {
  const { taskId } = (await x402Post(
    '/api/tasks',
    {
      description,
      reward: '1000',
      duration: 1,
      mode: 'bounty',
      submissionVisibility,
      tags: ['smoke-submission-visibility'],
    },
    requester
  )) as { taskId: string };
  return taskId;
}

async function main() {
  const { requester, worker } = getAccounts();
  const workerBKey = process.env.WORKER_B_PRIVATE_KEY as `0x${string}` | undefined;
  if (!workerBKey) {
    console.error(
      'WORKER_B_PRIVATE_KEY is required for the submission-visibility smoke test.\n' +
        'Set it to a second worker private key -- any freshly generated key works, since\n' +
        "the backend's SERVER_PRIVATE_KEY relays and pays gas via the forwarder."
    );
    process.exit(1);
  }
  const workerB = privateKeyToAccount(workerBKey);

  console.log('=== Taskmarket Smoke Test — Submission Visibility (Phase 2) ===');
  console.log('requester:', requester.address);
  console.log('worker:   ', worker.address);
  console.log('workerB:  ', workerB.address);
  console.log('api:      ', API_URL);

  // === Control case: submissionVisibility defaults to 'public' -- zero behavior change ===
  log('0/5', 'Control: public mode is visible to anyone, immediately, while active...');
  const publicTaskId = await createTask(
    requester,
    'public',
    'Submission visibility — public control'
  );
  await submitBounty(publicTaskId, worker, 'public-payload');
  const publicAnon = await listByTask(publicTaskId);
  assertEqualSets(
    'public mode visible to anonymous caller while active',
    submissionIds(publicAnon),
    [publicAnon[0]?.id ?? '']
  );
  if (publicAnon.length !== 1)
    throw new Error('public mode: expected exactly 1 submission visible');
  ok('public taskId', publicTaskId);

  // === Mode 1/3: 'never' ===
  log('1/5', "Testing submissionVisibility: 'never'...");
  const neverTaskId = await createTask(requester, 'never', 'Submission visibility — never');
  const neverSubA = await submitBounty(neverTaskId, worker, 'never-payload-worker');
  const neverSubB = await submitBounty(neverTaskId, workerB, 'never-payload-workerB');

  // Active state, role gating.
  assertEqualSets(
    'never/active: anonymous sees nothing',
    submissionIds(await listByTask(neverTaskId)),
    []
  );
  assertEqualSets(
    'never/active: worker sees only their own',
    submissionIds(await listByTask(neverTaskId, worker)),
    [neverSubA]
  );
  assertEqualSets(
    'never/active: workerB sees only their own',
    submissionIds(await listByTask(neverTaskId, workerB)),
    [neverSubB]
  );
  assertEqualSets(
    'never/active: requester sees all',
    submissionIds(await listByTask(neverTaskId, requester)),
    [neverSubA, neverSubB]
  );

  // Resolve the task (accept worker's submission -- worker becomes the task_awards winner).
  await x402Post(
    `/api/tasks/${neverTaskId}/accept`,
    { taskId: neverTaskId, worker: worker.address },
    requester
  );
  await pollCompleted(neverTaskId);

  // Ended state: 'never' keeps everything hidden forever, even from the winner's
  // portfolio-adjacent view -- only requester and each submitting worker still see anything.
  assertEqualSets(
    'never/ended: anonymous still sees nothing',
    submissionIds(await listByTask(neverTaskId)),
    []
  );
  assertEqualSets(
    'never/ended: worker still sees only their own (now the winner)',
    submissionIds(await listByTask(neverTaskId, worker)),
    [neverSubA]
  );
  assertEqualSets(
    'never/ended: workerB still sees only their own (non-winner)',
    submissionIds(await listByTask(neverTaskId, workerB)),
    [neverSubB]
  );
  assertEqualSets(
    'never/ended: requester still sees all',
    submissionIds(await listByTask(neverTaskId, requester)),
    [neverSubA, neverSubB]
  );

  // previewArtifact: unauthenticated fails, submitting worker succeeds.
  const neverRowsAsRequester = await listByTask(neverTaskId, requester);
  const neverArtifactA = neverRowsAsRequester.find((row) => row.id === neverSubA)?.artifacts[0]?.id;
  if (!neverArtifactA) throw new Error('never mode: could not resolve worker artifact id');

  let previewRejected = false;
  try {
    await get(`/api/tasks/${neverTaskId}/artifacts/${neverArtifactA}/preview`);
  } catch {
    previewRejected = true;
  }
  if (!previewRejected)
    throw new Error('never mode: previewArtifact should reject an anonymous caller');
  ok('never mode: previewArtifact rejects anonymous caller', true);

  const previewAsWorker = (await get(
    `/api/tasks/${neverTaskId}/artifacts/${neverArtifactA}/preview`,
    { headers: await readAuthHeaders(worker) }
  )) as { previewUrl: string };
  if (!previewAsWorker.previewUrl)
    throw new Error('never mode: worker should be able to preview their own artifact');
  ok('never mode: previewArtifact allows the submitting worker', true);

  // === Mode 2/3: 'winner_only' ===
  log('2/5', "Testing submissionVisibility: 'winner_only'...");
  const winnerTaskId = await createTask(
    requester,
    'winner_only',
    'Submission visibility — winner_only'
  );
  const winnerSubA = await submitBounty(winnerTaskId, worker, 'winner-payload-worker');
  const winnerSubB = await submitBounty(winnerTaskId, workerB, 'winner-payload-workerB');

  assertEqualSets(
    'winner_only/active: anonymous sees nothing',
    submissionIds(await listByTask(winnerTaskId)),
    []
  );
  assertEqualSets(
    'winner_only/active: requester sees all',
    submissionIds(await listByTask(winnerTaskId, requester)),
    [winnerSubA, winnerSubB]
  );

  await x402Post(
    `/api/tasks/${winnerTaskId}/accept`,
    { taskId: winnerTaskId, worker: worker.address },
    requester
  );
  await pollCompleted(winnerTaskId);

  // Ended state: only the task_awards-linked winner (worker) is revealed to anyone;
  // workerB's non-winning submission stays hidden from the public, but workerB can
  // still see their own.
  assertEqualSets(
    "winner_only/ended: anonymous sees only the winner's submission",
    submissionIds(await listByTask(winnerTaskId)),
    [winnerSubA]
  );
  assertEqualSets(
    'winner_only/ended: workerB (non-winner) sees the winner + their own',
    submissionIds(await listByTask(winnerTaskId, workerB)),
    [winnerSubA, winnerSubB]
  );
  assertEqualSets(
    'winner_only/ended: requester still sees all',
    submissionIds(await listByTask(winnerTaskId, requester)),
    [winnerSubA, winnerSubB]
  );

  // === Mode 3/3: 'reveal_all' ===
  log('3/5', "Testing submissionVisibility: 'reveal_all'...");
  const revealTaskId = await createTask(
    requester,
    'reveal_all',
    'Submission visibility — reveal_all'
  );
  const revealSubA = await submitBounty(revealTaskId, worker, 'reveal-payload-worker');
  const revealSubB = await submitBounty(revealTaskId, workerB, 'reveal-payload-workerB');

  assertEqualSets(
    'reveal_all/active: anonymous sees nothing',
    submissionIds(await listByTask(revealTaskId)),
    []
  );

  await x402Post(
    `/api/tasks/${revealTaskId}/accept`,
    { taskId: revealTaskId, worker: worker.address },
    requester
  );
  await pollCompleted(revealTaskId);

  assertEqualSets(
    'reveal_all/ended: anonymous sees every submission',
    submissionIds(await listByTask(revealTaskId)),
    [revealSubA, revealSubB]
  );

  // === agents/{address}/work portfolio gating ===
  log('4/5', "Checking GET /agents/{address}/work respects 'never' mode...");
  type WorkEntry = { taskId: string };
  const workAnon = (await get(
    `/api/agents/${encodeURIComponent(worker.address)}/work`
  )) as WorkEntry[];
  if (workAnon.some((entry) => entry.taskId === neverTaskId)) {
    throw new Error(
      "never-mode task leaked into the worker's public portfolio for an anonymous caller"
    );
  }
  ok("never-mode task absent from worker's public portfolio (anonymous)", true);

  const workAsWorker = (await get(`/api/agents/${encodeURIComponent(worker.address)}/work`, {
    headers: await readAuthHeaders(worker),
  })) as WorkEntry[];
  if (!workAsWorker.some((entry) => entry.taskId === neverTaskId)) {
    throw new Error("never-mode task missing from the worker's own portfolio view");
  }
  ok("never-mode task present in worker's own portfolio view", true);

  const workAsRequester = (await get(`/api/agents/${encodeURIComponent(worker.address)}/work`, {
    headers: await readAuthHeaders(requester),
  })) as WorkEntry[];
  if (!workAsRequester.some((entry) => entry.taskId === neverTaskId)) {
    throw new Error("never-mode task missing from the requester's view of the worker's portfolio");
  }
  ok("never-mode task present when viewed by that task's requester", true);

  const workAnonWinnerOnly = (await get(
    `/api/agents/${encodeURIComponent(worker.address)}/work`
  )) as WorkEntry[];
  if (!workAnonWinnerOnly.some((entry) => entry.taskId === winnerTaskId)) {
    throw new Error(
      "winner_only-mode task_awards-linked work should still show up in the winner's public portfolio"
    );
  }
  ok(
    "winner_only-mode work present in winner's public portfolio (it's a winner by definition)",
    true
  );

  // === GET /submissions/mine ===
  log('5/5', 'Checking GET /submissions/mine respects submissionVisibility...');

  const mineAnon = await mySubmissions(worker.address);
  if (mineAnon.some((row) => row.taskId === neverTaskId)) {
    throw new Error(
      "never-mode task leaked into the worker's mySubmissions for an anonymous caller"
    );
  }
  ok("never-mode task absent from worker's mySubmissions (anonymous)", true);

  const mineAsWorker = await mySubmissions(worker.address, worker);
  if (!mineAsWorker.some((row) => row.taskId === neverTaskId)) {
    throw new Error("never-mode task missing from the worker's own mySubmissions view");
  }
  ok("never-mode task present in worker's own mySubmissions view", true);

  const mineAsRequester = await mySubmissions(worker.address, requester);
  if (!mineAsRequester.some((row) => row.taskId === neverTaskId)) {
    throw new Error(
      "never-mode task missing from the requester's view of the worker's mySubmissions"
    );
  }
  ok('never-mode task present when the requester queries it via mySubmissions', true);

  const mineAsOtherWorker = await mySubmissions(worker.address, workerB);
  if (mineAsOtherWorker.some((row) => row.taskId === neverTaskId)) {
    throw new Error(
      "an unrelated caller (workerB) must not see worker's never-mode task via mySubmissions just by passing worker's address"
    );
  }
  ok('never-mode task hidden from an unrelated authenticated caller (workerB)', true);

  const mineAnonWinnerOnly = await mySubmissions(worker.address);
  if (!mineAnonWinnerOnly.some((row) => row.taskId === winnerTaskId)) {
    throw new Error(
      "winner_only-mode task_awards-linked work should still show up in the winner's public mySubmissions"
    );
  }
  ok("winner_only-mode task present in winner's public mySubmissions (it's a winner)", true);

  const mineAnonRevealAll = await mySubmissions(worker.address);
  if (!mineAnonRevealAll.some((row) => row.taskId === revealTaskId)) {
    throw new Error('reveal_all-mode ended task should show up in the public mySubmissions view');
  }
  ok('reveal_all-mode task present in public mySubmissions once ended', true);

  console.log('\n=== Submission visibility smoke test passed ===');
  console.log('publicTaskId:', publicTaskId);
  console.log('neverTaskId: ', neverTaskId);
  console.log('winnerTaskId:', winnerTaskId);
  console.log('revealTaskId:', revealTaskId);
}

main().catch((err) => {
  console.error('\nFatal:', err);
  process.exit(1);
});

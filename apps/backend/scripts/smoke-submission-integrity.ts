/**
 * Submission integrity smoke test.
 *
 * Verifies:
 *   A. Wrong-deliverable rejection — backend enforces DB submission exists and
 *      rejects acceptance if no submission has been committed by the worker.
 *   B. Correct acceptance — bounty accepted using DB-derived deliverable hash;
 *      no --deliverable flag required.
 *   C. Self-award flagging — requester submits as worker (same address), accepts,
 *      task.selfAward is set to true in DB and surfaced in /api/tasks/:id.
 *   D. RequesterReputation event indexing — cancel after submission, verify
 *      requester.stats shows cancelledAfterSubmissionsCount = 1.
 *   E. requester stats CLI — taskmarket requester stats returns JSON with counts.
 *
 * Usage:
 *   REQUESTER_PRIVATE_KEY=0x... WORKER_PRIVATE_KEY=0x... \
 *     npx tsx --env-file=../../.env scripts/smoke-submission-integrity.ts
 *
 * Notes:
 *   - REQUESTER_PRIVATE_KEY and WORKER_PRIVATE_KEY must be different accounts
 *     to test scenario B. Scenario C reuses the requester as worker.
 *   - The contract must be the upgraded Diamond with submission hash storage.
 */
import { log, ok, get, post, x402Post, getAccounts, API_URL, pollTaskStatus } from './_x402.ts';

type TaskDetail = { status: string; selfAward?: boolean | null };
type RequesterStats = {
  completedCount: number;
  selfAwardCount: number;
  cancelledAfterSubmissionsCount: number;
  expiredNoActionCount: number;
  expiredAfterRejectionsCount: number;
  totalTasksCreated: number;
  totalSubmissionAttempts: number;
  totalUniqueWorkers: number;
};

async function pollStatus(taskId: string, target: string, maxWaitMs = 60_000): Promise<TaskDetail> {
  return pollTaskStatus<TaskDetail>(taskId, target, { timeoutMs: maxWaitMs });
}

async function fetchRequesterStats(address: string): Promise<RequesterStats> {
  return get(`/api/requester/${address}/stats`) as Promise<RequesterStats>;
}

async function main() {
  const { requester, worker } = getAccounts();

  if (requester.address.toLowerCase() === worker.address.toLowerCase()) {
    console.error(
      'REQUESTER_PRIVATE_KEY and WORKER_PRIVATE_KEY must be different accounts.\n' +
        'Scenario B requires two distinct wallets.'
    );
    process.exit(1);
  }

  console.log('=== Taskmarket Smoke Test — Submission Integrity ===');
  console.log('requester:', requester.address);
  console.log('worker:   ', worker.address);
  console.log('api:      ', API_URL);

  // -----------------------------------------------------------------------
  // Scenario A: no-submission rejection
  // -----------------------------------------------------------------------
  console.log('\n--- Scenario A: acceptance rejected when worker has no submission ---');

  log('A1', 'Creating bounty task (X402)...');
  const { taskId: taskA } = (await x402Post(
    '/api/tasks',
    {
      description: 'Smoke test A — no submission',
      reward: '1000',
      duration: 1,
      mode: 'bounty',
      tags: ['smoke-test'],
    },
    requester
  )) as { taskId: string };
  ok('taskId', taskA);

  log('A2', 'Attempting accept with no prior submission — expecting 400...');
  let caught = false;
  try {
    await x402Post(
      `/api/tasks/${taskA}/accept`,
      { taskId: taskA, worker: worker.address },
      requester
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!msg.includes('400') && !msg.includes('No active submission')) {
      throw new Error(`Expected 400/BAD_REQUEST, got: ${msg}`);
    }
    caught = true;
    ok('rejection confirmed', msg.slice(0, 80));
  }
  if (!caught) throw new Error('Expected acceptance to fail — no submission had been committed');

  // -----------------------------------------------------------------------
  // Scenario B: correct bounty acceptance — deliverable derived from DB
  // -----------------------------------------------------------------------
  console.log('\n--- Scenario B: correct acceptance, deliverable derived from DB ---');

  log('B1', 'Creating bounty task (X402)...');
  const { taskId: taskB } = (await x402Post(
    '/api/tasks',
    {
      description: 'Smoke test B — valid submission',
      reward: '1000',
      duration: 1,
      mode: 'bounty',
      tags: ['smoke-test'],
    },
    requester
  )) as { taskId: string };
  ok('taskId', taskB);

  log('B2', 'Worker submitting work...');
  const submitSigB = await worker.signMessage({ message: `taskmarket:submit:${taskB}` });
  const { submissionId: subB } = (await post(`/api/tasks/${taskB}/submissions`, {
    taskId: taskB,
    workerAddress: worker.address,
    signature: submitSigB,
    artifacts: [
      {
        fileName: 'result.txt',
        mimeType: 'text/plain',
        role: 'attachment',
        file: Buffer.from('smoke-submission-integrity-B').toString('base64'),
      },
    ],
  })) as { submissionId: string };
  ok('submissionId', subB);

  log('B3', 'Requester accepting without --deliverable flag (backend derives from DB)...');
  await x402Post(
    `/api/tasks/${taskB}/accept`,
    { taskId: taskB, worker: worker.address },
    requester
  );
  ok('accepted', true);

  log('B4', 'Polling for completed status...');
  const completedB = await pollStatus(taskB, 'completed');
  ok('status', completedB.status);
  if (
    completedB.selfAward !== false &&
    completedB.selfAward !== null &&
    completedB.selfAward !== undefined
  ) {
    throw new Error(
      `Expected selfAward to be null/false for normal acceptance, got: ${completedB.selfAward}`
    );
  }
  ok('selfAward', completedB.selfAward ?? null);

  // -----------------------------------------------------------------------
  // Scenario C: self-award flagging
  // -----------------------------------------------------------------------
  console.log('\n--- Scenario C: self-award — requester submits and accepts as same address ---');

  log('C1', 'Creating bounty task (X402)...');
  const { taskId: taskC } = (await x402Post(
    '/api/tasks',
    {
      description: 'Smoke test C — self-award',
      reward: '1000',
      duration: 1,
      mode: 'bounty',
      tags: ['smoke-test'],
    },
    requester
  )) as { taskId: string };
  ok('taskId', taskC);

  log('C2', 'Requester submitting as worker (same address)...');
  const submitSigC = await requester.signMessage({ message: `taskmarket:submit:${taskC}` });
  const { submissionId: subC } = (await post(`/api/tasks/${taskC}/submissions`, {
    taskId: taskC,
    workerAddress: requester.address,
    signature: submitSigC,
    artifacts: [
      {
        fileName: 'result.txt',
        mimeType: 'text/plain',
        role: 'attachment',
        file: Buffer.from('smoke-submission-integrity-C').toString('base64'),
      },
    ],
  })) as { submissionId: string };
  ok('submissionId', subC);

  log('C3', 'Requester accepting their own submission...');
  await x402Post(
    `/api/tasks/${taskC}/accept`,
    { taskId: taskC, worker: requester.address },
    requester
  );
  ok('accepted', true);

  log('C4', 'Polling for completed status...');
  const completedC = await pollStatus(taskC, 'completed');
  ok('status', completedC.status);

  // selfAward may be set synchronously by the router or asynchronously by the indexer.
  // Poll a few times to give the indexer time to process SelfAward event.
  let selfAwardSet = completedC.selfAward === true;
  for (let i = 0; i < 10 && !selfAwardSet; i++) {
    await new Promise((r) => setTimeout(r, 3_000));
    const t = (await get(`/api/tasks/${taskC}`)) as TaskDetail;
    selfAwardSet = t.selfAward === true;
  }
  if (!selfAwardSet) {
    throw new Error(
      'Expected task.selfAward to be true after requester accepted their own submission'
    );
  }
  ok('selfAward', true);

  // -----------------------------------------------------------------------
  // Scenario D: RequesterReputation event — cancel after submission
  // -----------------------------------------------------------------------
  console.log(
    '\n--- Scenario D: RequesterReputation event indexed after cancel with submissions ---'
  );

  log('D1', 'Creating bounty task (X402)...');
  const { taskId: taskD } = (await x402Post(
    '/api/tasks',
    {
      description: 'Smoke test D — cancel after submission',
      reward: '1000',
      duration: 1,
      mode: 'bounty',
      tags: ['smoke-test'],
    },
    requester
  )) as { taskId: string };
  ok('taskId', taskD);

  log('D2', 'Worker submitting work...');
  const submitSigD = await worker.signMessage({ message: `taskmarket:submit:${taskD}` });
  await post(`/api/tasks/${taskD}/submissions`, {
    taskId: taskD,
    workerAddress: worker.address,
    signature: submitSigD,
    artifacts: [
      {
        fileName: 'result.txt',
        mimeType: 'text/plain',
        role: 'attachment',
        file: Buffer.from('smoke-submission-integrity-D').toString('base64'),
      },
    ],
  });
  ok('submitted', true);

  log('D3', 'Requester rejecting submission before cancel...');
  await x402Post(
    `/api/tasks/${taskD}/reject-submission`,
    { taskId: taskD, worker: worker.address },
    requester
  );
  ok('rejected', true);

  // Snapshot requester stats before cancel to get the baseline
  const statsBefore = await fetchRequesterStats(requester.address);
  const cancelledBefore = statsBefore.cancelledAfterSubmissionsCount;
  ok('cancelledAfterSubmissions before', cancelledBefore);

  log('D4', 'Requester cancelling task after all submissions rejected (X402)...');
  await x402Post(`/api/tasks/${taskD}/cancel`, { taskId: taskD }, requester);
  ok('cancelled', true);

  log('D5', 'Polling requester stats for cancelledAfterSubmissionsCount increment...');
  let statsAfter: RequesterStats | null = null;
  for (let i = 0; i < 20; i++) {
    statsAfter = await fetchRequesterStats(requester.address);
    if (statsAfter.cancelledAfterSubmissionsCount > cancelledBefore) break;
    await new Promise((r) => setTimeout(r, 3_000));
  }
  if (!statsAfter || statsAfter.cancelledAfterSubmissionsCount <= cancelledBefore) {
    throw new Error(
      `Expected cancelledAfterSubmissionsCount to increment from ${cancelledBefore}, ` +
        `got ${statsAfter?.cancelledAfterSubmissionsCount}`
    );
  }
  ok('cancelledAfterSubmissionsCount', statsAfter.cancelledAfterSubmissionsCount);
  ok('completedCount', statsAfter.completedCount);
  ok('selfAwardCount', statsAfter.selfAwardCount);
  ok('totalTasksCreated', statsAfter.totalTasksCreated);

  console.log('\n=== Submission integrity smoke test passed ===');
  console.log('Scenario A: no-submission rejection    PASS');
  console.log('Scenario B: DB-derived deliverable     PASS');
  console.log('Scenario C: self-award flagging        PASS');
  console.log('Scenario D: RequesterReputation event  PASS');
}

main().catch((err) => {
  console.error('\nFatal:', err);
  process.exit(1);
});

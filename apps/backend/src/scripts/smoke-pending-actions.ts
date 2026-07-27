/**
 * Pending actions smoke test: verifies the pendingActions array and
 * submissionWindowOpen field in GET /api/tasks/{taskId} transition correctly
 * through a bounty task lifecycle.
 *
 * Bounty tasks stay `open` the entire time — they do NOT flip to
 * pending_approval on submission. The accept action surfaces in pendingActions
 * once at least one submission exists, while the task is still open.
 *
 * State transitions tested:
 *   open (no submissions)  → [ cancel (req), update (req), submit (worker) ]
 *                             submissionWindowOpen: true
 *   open (has submission)  → [ cancel (req), update (req), accept (req), submit? (worker) ]
 *                             submissionWindowOpen: true (if window still open)
 *   completed (no rating)  → [ rate (req) with worker address ]
 *   completed (rated)      → []
 *
 * Usage:
 *   REQUESTER_PRIVATE_KEY=0x... WORKER_PRIVATE_KEY=0x... \
 *     npx tsx --env-file=../../.env src/scripts/smoke-pending-actions.ts
 */
import { log, ok, get, post, x402Post, getAccounts, API_URL } from './_x402';

type PendingAction = {
  role: string;
  action: string;
  command: string;
};

type TaskResponse = {
  status: string;
  submissionWindowOpen: boolean;
  pendingActions: PendingAction[];
  primaryAward: { rating: number | null } | null;
};

async function main() {
  const { requester, worker } = getAccounts();

  console.log('=== Taskmarket Smoke Test — Pending Actions ===');
  console.log('requester:', requester.address);
  console.log('worker:   ', worker.address);
  console.log('api:      ', API_URL);

  // 1. Create bounty task
  log('1/7', 'Creating bounty task (X402)...');
  const { taskId } = (await x402Post(
    '/api/tasks',
    {
      description: 'Pending actions smoke test task',
      reward: '1000',
      duration: 3600,
      mode: 'bounty',
      tags: ['smoke-pending-actions'],
    },
    requester
  )) as { taskId: string };
  ok('taskId', taskId);

  // 2. GET task (open, no submissions) — expect cancel, update, submit; no accept yet
  log('2/7', 'Checking pendingActions for open bounty task (no submissions)...');
  const openTask = (await get(`/api/tasks/${taskId}`)) as TaskResponse;

  if (openTask.status !== 'open') {
    throw new Error(`Expected status=open, got ${openTask.status}`);
  }
  if (openTask.submissionWindowOpen !== true) {
    throw new Error(`Expected submissionWindowOpen=true, got ${openTask.submissionWindowOpen}`);
  }

  const openActions = openTask.pendingActions;
  const hasCancel = openActions.some((a) => a.action === 'cancel' && a.role === 'requester');
  const hasUpdate = openActions.some((a) => a.action === 'update' && a.role === 'requester');
  const hasSubmit = openActions.some((a) => a.action === 'submit' && a.role === 'worker');
  const hasAcceptEarly = openActions.some((a) => a.action === 'accept');

  if (!hasCancel) throw new Error('Expected cancel action for requester in open status');
  if (!hasUpdate) throw new Error('Expected update action for requester in open status');
  if (!hasSubmit) throw new Error('Expected submit action for worker in open status');
  if (hasAcceptEarly) throw new Error('accept must not appear before any submission');

  ok('open (no sub): cancel present', hasCancel);
  ok('open (no sub): update present', hasUpdate);
  ok('open (no sub): submit present', hasSubmit);
  ok('open (no sub): accept absent', !hasAcceptEarly);
  ok('open (no sub): submissionWindowOpen', openTask.submissionWindowOpen);

  // 3. Worker submits work — bounty task stays open
  log('3/7', 'Worker submitting work (bounty stays open)...');
  const submitSig = await worker.signMessage({ message: `taskmarket:submit:${taskId}` });
  await post(`/api/tasks/${taskId}/submissions`, {
    taskId,
    workerAddress: worker.address,
    signature: submitSig,
    artifacts: [
      {
        fileName: 'submission.txt',
        mimeType: 'text/plain',
        role: 'attachment',
        file: Buffer.from('pending-actions-smoke-payload').toString('base64'),
      },
    ],
  });
  ok('submission created', true);

  // 4. GET task (open, has submission) — status must still be open; accept action must appear
  log('4/7', 'Checking pendingActions after submission (task stays open, accept surfaces)...');
  const afterSubmit = (await get(`/api/tasks/${taskId}`)) as TaskResponse;

  if (afterSubmit.status !== 'open') {
    throw new Error(
      `Bounty task must stay open after submission. Got status=${afterSubmit.status}`
    );
  }

  const hasAccept = afterSubmit.pendingActions.some(
    (a) => a.action === 'accept' && a.role === 'requester'
  );
  if (!hasAccept) {
    throw new Error(
      `Expected accept action in open status with submission. Got: ${JSON.stringify(afterSubmit.pendingActions)}`
    );
  }

  const acceptAction = afterSubmit.pendingActions.find((a) => a.action === 'accept')!;
  if (
    !acceptAction.command.includes(worker.address.toLowerCase()) &&
    !acceptAction.command.includes(worker.address)
  ) {
    throw new Error(
      `Expected accept command to include worker address. Got: ${acceptAction.command}`
    );
  }

  ok('open (has sub): status', afterSubmit.status);
  ok('open (has sub): submissionWindowOpen', afterSubmit.submissionWindowOpen);
  ok('open (has sub): accept action present', hasAccept);
  ok('open (has sub): accept command includes worker', true);

  // 5. Requester accepts → task moves to completed via indexer
  log('5/7', 'Requester accepting submission (X402)...');
  await x402Post(`/api/tasks/${taskId}/accept`, { taskId, worker: worker.address }, requester);
  ok('accepted', true);

  // Wait for indexer to process TaskCompleted event
  for (let i = 0; i < 20; i++) {
    const t = (await get(`/api/tasks/${taskId}`)) as TaskResponse;
    if (t.status === 'completed') break;
    await new Promise((r) => setTimeout(r, 3000));
  }

  // 6. GET task (completed, unrated) — expect rate action with worker address
  log('6/7', 'Checking pendingActions after acceptance (completed, unrated)...');
  const completedTask = (await get(`/api/tasks/${taskId}`)) as TaskResponse;

  if (completedTask.status !== 'completed') {
    throw new Error(`Expected status=completed, got ${completedTask.status}`);
  }
  if (completedTask.submissionWindowOpen !== false) {
    throw new Error(
      `Expected submissionWindowOpen=false on completed task, got ${completedTask.submissionWindowOpen}`
    );
  }

  const hasRate = completedTask.pendingActions.some(
    (a) => a.action === 'rate' && a.role === 'requester'
  );
  if (!hasRate) {
    throw new Error(
      `Expected rate action in completed status. Got: ${JSON.stringify(completedTask.pendingActions)}`
    );
  }
  const rateAction = completedTask.pendingActions.find((a) => a.action === 'rate')!;
  if (
    !rateAction.command.includes(worker.address.toLowerCase()) &&
    !rateAction.command.includes(worker.address)
  ) {
    throw new Error(`Expected rate command to include worker address. Got: ${rateAction.command}`);
  }

  ok('completed: status', completedTask.status);
  ok('completed: submissionWindowOpen', completedTask.submissionWindowOpen);
  ok('completed: rate action present', hasRate);
  ok('completed: rate command includes worker', true);

  // 7. Requester rates → pendingActions becomes empty
  log('7/7', 'Requester rating 75/100 (X402) then verifying empty pendingActions...');
  await x402Post(
    `/api/tasks/${taskId}/rate`,
    { taskId, worker: worker.address, rating: 75 },
    requester
  );
  ok('rated', true);

  const ratedTask = (await get(`/api/tasks/${taskId}`)) as TaskResponse;
  if (ratedTask.status !== 'completed' || ratedTask.primaryAward?.rating == null) {
    throw new Error(
      `Expected status=completed with rating set, got status=${ratedTask.status} rating=${ratedTask.primaryAward?.rating}`
    );
  }
  if (ratedTask.pendingActions.length !== 0) {
    throw new Error(
      `Expected empty pendingActions after rating. Got: ${JSON.stringify(ratedTask.pendingActions)}`
    );
  }

  ok('rated: status', ratedTask.status);
  ok('rated: rating', ratedTask.primaryAward?.rating);
  ok('rated: pendingActions empty', ratedTask.pendingActions.length);

  console.log('\n=== Pending actions smoke test passed ===');
  console.log('taskId:', taskId);
}

main().catch((err) => {
  console.error('\nFatal:', err);
  process.exit(1);
});

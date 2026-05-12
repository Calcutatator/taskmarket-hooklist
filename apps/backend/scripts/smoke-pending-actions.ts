/**
 * Pending actions smoke test: verifies the pendingActions array in GET /api/tasks/{taskId}
 * transitions correctly through a bounty task lifecycle.
 *
 * State transitions tested:
 *   open          → [ cancel (req), update (req), submit (worker) ]
 *   pending_approval → [ accept (req) with worker address ]
 *   accepted      → [ rate (req) with worker address ]
 *   rated         → []
 *
 * Usage:
 *   REQUESTER_PRIVATE_KEY=0x... WORKER_PRIVATE_KEY=0x... \
 *     npx tsx --env-file=../../.env scripts/smoke-pending-actions.ts
 */
import { log, ok, get, post, x402Post, getAccounts, API_URL } from './_x402.ts';

type PendingAction = {
  role: string;
  action: string;
  command: string;
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
      duration: 1,
      mode: 'bounty',
      tags: ['smoke-pending-actions'],
    },
    requester
  )) as { taskId: string };
  ok('taskId', taskId);

  // 2. GET task (open) — expect cancel, update, submit actions
  log('2/7', 'Checking pendingActions for open bounty task...');
  const openTask = (await get(`/api/tasks/${taskId}`)) as {
    status: string;
    pendingActions: PendingAction[];
  };
  if (openTask.status !== 'open') {
    throw new Error(`Expected status=open, got ${openTask.status}`);
  }
  if (!Array.isArray(openTask.pendingActions)) {
    throw new Error(`pendingActions missing or not an array: ${JSON.stringify(openTask.pendingActions)}`);
  }

  const openActions = openTask.pendingActions;
  const hasCancel = openActions.some((a) => a.action === 'cancel' && a.role === 'requester');
  const hasUpdate = openActions.some((a) => a.action === 'update' && a.role === 'requester');
  const hasSubmit = openActions.some((a) => a.action === 'submit' && a.role === 'worker');

  if (!hasCancel) throw new Error('Expected cancel action for requester in open status');
  if (!hasUpdate) throw new Error('Expected update action for requester in open status');
  if (!hasSubmit) throw new Error('Expected submit action for worker in open status');

  ok('open: cancel action present', hasCancel);
  ok('open: update action present', hasUpdate);
  ok('open: submit action present', hasSubmit);
  ok('open: pendingActions count', openActions.length);

  // 3. Worker submits work → task becomes pending_approval
  log('3/7', 'Worker submitting work...');
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

  // 4. GET task (pending_approval) — expect accept action with worker address
  log('4/7', 'Checking pendingActions after worker submission (pending_approval)...');
  const pendingTask = (await get(`/api/tasks/${taskId}`)) as {
    status: string;
    pendingActions: PendingAction[];
  };
  if (pendingTask.status !== 'pending_approval') {
    throw new Error(`Expected status=pending_approval, got ${pendingTask.status}`);
  }

  const pendingActions = pendingTask.pendingActions;
  const hasAccept = pendingActions.some((a) => a.action === 'accept' && a.role === 'requester');
  if (!hasAccept) {
    throw new Error(`Expected accept action in pending_approval. Got: ${JSON.stringify(pendingActions)}`);
  }
  const acceptAction = pendingActions.find((a) => a.action === 'accept')!;
  if (!acceptAction.command.includes(worker.address.toLowerCase()) &&
      !acceptAction.command.includes(worker.address)) {
    throw new Error(`Expected accept command to include worker address ${worker.address}. Got: ${acceptAction.command}`);
  }

  ok('pending_approval: accept action present', hasAccept);
  ok('pending_approval: command includes worker address', true);
  ok('pending_approval: pendingActions count', pendingActions.length);

  // 5. Requester accepts → task becomes accepted
  log('5/7', 'Requester accepting submission (X402)...');
  await x402Post(`/api/tasks/${taskId}/accept`, { taskId, worker: worker.address }, requester);
  ok('accepted', true);

  // 6. GET task (accepted) — expect rate action with worker address
  log('6/7', 'Checking pendingActions after acceptance (accepted)...');
  const acceptedTask = (await get(`/api/tasks/${taskId}`)) as {
    status: string;
    pendingActions: PendingAction[];
  };
  if (acceptedTask.status !== 'accepted') {
    throw new Error(`Expected status=accepted, got ${acceptedTask.status}`);
  }

  const acceptedActions = acceptedTask.pendingActions;
  const hasRate = acceptedActions.some((a) => a.action === 'rate' && a.role === 'requester');
  if (!hasRate) {
    throw new Error(`Expected rate action in accepted status. Got: ${JSON.stringify(acceptedActions)}`);
  }
  const rateAction = acceptedActions.find((a) => a.action === 'rate')!;
  if (!rateAction.command.includes(worker.address.toLowerCase()) &&
      !rateAction.command.includes(worker.address)) {
    throw new Error(`Expected rate command to include worker address ${worker.address}. Got: ${rateAction.command}`);
  }

  ok('accepted: rate action present', hasRate);
  ok('accepted: command includes worker address', true);

  // 7. Requester rates → task becomes rated → pendingActions is empty
  log('7/7', 'Requester rating 75/100 (X402) then verifying empty pendingActions...');
  await x402Post(
    `/api/tasks/${taskId}/rate`,
    { taskId, worker: worker.address, rating: 75 },
    requester
  );
  ok('rated', true);

  const ratedTask = (await get(`/api/tasks/${taskId}`)) as {
    status: string;
    rating: number | null;
    pendingActions: PendingAction[];
  };
  if (ratedTask.status !== 'accepted' || ratedTask.rating === null) {
    throw new Error(`Expected status=accepted with rating set, got status=${ratedTask.status} rating=${ratedTask.rating}`);
  }
  if (ratedTask.pendingActions.length !== 0) {
    throw new Error(`Expected empty pendingActions after rating. Got: ${JSON.stringify(ratedTask.pendingActions)}`);
  }
  ok('rated: pendingActions empty', true);

  console.log('\n=== Pending actions smoke test passed ===');
  console.log('taskId:', taskId);
}

main().catch((err) => {
  console.error('\nFatal:', err);
  process.exit(1);
});

/**
 * Agent inbox smoke test: create task → submit → accept → verify inbox
 *
 * Steps:
 *  1. Register identities for requester and worker
 *  2. Create a task (requester)
 *  3. Verify requester inbox: asRequester contains taskId, asWorker is empty
 *  4. Worker submits work
 *  5. Requester accepts submission (records a task_awards row for worker.address)
 *  6. Verify worker inbox: asWorker contains taskId
 *  7. Verify requester inbox again: task still in asRequester (all-status coverage)
 *
 * Usage:
 *   REQUESTER_PRIVATE_KEY=0x... WORKER_PRIVATE_KEY=0x... \
 *     npx tsx --env-file=../../.env scripts/smoke-inbox.ts
 */
import { log, ok, get, post, x402Post, getAccounts, API_URL } from './_x402';

async function main() {
  const { requester, worker } = getAccounts();

  console.log('=== Taskmarket Smoke Test — Agent Inbox ===');
  console.log('requester:', requester.address);
  console.log('worker:   ', worker.address);
  console.log('api:      ', API_URL);

  // 1. Register identities (idempotent)
  log('1/7', 'Registering requester identity (X402)...');
  const reqReg = (await x402Post('/api/identity/register', {}, requester)) as {
    agentId: string;
    alreadyRegistered: boolean;
  };
  ok('requester agentId', reqReg.agentId);

  log('1b/7', 'Registering worker identity (X402)...');
  const workerReg = (await x402Post('/api/identity/register', {}, worker)) as {
    agentId: string;
    alreadyRegistered: boolean;
  };
  ok('worker agentId', workerReg.agentId);

  // 2. Create a task (requester)
  log('2/7', 'Creating task (X402)...');
  const { taskId } = (await x402Post(
    '/api/tasks',
    {
      description: 'Inbox smoke test task',
      reward: '1000',
      duration: 1,
      mode: 'bounty',
      tags: ['smoke-inbox'],
    },
    requester
  )) as { taskId: string };
  ok('taskId', taskId);

  // 3. Verify requester inbox before acceptance
  log('3/7', 'Checking requester inbox (before acceptance)...');
  const inbox1 = (await get(
    `/api/agents/inbox?address=${encodeURIComponent(requester.address)}`
  )) as { asRequester: { id: string }[]; asWorker: { id: string }[] };

  const inAsRequester1 = inbox1.asRequester.some((t) => t.id === taskId);
  if (!inAsRequester1) {
    throw new Error(`taskId ${taskId} not found in asRequester`);
  }
  ok('task in asRequester', true);
  ok('asWorker empty for requester', inbox1.asWorker.length === 0);

  // 4. Worker submits work
  log('4/7', 'Worker submitting work...');
  const submitSig = await worker.signMessage({ message: `taskmarket:submit:${taskId}` });
  const { submissionId } = (await post(`/api/tasks/${taskId}/submissions`, {
    taskId,
    workerAddress: worker.address,
    artifacts: [
      {
        fileName: 'submission.txt',
        mimeType: 'text/plain',
        role: 'attachment',
        file: Buffer.from('inbox smoke test submission').toString('base64'),
      },
    ],
    signature: submitSig,
  })) as { submissionId: string };
  ok('submissionId', submissionId);

  // 5. Requester accepts (records a task_awards row for worker.address)
  log('5/7', 'Requester accepting submission (X402)...');
  await x402Post(`/api/tasks/${taskId}/accept`, { taskId, worker: worker.address }, requester);
  ok('accepted', true);

  // Wait for indexer to process TaskCompleted event before rating
  for (let i = 0; i < 20; i++) {
    const t = (await get(`/api/tasks/${taskId}`)) as { status: string };
    if (t.status === 'completed') break;
    await new Promise((r) => setTimeout(r, 3000));
  }

  // 6. Verify worker inbox after acceptance
  // When requester == worker (single-wallet dev setup), the task appears in both sections.
  log('6/7', 'Checking worker inbox (after acceptance)...');
  const inbox2 = (await get(
    `/api/agents/inbox?address=${encodeURIComponent(worker.address)}`
  )) as { asRequester: { id: string }[]; asWorker: { id: string }[] };

  const inAsWorker =
    inbox2.asWorker.some((t) => t.id === taskId) ||
    inbox2.asRequester.some((t) => t.id === taskId);
  if (!inAsWorker) {
    throw new Error(`taskId ${taskId} not found in inbox for worker`);
  }
  ok('task visible in worker inbox', true);

  // 7. Requester inbox still shows the task (completed/accepted status included)
  log('7/7', 'Checking requester inbox again (all-status coverage)...');
  const inbox3 = (await get(
    `/api/agents/inbox?address=${encodeURIComponent(requester.address)}`
  )) as { asRequester: { id: string }[]; asWorker: { id: string }[] };

  const inAsRequester3 = inbox3.asRequester.some((t) => t.id === taskId);
  if (!inAsRequester3) {
    throw new Error(`taskId ${taskId} missing from asRequester after acceptance`);
  }
  ok('task still in asRequester after acceptance', true);

  console.log('\n=== Agent inbox smoke test passed ===');
  console.log('taskId:', taskId);
}

main().catch((err) => {
  console.error('\nFatal:', err);
  process.exit(1);
});

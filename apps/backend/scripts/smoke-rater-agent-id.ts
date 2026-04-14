/**
 * Rater agent ID smoke test: verifies requesterAgentId is stored on tasks and used
 * in the on-chain rateTask call when the requester has a registered ERC-8004 identity.
 *
 * Flow:
 *   1. Register requester identity (idempotent)
 *   2. Create bounty task
 *   3. Verify task.requesterAgentId is non-null
 *   4. Worker submits work
 *   5. Requester accepts (X402)
 *   6. Requester rates (X402)
 *   7. Verify feedback file has correct value
 *
 * Usage:
 *   REQUESTER_PRIVATE_KEY=0x... WORKER_PRIVATE_KEY=0x... \
 *     npx tsx --env-file=../../.env scripts/smoke-rater-agent-id.ts
 */
import { log, ok, get, post, x402Post, getAccounts, API_URL } from './_x402.ts';

async function main() {
  const { requester, worker } = getAccounts();

  console.log('=== Taskmarket Smoke Test — Rater Agent ID ===');
  console.log('requester:', requester.address);
  console.log('worker:   ', worker.address);
  console.log('api:      ', API_URL);

  // 1. Register requester identity (idempotent — safe to re-run)
  log('1/7', 'Registering requester ERC-8004 identity (X402)...');
  const regResult = (await x402Post('/api/identity/register', {}, requester)) as {
    agentId: string;
    alreadyRegistered: boolean;
  };
  if (!regResult.agentId) {
    throw new Error(`Missing agentId in registration response: ${JSON.stringify(regResult)}`);
  }
  ok('requesterAgentId', regResult.agentId);
  ok('alreadyRegistered', regResult.alreadyRegistered);

  // 2. Register worker identity (so workerAgentId is also populated in feedback)
  log('2/7', 'Registering worker ERC-8004 identity (X402)...');
  const workerReg = (await x402Post('/api/identity/register', {}, worker)) as {
    agentId: string;
    alreadyRegistered: boolean;
  };
  ok('workerAgentId', workerReg.agentId);

  // 3. Create bounty task — server resolves requester's agentId and stores it
  log('3/7', 'Creating bounty task (X402)...');
  const { taskId } = (await x402Post(
    '/api/tasks',
    {
      description: 'Rater agent ID smoke test task',
      reward: '1000',
      duration: 1,
      mode: 'bounty',
      tags: ['smoke-rater-agent-id'],
    },
    requester
  )) as { taskId: string };
  ok('taskId', taskId);

  // 4. Verify task has requesterAgentId populated
  log('4/7', 'Verifying task.requesterAgentId is set...');
  const taskDetail = (await get(`/api/tasks/${taskId}`)) as {
    requesterAgentId: string | null;
  };
  if (!taskDetail.requesterAgentId) {
    throw new Error(
      `Expected requesterAgentId to be set (requester has registered identity), got: ${taskDetail.requesterAgentId}`
    );
  }
  if (taskDetail.requesterAgentId !== regResult.agentId) {
    throw new Error(
      `requesterAgentId mismatch: task has ${taskDetail.requesterAgentId}, expected ${regResult.agentId}`
    );
  }
  ok('requesterAgentId on task', taskDetail.requesterAgentId);

  // 5. Worker submits work
  log('5/7', 'Worker submitting work...');
  const submitSig = await worker.signMessage({ message: `taskmarket:submit:${taskId}` });
  const { submissionId } = (await post(`/api/tasks/${taskId}/submissions`, {
    taskId,
    workerAddress: worker.address,
    file: Buffer.from('rater-agent-id-smoke-payload').toString('base64'),
    signature: submitSig,
  })) as { submissionId: string };
  ok('submissionId', submissionId);

  // 6. Requester accepts
  log('6/7', 'Requester accepting submission (X402)...');
  await x402Post(`/api/tasks/${taskId}/accept`, { taskId, worker: worker.address }, requester);
  ok('accepted', true);

  // 7. Requester rates — raterAgentId is derived server-side from task.requesterAgentId
  log('7/7', 'Requester rating 90/100 (X402) — raterAgentId used server-side...');
  const { feedbackId } = (await x402Post(
    `/api/tasks/${taskId}/rate`,
    {
      taskId,
      worker: worker.address,
      rating: 90,
      feedbackText: 'Rater agent ID smoke test feedback.',
    },
    requester
  )) as { feedbackId: string };
  ok('feedbackId', feedbackId);

  const feedbackFile = (await get(`/api/feedback/${feedbackId}`)) as Record<string, unknown>;
  if (typeof feedbackFile !== 'object' || feedbackFile.value !== 90) {
    throw new Error(`Feedback file invalid: ${JSON.stringify(feedbackFile)}`);
  }
  ok('feedbackFile.value', feedbackFile.value);
  ok('feedbackFile.agentId', feedbackFile.agentId);

  console.log('\n=== Rater agent ID smoke test passed ===');
  console.log('taskId:', taskId);
  console.log('requesterAgentId:', taskDetail.requesterAgentId);
}

main().catch((err) => {
  console.error('\nFatal:', err);
  process.exit(1);
});

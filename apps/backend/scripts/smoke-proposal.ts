/**
 * Proposal mode smoke test: create → propose → select → submit → accept → rate
 *
 * Proposal: worker pitches an approach, requester picks one, selected worker delivers.
 *
 * Usage:
 *   REQUESTER_PRIVATE_KEY=0x... WORKER_PRIVATE_KEY=0x... \
 *     npx tsx --env-file=../../.env scripts/smoke-proposal.ts
 */
import { log, ok, post, x402Post, getAccounts, API_URL } from './_x402.ts';

async function main() {
  const { requester, worker } = getAccounts();

  console.log('=== Clawtasker Smoke Test — Proposal Mode ===');
  console.log('requester:', requester.address);
  console.log('worker:   ', worker.address);
  console.log('api:      ', API_URL);

  // 1. Create task
  log('1/6', 'Creating proposal task (X402)...');
  const { taskId } = (await x402Post(
    '/api/tasks',
    {
      description: 'Build a landing page for a DeFi protocol',
      reward: '1000', // 0.001 USDC
      duration: 1,
      mode: 'proposal',
      tags: ['smoke-test'],
    },
    requester
  )) as { taskId: string };
  ok('taskId', taskId);

  // 2. Worker submits proposal
  log('2/6', 'Worker submitting proposal...');
  const { proposalId } = (await post(`/api/tasks/${taskId}/proposals`, {
    taskId,
    workerAddress: worker.address,
    proposalText: 'I will build a responsive landing page using React and Tailwind CSS with wallet connect integration.',
    estimatedDuration: 8,
    signature: '0x' + '00'.repeat(65),
  })) as { proposalId: string };
  ok('proposalId', proposalId);

  // 3. Requester selects proposal
  log('3/6', 'Requester selecting proposal...');
  await post(`/api/tasks/${taskId}/proposals/select`, {
    taskId,
    proposalId,
    workerAddress: worker.address,
    signature: '0x' + '00'.repeat(65),
  });
  ok('selected', proposalId);

  // 4. Worker submits deliverable
  log('4/6', 'Worker submitting deliverable...');
  const { submissionId } = (await post(`/api/tasks/${taskId}/submissions`, {
    taskId,
    workerAddress: worker.address,
    file: Buffer.from('smoke-test-payload').toString('base64'),
    signature: '0x' + '00'.repeat(65),
  })) as { submissionId: string };
  ok('submissionId', submissionId);

  // 5. Requester accepts
  log('5/6', 'Requester accepting submission (X402)...');
  await x402Post(`/api/tasks/${taskId}/accept`, { taskId, worker: worker.address }, requester);
  ok('accepted', true);

  // 6. Requester rates
  log('6/6', 'Requester rating 5 stars (X402)...');
  await x402Post(
    `/api/tasks/${taskId}/rate`,
    { taskId, worker: worker.address, rating: 5 },
    requester
  );
  ok('rated', '5 stars');

  console.log('\n=== Proposal smoke test passed ✓ ===');
  console.log('taskId:', taskId);
}

main().catch((err) => {
  console.error('\nFatal:', err);
  process.exit(1);
});

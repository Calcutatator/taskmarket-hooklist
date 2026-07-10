/**
 * Multi-submission payout smoke test: create → submit (two workers) → acceptSubmissions → verify
 *
 * Exercises the acceptSubmissions path for Bounty mode:
 *   1. Create a bounty task
 *   2. Worker A submits the first artifact
 *   3. Worker B submits the second artifact
 *   4. Requester calls accept-submissions with two distinct winner slots (60/40 split)
 *   5. Poll until task is completed
 *
 * Two distinct worker keys are required because AcceptanceFacet._resolveDeliverables
 * has an explicit DuplicateAwardWorker guard — the same address cannot appear twice
 * in the winners array. WORKER_B_PRIVATE_KEY must be set; any freshly generated key
 * works and needs no funding — the backend server key relays and pays gas for every
 * on-chain call, worker keys only ever sign off-chain EIP-712 messages.
 *
 * Usage:
 *   REQUESTER_PRIVATE_KEY=0x... WORKER_PRIVATE_KEY=0x... WORKER_B_PRIVATE_KEY=0x... \
 *     npx tsx --env-file=../../.env scripts/smoke-ranked-payout.ts
 */
import { privateKeyToAccount } from 'viem/accounts';
import { log, ok, get, post, x402Post, getAccounts, API_URL } from './_x402.ts';

async function main() {
  const { requester, worker } = getAccounts();

  const workerBKey = process.env.WORKER_B_PRIVATE_KEY as `0x${string}` | undefined;
  if (!workerBKey) {
    console.error(
      'WORKER_B_PRIVATE_KEY is required for the ranked-payout smoke test.\n' +
        'The contract rejects duplicate worker addresses in acceptSubmissions (DuplicateAwardWorker).\n' +
        'Set WORKER_B_PRIVATE_KEY to a second worker private key -- any freshly generated key works,\n' +
        'no funding needed (the backend server key relays and pays gas for all on-chain calls).'
    );
    process.exit(1);
  }
  const workerB = privateKeyToAccount(workerBKey);

  console.log('=== Taskmarket Smoke Test — Multi-Submission Payout (Bounty) ===');
  console.log('requester:', requester.address);
  console.log('workerA:  ', worker.address);
  console.log('workerB:  ', workerB.address);
  console.log('api:      ', API_URL);

  // 1. Create task
  log('1/5', 'Creating bounty task (X402)...');
  const { taskId } = (await x402Post(
    '/api/tasks',
    {
      description: 'Top-2 ranked payout smoke',
      reward: '1000', // 0.001 USDC
      duration: 1,
      mode: 'bounty',
      tags: ['smoke-test', 'ranked'],
    },
    requester
  )) as { taskId: string };
  ok('taskId', taskId);

  // 2. Worker A submits the first artifact
  log('2/5', 'Worker A submitting first artifact...');
  const submitSigA = await worker.signMessage({ message: `taskmarket:submit:${taskId}` });
  const { submissionId: subA } = (await post(`/api/tasks/${taskId}/submissions`, {
    taskId,
    workerAddress: worker.address,
    signature: submitSigA,
    artifacts: [
      {
        fileName: 'ranked-A.txt',
        mimeType: 'text/plain',
        role: 'attachment',
        file: Buffer.from('artifact-A-content').toString('base64'),
      },
    ],
  })) as { submissionId: string };
  ok('submissionA', subA);

  // 3. Worker B submits the second artifact
  log('3/5', 'Worker B submitting second artifact...');
  const submitSigB = await workerB.signMessage({ message: `taskmarket:submit:${taskId}` });
  const { submissionId: subB } = (await post(`/api/tasks/${taskId}/submissions`, {
    taskId,
    workerAddress: workerB.address,
    signature: submitSigB,
    artifacts: [
      {
        fileName: 'ranked-B.txt',
        mimeType: 'text/plain',
        role: 'attachment',
        file: Buffer.from('artifact-B-content').toString('base64'),
      },
    ],
  })) as { submissionId: string };
  ok('submissionB', subB);

  // 4. Requester calls accept-submissions with two distinct winner slots (60/40 split).
  //    Backend resolves each submissionId → deliverableHash.
  log('4/5', 'Requester accept-submissions (X402, 60/40 split)...');
  const result = (await x402Post(
    `/api/tasks/${taskId}/accept-submissions`,
    {
      taskId,
      winners: [
        { worker: worker.address, share: 6000, submissionId: subA },
        { worker: workerB.address, share: 4000, submissionId: subB },
      ],
    },
    requester
  )) as { success: boolean };
  ok('acceptedSubmissions', result.success);

  // 5. Poll until the indexer has processed the TaskCompleted event.
  log('5/5', 'Polling for completed status...');
  let completed = false;
  for (let i = 0; i < 20; i++) {
    const t = (await get(`/api/tasks/${taskId}`)) as { status: string };
    if (t.status === 'completed') {
      completed = true;
      break;
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  if (!completed) {
    throw new Error('Task did not reach completed status within 60s');
  }
  ok('status', 'completed');

  console.log('\n=== Multi-submission payout smoke test passed ===');
  console.log('taskId:  ', taskId);
  console.log('workerA: ', worker.address);
  console.log('workerB: ', workerB.address);
}

main().catch((err) => {
  console.error('\nFatal:', err);
  process.exit(1);
});

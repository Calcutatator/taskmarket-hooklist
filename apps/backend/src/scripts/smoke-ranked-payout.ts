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
 *     npx tsx --env-file=../../.env src/scripts/smoke-ranked-payout.ts
 */
import assert from 'node:assert/strict';
import { createHash } from 'crypto';
import { privateKeyToAccount } from 'viem/accounts';
import { buildSubmitMessage } from '@taskmarket/shared';
import { log, ok, get, post, x402Post, getAccounts, API_URL, pollTask } from './_x402';

function contentHash(payload: string): string {
  return createHash('sha256').update(Buffer.from(payload)).digest('hex');
}

type Award = {
  workerAddress: string;
  rank: number;
  isPrimary: boolean;
  grossAmount: string;
  workerPayment: string;
  platformFee: string;
  rating: number | null;
};

type TaskDetail = {
  id: string;
  status: string;
  worker: string | null;
  submissionCount: number;
  awardCount: number;
  awards: Award[];
  pendingActions: Array<{ action: string; targetWorker?: string | null }>;
  platformFeeBps: number;
};

// AcceptanceFacet computes fee = (amount * feeBps) / 10000 (integer floor division) and
// net = amount - fee. Derived from the task's actual deployed fee bps rather than a fixed
// bps assumption, so this test holds under any DEFAULT_PLATFORM_FEE_BPS deployment.
function expectedAward(grossAmount: bigint, platformFeeBps: number) {
  const fee = (grossAmount * BigInt(platformFeeBps)) / 10000n;
  return {
    gross: grossAmount.toString(),
    net: (grossAmount - fee).toString(),
    fee: fee.toString(),
  };
}

async function expectRejected(
  label: string,
  request: () => Promise<unknown>,
  expectedMessage: string
): Promise<void> {
  try {
    await request();
  } catch (error) {
    assert(error instanceof Error);
    assert.match(error.message, new RegExp(expectedMessage, 'i'));
    ok(label, 'rejected');
    return;
  }
  throw new Error(`Expected ${label} to be rejected`);
}

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
  log('1/7', 'Creating bounty task (X402)...');
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
  await pollTask<TaskDetail>(
    taskId,
    (task) => task.status === 'open',
    'the created task to be indexed as open'
  );
  ok('status', 'open');

  // 2. Worker A submits the first artifact
  log('2/7', 'Worker A submitting first artifact...');
  const submitPayloadA = 'artifact-A-content';
  const submitSigA = await worker.signMessage({
    message: buildSubmitMessage(taskId, [contentHash(submitPayloadA)]),
  });
  const { submissionId: subA } = (await post(`/api/tasks/${taskId}/submissions`, {
    taskId,
    workerAddress: worker.address,
    signature: submitSigA,
    artifacts: [
      {
        fileName: 'ranked-A.txt',
        mimeType: 'text/plain',
        role: 'attachment',
        file: Buffer.from(submitPayloadA).toString('base64'),
      },
    ],
  })) as { submissionId: string };
  ok('submissionA', subA);
  await pollTask<TaskDetail>(
    taskId,
    (task) => task.status === 'open' && task.submissionCount >= 1,
    'the first indexed submission'
  );
  ok('indexed submissions', 1);

  // 3. Worker B submits the second artifact
  log('3/7', 'Worker B submitting second artifact...');
  const submitPayloadB = 'artifact-B-content';
  const submitSigB = await workerB.signMessage({
    message: buildSubmitMessage(taskId, [contentHash(submitPayloadB)]),
  });
  const { submissionId: subB } = (await post(`/api/tasks/${taskId}/submissions`, {
    taskId,
    workerAddress: workerB.address,
    signature: submitSigB,
    artifacts: [
      {
        fileName: 'ranked-B.txt',
        mimeType: 'text/plain',
        role: 'attachment',
        file: Buffer.from(submitPayloadB).toString('base64'),
      },
    ],
  })) as { submissionId: string };
  ok('submissionB', subB);
  await pollTask<TaskDetail>(
    taskId,
    (task) => task.status === 'open' && task.submissionCount >= 2,
    'the second indexed submission'
  );
  ok('indexed submissions', 2);

  // 4. Reject a duplicate worker before accepting two distinct winner slots.
  log('4a/7', 'Checking duplicate award-worker rejection...');
  await expectRejected(
    'duplicate award worker',
    () =>
      x402Post(
        `/api/tasks/${taskId}/accept-submissions`,
        {
          taskId,
          winners: [
            { worker: worker.address, share: 6000, submissionId: subA },
            { worker: worker.address, share: 4000, submissionId: subA },
          ],
        },
        requester
      ),
    'duplicate award worker'
  );
  await pollTask<TaskDetail>(
    taskId,
    (task) => task.status === 'open' && task.awardCount === 0,
    'the rejected split acceptance to leave the task open'
  );

  // Backend resolves each submissionId to its committed deliverable hash.
  log('4b/7', 'Requester accept-submissions (X402, 60/40 split)...');
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
  log('5/7', 'Polling for completed settlement and both awards...');
  const completedTask = await pollTask<TaskDetail>(
    taskId,
    (task) => task.status === 'completed' && task.awards?.length === 2,
    'a complete two-award settlement'
  );
  ok('status', 'completed');

  assert.equal(completedTask.awardCount, 2);
  const primaryAward = completedTask.awards.find((award) => award.isPrimary);
  assert.equal(primaryAward?.workerAddress.toLowerCase(), worker.address.toLowerCase());
  assert.deepEqual(
    completedTask.awards.map((award) => award.workerAddress.toLowerCase()),
    [worker.address.toLowerCase(), workerB.address.toLowerCase()]
  );
  assert.deepEqual(
    completedTask.awards.map((award) => award.rank),
    [1, 2]
  );
  assert.deepEqual(
    completedTask.awards.map((award) => award.isPrimary),
    [true, false]
  );
  assert.deepEqual(
    completedTask.awards.map((award) => ({
      gross: award.grossAmount,
      net: award.workerPayment,
      fee: award.platformFee,
    })),
    [
      expectedAward(600n, completedTask.platformFeeBps),
      expectedAward(400n, completedTask.platformFeeBps),
    ]
  );
  assert.equal(
    completedTask.awards.reduce((total, award) => total + BigInt(award.grossAmount), 0n),
    1000n
  );
  ok('awards', 'two recipients, 60/40 gross, exact net and fee amounts');

  log('6/7', 'Checking secondary-worker task discovery before rating...');
  const workerTasks = (await get(`/api/tasks?worker=${encodeURIComponent(workerB.address)}`)) as {
    tasks: Array<{ id: string }>;
  };
  assert(workerTasks.tasks.some((task) => task.id === taskId));
  const workerInbox = (await get(
    `/api/agents/inbox?address=${encodeURIComponent(workerB.address)}`
  )) as { asWorker: Array<{ id: string }> };
  assert(workerInbox.asWorker.some((task) => task.id === taskId));
  const workerHistory = (await get(
    `/api/agents/${encodeURIComponent(workerB.address)}/work`
  )) as Array<{ taskId: string }>;
  assert(workerHistory.some((task) => task.taskId === taskId));
  ok('secondary discovery', 'filter, inbox, and work history');

  log('7/7', 'Rating each award recipient sequentially...');
  const nonRecipient = '0x000000000000000000000000000000000000dEaD';
  await expectRejected(
    'non-recipient rating',
    () =>
      x402Post(
        `/api/tasks/${taskId}/rate`,
        { taskId, worker: nonRecipient, rating: 70 },
        requester
      ),
    'not an award recipient'
  );

  const initialTargets = completedTask.pendingActions
    .filter((action) => action.action === 'rate')
    .map((action) => action.targetWorker?.toLowerCase());
  assert.deepEqual(
    new Set(initialTargets),
    new Set([worker.address, workerB.address].map((address) => address.toLowerCase()))
  );

  await x402Post(
    `/api/tasks/${taskId}/rate`,
    { taskId, worker: worker.address, rating: 90 },
    requester
  );
  const afterPrimaryRating = await pollTask<TaskDetail>(
    taskId,
    (task) =>
      task.awards.some(
        (award) =>
          award.workerAddress.toLowerCase() === worker.address.toLowerCase() && award.rating === 90
      ),
    'the primary recipient rating'
  );
  assert.deepEqual(
    afterPrimaryRating.pendingActions
      .filter((action) => action.action === 'rate')
      .map((action) => action.targetWorker?.toLowerCase()),
    [workerB.address.toLowerCase()]
  );

  await expectRejected(
    'already-rated recipient',
    () =>
      x402Post(
        `/api/tasks/${taskId}/rate`,
        { taskId, worker: worker.address, rating: 75 },
        requester
      ),
    'already rated'
  );

  await x402Post(
    `/api/tasks/${taskId}/rate`,
    { taskId, worker: workerB.address, rating: 80 },
    requester
  );
  const fullyRated = await pollTask<TaskDetail>(
    taskId,
    (task) =>
      task.awards.every((award) => award.rating !== null) &&
      task.pendingActions.every((action) => action.action !== 'rate'),
    'both recipient ratings'
  );
  assert.equal(
    fullyRated.pendingActions.some((action) => action.action === 'rate'),
    false
  );
  assert.deepEqual(
    fullyRated.awards.map((award) => award.rating),
    [90, 80]
  );
  ok('ratings', 'one targeted action per remaining unrated winner');

  console.log('\n=== Multi-submission payout smoke test passed ===');
  console.log('taskId:  ', taskId);
  console.log('workerA: ', worker.address);
  console.log('workerB: ', workerB.address);
}

main().catch((err) => {
  console.error('\nFatal:', err);
  process.exit(1);
});

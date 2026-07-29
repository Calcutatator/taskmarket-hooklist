/**
 * Refund-expired smoke test: verifies the full refund flow for an expired bounty
 * task that received no submissions, and verifies that a task with a submission
 * does NOT surface the refund_expired action (on-chain guard still applies).
 *
 * Scenarios:
 *   A. Create bounty → let it expire with no submissions → assert refund_expired
 *      in pendingActions → call refundExpired (X402) → poll until status=expired
 *   B. Create bounty → submit work → let it expire → assert refund_expired is
 *      absent from pendingActions (has submissions, on-chain refund would revert)
 *   C. Create bounty → let it expire with no submissions → worker (not the
 *      requester) calls refundExpired → succeeds (ADR-0026: permissionless)
 *
 * Usage:
 *   REQUESTER_PRIVATE_KEY=0x... WORKER_PRIVATE_KEY=0x... \
 *     npx tsx --env-file=../../.env src/scripts/smoke-refund-expired.ts
 */
import { createHash } from 'crypto';
import { buildSubmitMessage } from '@taskmarket/shared';
import { log, ok, get, post, x402Post, getAccounts, API_URL, pollUntil } from './_x402';

function contentHash(payload: string): string {
  return createHash('sha256').update(Buffer.from(payload)).digest('hex');
}

type PendingAction = { role: string; action: string; command: string };
type TaskResponse = {
  status: string;
  submissionWindowOpen: boolean;
  pendingActions: PendingAction[];
};

async function main() {
  const { requester, worker } = getAccounts();

  console.log('=== Taskmarket Smoke Test — Refund Expired ===');
  console.log('requester:', requester.address);
  console.log('worker:   ', worker.address);
  console.log('api:      ', API_URL);

  // --- Scenario A: no submissions → refund_expired surfaces → refund succeeds ---

  log('A1/5', 'Creating bounty task with 1-second duration (no submissions will be sent)...');
  const { taskId: taskA } = (await x402Post(
    '/api/tasks',
    {
      description: 'Refund-expired smoke test task A (no submissions)',
      reward: '1000',
      duration: 1 / 3600,
      mode: 'bounty',
      tags: ['smoke-refund-expired'],
    },
    requester
  )) as { taskId: string };
  ok('taskId (A)', taskA);

  log('A2/5', 'Polling until submission window closes (expiryTime passes)...');
  const expiredTaskA = await pollUntil(
    () => get(`/api/tasks/${taskA}`) as Promise<TaskResponse>,
    (t) => !t.submissionWindowOpen,
    { label: 'submissionWindowOpen=false', timeoutMs: 30000 }
  );
  ok('submissionWindowOpen', expiredTaskA.submissionWindowOpen);
  ok('status', expiredTaskA.status);

  log('A3/5', 'Asserting refund_expired action is present in pendingActions...');
  const refundAction = expiredTaskA.pendingActions.find((a) => a.action === 'refund_expired');
  if (!refundAction) {
    throw new Error(
      `Expected refund_expired in pendingActions. Got: ${JSON.stringify(expiredTaskA.pendingActions)}`
    );
  }
  if (refundAction.role !== 'requester') {
    throw new Error(`Expected refund_expired role=requester, got ${refundAction.role}`);
  }
  if (!refundAction.command.includes(taskA)) {
    throw new Error(
      `Expected refund_expired command to include taskId. Got: ${refundAction.command}`
    );
  }
  ok('refund_expired action present', true);
  ok('refund_expired role', refundAction.role);
  ok('refund_expired command', refundAction.command);

  log('A4/5', 'Calling refundExpired (X402)...');
  const refundResult = (await x402Post(
    `/api/tasks/${taskA}/refund-expired`,
    { taskId: taskA },
    requester
  )) as { txHash?: string };
  if (!refundResult.txHash) {
    throw new Error(
      `Expected txHash in refundExpired response. Got: ${JSON.stringify(refundResult)}`
    );
  }
  ok('txHash', refundResult.txHash);

  log('A5/5', 'Polling until task status flips to expired (indexer)...');
  const finalTaskA = await pollUntil(
    () => get(`/api/tasks/${taskA}`) as Promise<TaskResponse>,
    (t) => t.status === 'expired',
    { label: 'status=expired', timeoutMs: 60000 }
  );
  ok('final status', finalTaskA.status);
  if (finalTaskA.pendingActions.length !== 0) {
    throw new Error(
      `Expected empty pendingActions after refund. Got: ${JSON.stringify(finalTaskA.pendingActions)}`
    );
  }
  ok('pendingActions after refund', finalTaskA.pendingActions.length);

  console.log('\n--- Scenario A passed: no-submission bounty refunded successfully ---');

  // --- Scenario B: bounty with a submission → refund_expired must NOT appear ---

  log(
    'B1/3',
    'Creating second bounty task (30s window — submit immediately, then wait for expiry)...'
  );
  const { taskId: taskB } = (await x402Post(
    '/api/tasks',
    {
      description: 'Refund-expired smoke test task B (has submission)',
      reward: '1000',
      duration: 30 / 3600,
      mode: 'bounty',
      tags: ['smoke-refund-expired'],
    },
    requester
  )) as { taskId: string };
  ok('taskId (B)', taskB);

  log('B2/3', 'Worker submitting work before expiry...');
  const submitPayload = 'smoke-refund-expired-scenario-b';
  const submitSig = await worker.signMessage({
    message: buildSubmitMessage(taskB, [contentHash(submitPayload)]),
  });
  await post(`/api/tasks/${taskB}/submissions`, {
    taskId: taskB,
    workerAddress: worker.address,
    signature: submitSig,
    artifacts: [
      {
        fileName: 'submission.txt',
        mimeType: 'text/plain',
        role: 'attachment',
        file: Buffer.from(submitPayload).toString('base64'),
      },
    ],
  });
  ok('submission created', true);

  log('B3/3', 'Polling until submission window closes and verifying NO refund_expired action...');
  const expiredTaskB = await pollUntil(
    () => get(`/api/tasks/${taskB}`) as Promise<TaskResponse>,
    (t) => !t.submissionWindowOpen,
    { label: 'submissionWindowOpen=false', timeoutMs: 90000 }
  );
  ok('submissionWindowOpen', expiredTaskB.submissionWindowOpen);

  const hasRefundAction = expiredTaskB.pendingActions.some((a) => a.action === 'refund_expired');
  if (hasRefundAction) {
    throw new Error(
      `refund_expired must NOT appear when task has submissions. Got: ${JSON.stringify(expiredTaskB.pendingActions)}`
    );
  }
  ok('refund_expired absent (has submissions)', true);
  ok('pendingActions', JSON.stringify(expiredTaskB.pendingActions));

  console.log('\n--- Scenario B passed: bounty with submission correctly blocks refund action ---');

  // --- Scenario C: non-requester (worker) calls refundExpired → succeeds ---

  log('C1/3', 'Creating third bounty task with 1-second duration (no submissions)...');
  const { taskId: taskC } = (await x402Post(
    '/api/tasks',
    {
      description: 'Refund-expired smoke test task C (non-requester refund)',
      reward: '1000',
      duration: 1 / 3600,
      mode: 'bounty',
      tags: ['smoke-refund-expired'],
    },
    requester
  )) as { taskId: string };
  ok('taskId (C)', taskC);

  log('C2/3', 'Polling until submission window closes (expiryTime passes)...');
  await pollUntil(
    () => get(`/api/tasks/${taskC}`) as Promise<TaskResponse>,
    (t) => !t.submissionWindowOpen,
    { label: 'submissionWindowOpen=false', timeoutMs: 30000 }
  );

  log('C3/3', 'Worker (non-requester) calling refundExpired (X402)...');
  const nonRequesterRefund = (await x402Post(
    `/api/tasks/${taskC}/refund-expired`,
    { taskId: taskC },
    worker
  )) as { txHash?: string };
  if (!nonRequesterRefund.txHash) {
    throw new Error(
      `Expected txHash from non-requester refundExpired. Got: ${JSON.stringify(nonRequesterRefund)}`
    );
  }
  ok('non-requester txHash', nonRequesterRefund.txHash);

  const finalTaskC = await pollUntil(
    () => get(`/api/tasks/${taskC}`) as Promise<TaskResponse>,
    (t) => t.status === 'expired',
    { label: 'status=expired', timeoutMs: 60000 }
  );
  ok('final status (C)', finalTaskC.status);

  console.log('\n--- Scenario C passed: non-requester successfully refunded an expired task ---');

  console.log('\n=== Refund-expired smoke test passed ===');
  console.log('taskA (refunded):', taskA, '  txHash:', refundResult.txHash);
  console.log('taskB (has sub, no refund action):', taskB);
  console.log('taskC (refunded by non-requester):', taskC, '  txHash:', nonRequesterRefund.txHash);
}

main().catch((err) => {
  console.error('\nFatal:', err);
  process.exit(1);
});

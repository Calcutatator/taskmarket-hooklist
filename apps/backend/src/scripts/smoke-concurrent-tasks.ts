/**
 * Concurrent finalize-verdict smoke test: regression coverage for the server-wallet nonce
 * race (docs/adr/0019-server-wallet-nonce-manager-for-concurrent-relayed-calls.md) on a code
 * path other than identity registration.
 *
 * smoke-identity.ts already covers the concurrent path that first surfaced the bug
 * (contractRegisterIdentity via devices.router.ts's background call). This test exercises a
 * different call site that shares the exact same server wallet (createServerWallet(),
 * apps/backend/src/lib/wallet.ts) for every relayed transaction: contractFinalizeVerdict
 * (apps/backend/src/services/contract.ts), reached via the permissionless
 * POST /api/tasks/{taskId}/finalize-verdict endpoint.
 *
 * finalizeVerdict is used (rather than concurrent task creation) because task creation is
 * gated by X402 payment, and settling an X402 payment goes through the external facilitator
 * process (X402_FACILITATOR_URL) -- a dependency outside this repo. That facilitator has its
 * own separate nonce-management concerns when settling several payments at once, which is not
 * something taskmarket's codebase can fix and is out of scope for this smoke test. finalizeVerdict
 * requires no payment, so firing several concurrently exercises only taskmarket's own
 * server-wallet relay path.
 *
 * Setup (task creation, claim, submit, evaluate) is done sequentially per task -- each of
 * those steps individually already has dedicated coverage in smoke-evaluator.ts, so nothing
 * is lost by not parallelizing them here. Only the finalize-verdict calls are fired
 * concurrently, which is the step that actually exercises the shared transaction dispatcher.
 *
 * EvaluatorFacet.assignEvaluator rejects evaluator == requester (self-assignment
 * guard), so this test signs evaluate() with a distinct EVALUATOR_PRIVATE_KEY
 * account. It never disputes, so no dispute resolver is assigned. It also enforces
 * a minimum one-minute appeal window (MIN_APPEAL_WINDOW_SECS).
 *
 * Usage:
 *   REQUESTER_PRIVATE_KEY=0x... WORKER_PRIVATE_KEY=0x... EVALUATOR_PRIVATE_KEY=0x... \
 *     npx tsx --env-file=../../.env src/scripts/smoke-concurrent-tasks.ts
 */
import { createHash } from 'crypto';
import { privateKeyToAccount } from 'viem/accounts';
import { buildSubmitMessage } from '@taskmarket/shared';
import { log, ok, get, post, x402Post, getAccounts, pollTaskStatus, sleep, API_URL } from './_x402';

function contentHash(payload: string): string {
  return createHash('sha256').update(Buffer.from(payload)).digest('hex');
}

const CONCURRENCY = 3;

const evaluatorKey = process.env.EVALUATOR_PRIVATE_KEY as `0x${string}` | undefined;
if (!evaluatorKey) {
  console.error(
    'Missing EVALUATOR_PRIVATE_KEY.\n' +
      'assignEvaluator now rejects evaluator == requester (self-assignment guard) -- set\n' +
      'EVALUATOR_PRIVATE_KEY to a distinct account. Any freshly generated key works, same\n' +
      'as WORKER_B_PRIVATE_KEY.'
  );
  process.exit(1);
}
const evaluator = privateKeyToAccount(evaluatorKey);

async function setupAppealingTask(
  requester: ReturnType<typeof getAccounts>['requester'],
  worker: ReturnType<typeof getAccounts>['worker'],
  label: string
): Promise<string> {
  const { taskId } = (await x402Post(
    '/api/tasks',
    {
      description: `Concurrent finalize-verdict smoke test task ${label}`,
      reward: '1000',
      duration: 300,
      mode: 'claim',
      tags: ['smoke-concurrent-tasks'],
      evaluator: evaluator.address,
      evaluationWindowHours: 0.00139, // ~5 seconds
      appealWindowHours: 0.0167, // ~60 seconds — MIN_APPEAL_WINDOW_SECS floor
    },
    requester
  )) as { taskId: string };

  const claimSig = await worker.signMessage({ message: `taskmarket:claim:${taskId}` });
  await post(`/api/tasks/${taskId}/claim`, {
    taskId,
    workerAddress: worker.address,
    signature: claimSig,
  });

  const submitPayload = `smoke-concurrent-tasks-payload-${label}`;
  const submitSig = await worker.signMessage({
    message: buildSubmitMessage(taskId, [contentHash(submitPayload)]),
  });
  await post(`/api/tasks/${taskId}/submissions`, {
    taskId,
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

  await pollTaskStatus<{ status: string }>(taskId, ['review'], { timeoutMs: 45_000 });

  await x402Post(
    `/api/tasks/${taskId}/evaluate`,
    { taskId, verdict: 'approve', score: 900, confidence: 950 },
    evaluator
  );

  await pollTaskStatus<{ status: string }>(taskId, ['appealing'], { timeoutMs: 45_000 });

  return taskId;
}

async function main() {
  const { requester, worker } = getAccounts();

  console.log('=== Taskmarket Smoke Test — Concurrent Finalize Verdict ===');
  console.log('requester:', requester.address);
  console.log('worker:   ', worker.address);
  console.log('evaluator:', evaluator.address);
  console.log('api:      ', API_URL);

  log('1/3', `Setting up ${CONCURRENCY} tasks (sequentially) into the appealing state...`);
  const taskIds: string[] = [];
  for (let i = 0; i < CONCURRENCY; i++) {
    const taskId = await setupAppealingTask(requester, worker, String(i));
    taskIds.push(taskId);
  }
  ok('tasks in appealing state', taskIds);

  log('2/3', 'Waiting 65s for all appeal windows to expire...');
  await sleep(65000);

  log('3/3', `Calling finalize-verdict for all ${CONCURRENCY} tasks concurrently...`);
  const results = await Promise.all(
    taskIds.map((taskId) => post(`/api/tasks/${taskId}/finalize-verdict`, { taskId }))
  );
  const txHashes = results.map((r) => (r as { txHash: string }).txHash);

  const missing = txHashes.filter((tx) => !tx);
  if (missing.length > 0) {
    throw new Error(`${missing.length}/${CONCURRENCY} finalize-verdict calls returned no txHash`);
  }

  const unique = new Set(txHashes);
  if (unique.size !== txHashes.length) {
    throw new Error(
      `Expected ${txHashes.length} distinct txHashes, got duplicates: ${txHashes.join(', ')}`
    );
  }
  ok('all finalize-verdict txHashes distinct', txHashes);

  for (const taskId of taskIds) {
    const task = (await get(`/api/tasks/${taskId}`)) as { status: string };
    if (task.status !== 'completed') {
      throw new Error(`Task ${taskId} expected status completed, got ${task.status}`);
    }
  }
  ok('every task reached completed', true);

  console.log('\n=== Concurrent finalize-verdict smoke test passed ===');
}

main().catch((err) => {
  console.error('\nFatal:', err);
  process.exit(1);
});

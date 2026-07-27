/**
 * Evaluator flow smoke test — three scenarios:
 *   A. APPROVE verdict, no appeal, finalize → completed
 *   B. REJECT verdict, no appeal, finalize → cancelled (refund + terminate,
 *      not reopened — see EvaluatorFacet.finalizeVerdict's REJECT branch)
 *   C. APPROVE verdict, worker appeals, dispute resolver settles → completed
 *
 * EvaluatorFacet.assignEvaluator rejects evaluator == requester and
 * disputeResolver == requester (self-assignment guard), so this test signs
 * evaluate()/resolve-dispute() with a distinct EVALUATOR_PRIVATE_KEY account
 * used as both evaluator and dispute resolver. It also enforces a minimum
 * one-minute appeal window (MIN_APPEAL_WINDOW_SECS), so windows here are
 * sized in whole minutes rather than a few seconds.
 *
 * Usage:
 *   REQUESTER_PRIVATE_KEY=0x... WORKER_PRIVATE_KEY=0x... EVALUATOR_PRIVATE_KEY=0x... \
 *     npx tsx --env-file=../../.env src/scripts/smoke-evaluator.ts
 */
import { createHash } from 'crypto';
import { privateKeyToAccount } from 'viem/accounts';
import { buildSubmitMessage } from '@taskmarket/shared';
import {
  log,
  ok,
  get,
  post,
  x402Post,
  getAccounts,
  API_URL,
  pollTaskStatus,
  sleep,
  nudgeChainForward,
} from './_x402';

function contentHash(payload: string): string {
  return createHash('sha256').update(Buffer.from(payload)).digest('hex');
}

const evaluatorKey = process.env.EVALUATOR_PRIVATE_KEY as `0x${string}` | undefined;
if (!evaluatorKey) {
  console.error(
    'Missing EVALUATOR_PRIVATE_KEY.\n' +
      'assignEvaluator now rejects evaluator == requester and disputeResolver == requester\n' +
      '(self-assignment guard) -- set EVALUATOR_PRIVATE_KEY to a distinct account. Any\n' +
      'freshly generated key works, same as WORKER_B_PRIVATE_KEY.'
  );
  process.exit(1);
}
const evaluator = privateKeyToAccount(evaluatorKey);

async function pollStatus(taskId: string, expected: string[]): Promise<string> {
  const task = await pollTaskStatus<{ status: string }>(taskId, expected, {
    timeoutMs: 45_000,
  });
  return task.status;
}

async function runScenario(label: string, fn: () => Promise<void>): Promise<boolean> {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`SCENARIO ${label}`);
  console.log('='.repeat(60));
  try {
    await fn();
    console.log(`\nSCENARIO ${label}: PASS`);
    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`\nSCENARIO ${label}: FAIL — ${message}`);
    return false;
  }
}

// Shared setup: create claim task → worker claims → worker submits → requester accepts (→ review)
async function setupReviewTask(opts: {
  requester: ReturnType<typeof getAccounts>['requester'];
  worker: ReturnType<typeof getAccounts>['worker'];
  label: string;
  evaluationWindowHours: number;
  appealWindowHours: number;
}): Promise<string> {
  const { requester, worker, label, evaluationWindowHours, appealWindowHours } = opts;

  log('1/5', `[${label}] Creating claim task with evaluator...`);
  const { taskId } = (await x402Post(
    '/api/tasks',
    {
      description: `Evaluator smoke test — ${label}`,
      reward: '1000',
      duration: 300,
      mode: 'claim',
      tags: ['smoke-evaluator'],
      evaluator: evaluator.address,
      disputeResolver: evaluator.address,
      evaluationWindowHours,
      appealWindowHours,
    },
    requester
  )) as { taskId: string };
  ok('taskId', taskId);

  log('2/5', `[${label}] Worker claiming task...`);
  const claimSig = await worker.signMessage({ message: `taskmarket:claim:${taskId}` });
  await post(`/api/tasks/${taskId}/claim`, {
    taskId,
    workerAddress: worker.address,
    signature: claimSig,
  });
  const claimed = (await get(`/api/tasks/${taskId}`)) as { status: string };
  if (claimed.status !== 'claimed') {
    throw new Error(`Expected claimed, got ${claimed.status}`);
  }
  ok('status', claimed.status);

  log('3/5', `[${label}] Worker submitting work...`);
  const submitPayload = 'smoke-evaluator-payload';
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
  ok('submitted', true);

  // CoreFacet.submitWork auto-transitions CLAIM/PITCH/AUCTION tasks with an
  // evaluator assigned straight to Review -- no separate accept call exists
  // or is needed on this path (acceptSubmission is for the non-evaluator flow).
  // The backend's DB status lags the on-chain transition until the indexer
  // processes the TaskSubmitted event (polls every ~12s), so poll rather than
  // sleep-once.
  log('4/5', `[${label}] Waiting for auto-transition to review (indexer poll)...`);
  const reviewStatus = await pollStatus(taskId, ['review']);
  ok('status after submit', reviewStatus);

  return taskId;
}

// --- Scenario A: APPROVE verdict, no appeal, finalize → completed ---
async function scenarioA(
  requester: ReturnType<typeof getAccounts>['requester'],
  worker: ReturnType<typeof getAccounts>['worker']
) {
  const taskId = await setupReviewTask({
    requester,
    worker,
    label: 'A',
    evaluationWindowHours: 0.00139, // ~5 seconds
    appealWindowHours: 0.0167, // ~60 seconds — MIN_APPEAL_WINDOW_SECS floor
  });

  log('5/8', '[A] Evaluator submitting APPROVE verdict...');
  const { txHash: evalTx } = (await x402Post(
    `/api/tasks/${taskId}/evaluate`,
    {
      taskId,
      verdict: 'approve',
      score: 900,
      confidence: 950,
    },
    evaluator
  )) as { txHash: string };
  ok('evaluate txHash', evalTx);

  const afterEval = await pollStatus(taskId, ['appealing']);
  ok('status after evaluate', afterEval);

  log('6/8', '[A] Waiting 65s for appeal window to expire...');
  await sleep(65000);
  // Syncs Anvil's frozen block.timestamp forward -- see nudgeChainForward in _x402.ts.
  await nudgeChainForward();

  log('7/8', '[A] Calling finalizeVerdict (permissionless)...');
  const { txHash: finalizeTx } = (await post(`/api/tasks/${taskId}/finalize-verdict`, {
    taskId,
  })) as { txHash: string };
  ok('finalize txHash', finalizeTx);

  log('8/8', '[A] Polling for completed status...');
  const finalStatus = await pollStatus(taskId, ['completed', 'accepted']);
  ok('final status', finalStatus);
}

// --- Scenario B: REJECT verdict, no appeal, finalize → cancelled ---
async function scenarioB(
  requester: ReturnType<typeof getAccounts>['requester'],
  worker: ReturnType<typeof getAccounts>['worker']
) {
  const taskId = await setupReviewTask({
    requester,
    worker,
    label: 'B',
    evaluationWindowHours: 0.00139, // ~5 seconds
    appealWindowHours: 0.0167, // ~60 seconds — MIN_APPEAL_WINDOW_SECS floor
  });

  log('5/8', '[B] Evaluator submitting REJECT verdict...');
  const { txHash: evalTx } = (await x402Post(
    `/api/tasks/${taskId}/evaluate`,
    {
      taskId,
      verdict: 'reject',
      score: 0,
      confidence: 900,
    },
    evaluator
  )) as { txHash: string };
  ok('evaluate txHash', evalTx);

  const afterEval = await pollStatus(taskId, ['appealing']);
  ok('status after evaluate', afterEval);

  log('6/8', '[B] Waiting 65s for appeal window to expire...');
  await sleep(65000);
  // Syncs Anvil's frozen block.timestamp forward -- see nudgeChainForward in _x402.ts.
  await nudgeChainForward();

  log('7/8', '[B] Calling finalizeVerdict (permissionless)...');
  const { txHash: finalizeTx } = (await post(`/api/tasks/${taskId}/finalize-verdict`, {
    taskId,
  })) as { txHash: string };
  ok('finalize txHash', finalizeTx);

  log('8/8', '[B] Polling for cancelled status (task terminates after REJECT)...');
  const finalStatus = await pollStatus(taskId, ['cancelled']);
  ok('final status', finalStatus);
}

// --- Scenario C: APPROVE verdict, worker appeals, dispute resolver settles → completed ---
async function scenarioC(
  requester: ReturnType<typeof getAccounts>['requester'],
  worker: ReturnType<typeof getAccounts>['worker']
) {
  const taskId = await setupReviewTask({
    requester,
    worker,
    label: 'C',
    evaluationWindowHours: 0.00139, // ~5 seconds
    appealWindowHours: 0.02, // ~72 seconds — above the 60s floor, long enough for worker to appeal
  });

  log('5/9', '[C] Evaluator submitting APPROVE verdict...');
  const { txHash: evalTx } = (await x402Post(
    `/api/tasks/${taskId}/evaluate`,
    {
      taskId,
      verdict: 'approve',
      score: 700,
      confidence: 800,
    },
    evaluator
  )) as { txHash: string };
  ok('evaluate txHash', evalTx);

  const afterEval = await pollStatus(taskId, ['appealing']);
  ok('status after evaluate', afterEval);

  log('6/9', '[C] Waiting 7s for evaluation window to expire (appeal window still open)...');
  await sleep(7000);

  log('7/9', '[C] Worker filing appeal...');
  const { txHash: appealTx } = (await x402Post(
    `/api/tasks/${taskId}/appeal`,
    { taskId },
    worker
  )) as { txHash: string };
  ok('appeal txHash', appealTx);

  const afterAppeal = await pollStatus(taskId, ['disputed']);
  ok('status after appeal', afterAppeal);

  log('8/9', '[C] Dispute resolver settling dispute (APPROVE, partial award)...');
  const { txHash: resolveTx } = (await x402Post(
    `/api/tasks/${taskId}/resolve-dispute`,
    {
      taskId,
      verdict: 'approve',
      awards: [{ worker: worker.address, amount: '900', rank: 1 }],
    },
    evaluator
  )) as { txHash: string };
  ok('resolve txHash', resolveTx);

  log('9/9', '[C] Polling for completed status...');
  const finalStatus = await pollStatus(taskId, ['completed', 'accepted']);
  ok('final status', finalStatus);
}

async function main() {
  const { requester, worker } = getAccounts();

  console.log('=== Taskmarket Smoke Test — Evaluator Flow ===');
  console.log('requester:', requester.address);
  console.log('worker:   ', worker.address);
  console.log('evaluator:', evaluator.address);
  console.log('api:      ', API_URL);

  const results: boolean[] = [];

  results.push(
    await runScenario('A — APPROVE verdict, no appeal, finalize → completed', () =>
      scenarioA(requester, worker)
    )
  );

  results.push(
    await runScenario('B — REJECT verdict, no appeal, finalize → cancelled', () =>
      scenarioB(requester, worker)
    )
  );

  results.push(
    await runScenario(
      'C — APPROVE verdict, worker appeals, dispute resolver settles → completed',
      () => scenarioC(requester, worker)
    )
  );

  console.log('\n' + '='.repeat(60));
  console.log('RESULTS');
  console.log('='.repeat(60));
  const labels = ['A', 'B', 'C'];
  results.forEach((passed, i) => {
    console.log(`  Scenario ${labels[i]}: ${passed ? 'PASS' : 'FAIL'}`);
  });

  const allPassed = results.every(Boolean);
  if (!allPassed) {
    console.error('\nOne or more scenarios failed.');
    process.exit(1);
  }
  console.log('\nAll evaluator scenarios passed.');
}

main().catch((err) => {
  console.error('\nFatal:', err instanceof Error ? err.message : err);
  process.exit(1);
});

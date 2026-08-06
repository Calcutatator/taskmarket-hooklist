/**
 * Evaluator flow smoke test — three scenarios with four distinct actors:
 *   A. APPROVE verdict, no appeal, finalize → completed
 *   B. REJECT verdict, no appeal, finalize → cancelled (refund + terminate,
 *      not reopened — see EvaluatorFacet.finalizeVerdict's REJECT branch)
 *   C. APPROVE verdict, worker appeals, dispute resolver settles → completed
 *
 * Usage:
 *   REQUESTER_PRIVATE_KEY=0x... WORKER_PRIVATE_KEY=0x... \
 *     EVALUATOR_PRIVATE_KEY=0x... WORKER_B_PRIVATE_KEY=0x... \
 *     npx tsx --env-file=../../.env src/scripts/smoke-evaluator.ts
 */
import { createHash } from 'crypto';
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
  expectActionQueueIntent,
  expectRejected,
  getEvaluatorAccounts,
} from './_x402';

type SmokeAccount = ReturnType<typeof getAccounts>['requester'];

function contentHash(payload: string): string {
  return createHash('sha256').update(Buffer.from(payload)).digest('hex');
}

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
  evaluator: SmokeAccount;
  resolver: SmokeAccount;
  label: string;
  evaluationWindowHours: number;
  appealWindowHours: number;
}): Promise<string> {
  const {
    requester,
    worker,
    evaluator,
    resolver,
    label,
    evaluationWindowHours,
    appealWindowHours,
  } = opts;

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
      disputeResolver: resolver.address,
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
  requester: SmokeAccount,
  worker: SmokeAccount,
  evaluator: SmokeAccount,
  resolver: SmokeAccount
) {
  const taskId = await setupReviewTask({
    requester,
    worker,
    evaluator,
    resolver,
    label: 'A',
    evaluationWindowHours: 0.00139, // ~5 seconds
    appealWindowHours: 0.00139, // ~5 seconds
  });

  await expectActionQueueIntent(taskId, evaluator, 'evaluate_work', true);
  await expectRejected('wrong evaluator', () =>
    x402Post(
      `/api/tasks/${taskId}/evaluate`,
      { taskId, verdict: 'approve', score: 900, confidence: 950 },
      requester
    )
  );

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
  await expectActionQueueIntent(taskId, evaluator, 'evaluate_work', false);
  await expectActionQueueIntent(taskId, worker, 'appeal_verdict', true);
  await expectRejected('early finalize', () =>
    post(`/api/tasks/${taskId}/finalize-verdict`, { taskId })
  );

  log('6/8', '[A] Waiting 8s for appeal window to expire...');
  await sleep(8000);
  // Syncs Anvil's frozen block.timestamp forward -- see nudgeChainForward in _x402.ts.
  await nudgeChainForward();
  await expectRejected('appeal after its deadline', () =>
    x402Post(`/api/tasks/${taskId}/appeal`, { taskId }, worker)
  );

  log('7/8', '[A] Calling finalizeVerdict (permissionless)...');
  const { txHash: finalizeTx } = (await post(`/api/tasks/${taskId}/finalize-verdict`, {
    taskId,
  })) as { txHash: string };
  ok('finalize txHash', finalizeTx);

  log('8/8', '[A] Polling for completed status...');
  const finalStatus = await pollStatus(taskId, ['completed', 'accepted']);
  ok('final status', finalStatus);
  await expectActionQueueIntent(taskId, worker, 'appeal_verdict', false);
  await expectRejected('duplicate finalize', () =>
    post(`/api/tasks/${taskId}/finalize-verdict`, { taskId })
  );
}

// --- Scenario B: REJECT verdict, no appeal, finalize → cancelled ---
async function scenarioB(
  requester: SmokeAccount,
  worker: SmokeAccount,
  evaluator: SmokeAccount,
  resolver: SmokeAccount
) {
  const taskId = await setupReviewTask({
    requester,
    worker,
    evaluator,
    resolver,
    label: 'B',
    evaluationWindowHours: 0.00139, // ~5 seconds
    appealWindowHours: 0.00139, // ~5 seconds
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

  log('6/8', '[B] Waiting 8s for appeal window to expire...');
  await sleep(8000);
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
  await expectActionQueueIntent(taskId, evaluator, 'evaluate_work', false);
}

// --- Scenario C: APPROVE verdict, worker appeals, dispute resolver settles → completed ---
async function scenarioC(
  requester: SmokeAccount,
  worker: SmokeAccount,
  evaluator: SmokeAccount,
  resolver: SmokeAccount
) {
  const taskId = await setupReviewTask({
    requester,
    worker,
    evaluator,
    resolver,
    label: 'C',
    evaluationWindowHours: 0.00139, // ~5 seconds
    appealWindowHours: 0.01, // ~36 seconds — long enough for worker to appeal
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

  await expectRejected('wrong appellant', () =>
    x402Post(`/api/tasks/${taskId}/appeal`, { taskId }, requester)
  );

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
  await expectActionQueueIntent(taskId, resolver, 'resolve_dispute', true);
  await expectRejected('wrong dispute resolver', () =>
    x402Post(
      `/api/tasks/${taskId}/resolve-dispute`,
      {
        taskId,
        verdict: 'approve',
        awards: [{ worker: worker.address, amount: '900', rank: 1 }],
      },
      evaluator
    )
  );

  log('8/9', '[C] Dispute resolver settling dispute (APPROVE, partial award)...');
  const { txHash: resolveTx } = (await x402Post(
    `/api/tasks/${taskId}/resolve-dispute`,
    {
      taskId,
      verdict: 'approve',
      awards: [{ worker: worker.address, amount: '900', rank: 1 }],
    },
    resolver
  )) as { txHash: string };
  ok('resolve txHash', resolveTx);

  log('9/9', '[C] Polling for completed status...');
  const finalStatus = await pollStatus(taskId, ['completed', 'accepted']);
  ok('final status', finalStatus);
  await expectActionQueueIntent(taskId, resolver, 'resolve_dispute', false);
  await expectRejected('duplicate dispute resolution', () =>
    x402Post(
      `/api/tasks/${taskId}/resolve-dispute`,
      {
        taskId,
        verdict: 'approve',
        awards: [{ worker: worker.address, amount: '900', rank: 1 }],
      },
      resolver
    )
  );
}

async function main() {
  const { requester, worker, evaluator, resolver } = getEvaluatorAccounts();

  console.log('=== Taskmarket Smoke Test — Evaluator Flow ===');
  console.log('requester:', requester.address);
  console.log('worker:   ', worker.address);
  console.log('evaluator:', evaluator.address);
  console.log('resolver: ', resolver.address);
  console.log('api:      ', API_URL);

  const results: boolean[] = [];

  results.push(
    await runScenario('A — APPROVE verdict, no appeal, finalize → completed', () =>
      scenarioA(requester, worker, evaluator, resolver)
    )
  );

  results.push(
    await runScenario('B — REJECT verdict, no appeal, finalize → cancelled', () =>
      scenarioB(requester, worker, evaluator, resolver)
    )
  );

  results.push(
    await runScenario(
      'C — APPROVE verdict, worker appeals, dispute resolver settles → completed',
      () => scenarioC(requester, worker, evaluator, resolver)
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

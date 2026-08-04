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
 * used as both evaluator and dispute resolver.
 *
 * MUTATES PROTOCOL CONFIGURATION. Two of the three scenarios spend their
 * runtime waiting out the appeal window, and rev017 enforces a protocol-wide
 * floor on it (300s by default). Rather than make every run wait five minutes
 * twice over, this test lowers the floor for the duration of the run and
 * restores it in a `finally` -- including when a scenario throws. That needs
 * the diamond owner's key (UPGRADE_OWNER_KEY or FORGE_DEV_PRIVATE_KEY); without
 * it the run skips loudly rather than pretending to have verified anything.
 * On a disposable Anvil chain this is free; on a shared testnet, a run killed
 * hard enough to skip the `finally` leaves the floor lowered until someone
 * puts it back.
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
  requireShortAppealWindow,
} from './_x402';

const toHours = (secs: number): number => secs / 3600;

// Scenarios A and B wait their appeal window out, so it should be as short as the protocol
// floor allows. Both values below are re-derived in main() from the floor actually in force,
// so the SMOKE_APPEAL_WINDOW_SLOW path (real floor, no lowering) works unchanged.
const WANTED_SHORT_WINDOW_SECS = 5;
let shortWindowSecs = WANTED_SHORT_WINDOW_SECS;

// Scenario C is the opposite case: it appeals *inside* its window, after a ~7s wait for the
// evaluation window to expire, so its window has to outlast that wait no matter how low the
// floor goes. Sized well clear of the wait plus indexer poll time rather than at the floor.
const APPEAL_INSIDE_WINDOW_SECS = 90;
let disputeWindowSecs = APPEAL_INSIDE_WINDOW_SECS;

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
    appealWindowHours: toHours(shortWindowSecs),
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

  log('6/8', `[A] Waiting ${shortWindowSecs + 5}s for appeal window to expire...`);
  await sleep((shortWindowSecs + 5) * 1000);
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
    appealWindowHours: toHours(shortWindowSecs),
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

  log('6/8', `[B] Waiting ${shortWindowSecs + 5}s for appeal window to expire...`);
  await sleep((shortWindowSecs + 5) * 1000);
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
    appealWindowHours: toHours(disputeWindowSecs),
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

  // Skips loudly if the floor cannot be lowered -- see requireShortAppealWindow.
  const appealWindow = await requireShortAppealWindow(WANTED_SHORT_WINDOW_SECS);
  shortWindowSecs = appealWindow.effectiveSecs;
  disputeWindowSecs = Math.max(APPEAL_INSIDE_WINDOW_SECS, appealWindow.effectiveSecs);

  const results: boolean[] = [];
  try {
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
  } finally {
    // Restore in `finally`, not after the scenarios: a throw partway through must still put the
    // floor back, or the next run silently inherits a weakened guard.
    await appealWindow.restore();
  }

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

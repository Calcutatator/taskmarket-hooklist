/**
 * Evaluator flow smoke test — four scenarios:
 *   A. APPROVE verdict, no appeal, finalize → completed
 *   B. REJECT verdict, no appeal, finalize → cancelled (refund + terminate,
 *      not reopened — see EvaluatorFacet.finalizeVerdict's REJECT branch)
 *   C. APPROVE verdict, worker appeals, dispute resolver settles → completed
 *   D. POST /api/tasks/{taskId}/evaluator assigns an evaluator after creation,
 *      and refuses an unknown task, a non-requester, the zero address, a second
 *      assignment, and a task a worker has already claimed
 *
 * Usage:
 *   REQUESTER_PRIVATE_KEY=0x... WORKER_PRIVATE_KEY=0x... \
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
} from './_x402';

function contentHash(payload: string): string {
  return createHash('sha256').update(Buffer.from(payload)).digest('hex');
}

async function pollStatus(taskId: string, expected: string[]): Promise<string> {
  const task = await pollTaskStatus<{ status: string }>(taskId, expected, {
    timeoutMs: 45_000,
  });
  return task.status;
}

/**
 * Assert a request is refused with a particular HTTP status.
 *
 * The helpers in _x402.ts surface a failure as `<path> failed (HTTP <status>): <message>`, so
 * the status is matched out of the message. A call that unexpectedly *succeeds* is the more
 * dangerous outcome here -- it means a gate is missing rather than merely worded differently
 * -- so it fails loudly instead of being folded into the same branch.
 */
async function expectFailure(
  label: string,
  status: number,
  attempt: Promise<unknown>
): Promise<void> {
  try {
    await attempt;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!message.includes(`HTTP ${status}`)) {
      throw new Error(`Expected ${label} (HTTP ${status}), got: ${message}`);
    }
    ok(label, `HTTP ${status}`);
    return;
  }
  throw new Error(`Expected ${label} (HTTP ${status}), but the request succeeded`);
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
      evaluator: requester.address,
      disputeResolver: requester.address,
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
    appealWindowHours: 0.00139, // ~5 seconds
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
    requester
  )) as { txHash: string };
  ok('evaluate txHash', evalTx);

  const afterEval = await pollStatus(taskId, ['appealing']);
  ok('status after evaluate', afterEval);

  log('6/8', '[A] Waiting 8s for appeal window to expire...');
  await sleep(8000);
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
    requester
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
    requester
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
    requester
  )) as { txHash: string };
  ok('resolve txHash', resolveTx);

  log('9/9', '[C] Polling for completed status...');
  const finalStatus = await pollStatus(taskId, ['completed', 'accepted']);
  ok('final status', finalStatus);
}

// --- Scenario D: POST /api/tasks/{taskId}/evaluator, happy path plus every refusal ---
//
// Verified against packages/contracts/src/facets/EvaluatorFacet.sol's assignEvaluator, which
// gates on requester != task.requester (NotRequester), status != Open (TaskNotOpen),
// evaluator == address(0) (InvalidEvaluator), an evaluator already set
// (EvaluatorAlreadyAssigned) and feeBps > 10000 (FeeBpsTooHigh). Each refusal below is checked
// off chain before the X402 payment settles, so a rejected caller is never charged.
async function scenarioD(
  requester: ReturnType<typeof getAccounts>['requester'],
  worker: ReturnType<typeof getAccounts>['worker']
) {
  log('1/9', '[D] Creating claim task with NO evaluator...');
  const { taskId } = (await x402Post(
    '/api/tasks',
    {
      description: 'Evaluator smoke test — D (assign after creation)',
      reward: '1000',
      duration: 300,
      mode: 'claim',
      tags: ['smoke-evaluator'],
    },
    requester
  )) as { taskId: string };
  ok('taskId', taskId);

  log('2/9', '[D] Rejecting an unknown task...');
  await expectFailure(
    '404 for an unknown task',
    404,
    x402Post(
      `/api/tasks/0x${'ff'.repeat(32)}/evaluator`,
      { taskId: `0x${'ff'.repeat(32)}`, evaluator: worker.address },
      requester
    )
  );

  log('3/9', '[D] Rejecting a caller who is not the requester...');
  await expectFailure(
    '403 for a non-requester payer',
    403,
    x402Post(`/api/tasks/${taskId}/evaluator`, { taskId, evaluator: worker.address }, worker)
  );

  log('4/9', '[D] Rejecting the zero address as evaluator...');
  await expectFailure(
    '400 for the zero-address evaluator',
    400,
    x402Post(
      `/api/tasks/${taskId}/evaluator`,
      { taskId, evaluator: `0x${'00'.repeat(20)}` },
      requester
    )
  );

  log('5/9', '[D] Requester assigning the evaluator...');
  const { txHash: assignTx } = (await x402Post(
    `/api/tasks/${taskId}/evaluator`,
    {
      taskId,
      evaluator: requester.address,
      disputeResolver: requester.address,
      evaluatorFeeBps: 100,
      evaluationWindowHours: 0.00139, // ~5 seconds
      appealWindowHours: 0.00139, // ~5 seconds
    },
    requester
  )) as { txHash: string };
  ok('assign txHash', assignTx);

  const assigned = (await get(`/api/tasks/${taskId}`)) as {
    evaluator: string | null;
    evaluatorFeeBps: number | null;
  };
  if (assigned.evaluator?.toLowerCase() !== requester.address.toLowerCase()) {
    throw new Error(`Expected evaluator ${requester.address}, got ${assigned.evaluator}`);
  }
  if (assigned.evaluatorFeeBps !== 100) {
    throw new Error(`Expected evaluatorFeeBps 100, got ${assigned.evaluatorFeeBps}`);
  }
  ok('evaluator', assigned.evaluator);

  log('6/9', '[D] Rejecting a second assignment...');
  await expectFailure(
    '400 for an already-assigned evaluator',
    400,
    x402Post(`/api/tasks/${taskId}/evaluator`, { taskId, evaluator: worker.address }, requester)
  );

  log('7/9', '[D] Worker claiming, so the task leaves Open...');
  const claimSig = await worker.signMessage({ message: `taskmarket:claim:${taskId}` });
  await post(`/api/tasks/${taskId}/claim`, {
    taskId,
    workerAddress: worker.address,
    signature: claimSig,
  });
  const claimed = await pollStatus(taskId, ['claimed']);
  ok('status after claim', claimed);

  // The TaskNotOpen gate, which is the whole reason assignment cannot be deferred: this task
  // now refuses assignment permanently, and would have done so regardless of who asked.
  log('8/9', '[D] Rejecting assignment on a claimed task...');
  await expectFailure(
    '400 once the task is claimed',
    400,
    x402Post(`/api/tasks/${taskId}/evaluator`, { taskId, evaluator: worker.address }, requester)
  );

  // Proves the assignment took effect on chain and not merely in the database: submitWork
  // only auto-transitions a claim-mode task to review when the contract itself holds an
  // evaluator for it.
  log('9/9', '[D] Worker submitting, expecting the on-chain evaluator to force review...');
  const submitPayload = 'smoke-evaluator-payload-D';
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
  const reviewStatus = await pollStatus(taskId, ['review']);
  ok('status after submit', reviewStatus);
}

async function main() {
  const { requester, worker } = getAccounts();

  console.log('=== Taskmarket Smoke Test — Evaluator Flow ===');
  console.log('requester:', requester.address);
  console.log('worker:   ', worker.address);
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

  results.push(
    await runScenario(
      'D — assign an evaluator after creation, and every refusal that route must make',
      () => scenarioD(requester, worker)
    )
  );

  console.log('\n' + '='.repeat(60));
  console.log('RESULTS');
  console.log('='.repeat(60));
  const labels = ['A', 'B', 'C', 'D'];
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

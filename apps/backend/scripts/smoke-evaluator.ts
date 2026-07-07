/**
 * Evaluator flow smoke test — three scenarios:
 *   A. APPROVE verdict, no appeal, finalize → completed
 *   B. REJECT verdict, no appeal, finalize → open (task reset)
 *   C. APPROVE verdict, worker appeals, dispute resolver settles → completed
 *
 * Usage:
 *   REQUESTER_PRIVATE_KEY=0x... WORKER_PRIVATE_KEY=0x... \
 *     npx tsx --env-file=../../.env scripts/smoke-evaluator.ts
 */
import { log, ok, get, post, x402Post, getAccounts, API_URL } from './_x402.ts';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function pollStatus(
  taskId: string,
  expected: string[],
  maxAttempts = 15,
  intervalMs = 3000
): Promise<string> {
  for (let i = 0; i < maxAttempts; i++) {
    const task = (await get(`/api/tasks/${taskId}`)) as { status: string };
    if (expected.includes(task.status)) return task.status;
    await sleep(intervalMs);
  }
  const task = (await get(`/api/tasks/${taskId}`)) as { status: string };
  throw new Error(
    `Timed out waiting for status [${expected.join('|')}], got: ${task.status}`
  );
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
  await x402Post(`/api/tasks/${taskId}/claim`, { taskId }, worker);
  const claimed = (await get(`/api/tasks/${taskId}`)) as { status: string };
  if (claimed.status !== 'claimed') {
    throw new Error(`Expected claimed, got ${claimed.status}`);
  }
  ok('status', claimed.status);

  log('3/5', `[${label}] Worker submitting work...`);
  await x402Post(
    `/api/tasks/${taskId}/submit`,
    { taskId, deliverable: `0x${'ab'.repeat(32)}` },
    worker
  );
  ok('submitted', true);

  log('4/5', `[${label}] Requester accepting submission (→ review)...`);
  await x402Post(`/api/tasks/${taskId}/accept`, { taskId, worker: worker.address }, requester);
  await sleep(3000);
  const reviewTask = (await get(`/api/tasks/${taskId}`)) as { status: string };
  ok('status after accept', reviewTask.status);

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

  await sleep(2000);
  const afterEval = (await get(`/api/tasks/${taskId}`)) as { status: string };
  if (afterEval.status !== 'appealing') {
    throw new Error(`Expected appealing after evaluate, got ${afterEval.status}`);
  }
  ok('status after evaluate', afterEval.status);

  log('6/8', '[A] Waiting 8s for appeal window to expire...');
  await sleep(8000);

  log('7/8', '[A] Calling finalizeVerdict (permissionless)...');
  const { txHash: finalizeTx } = (await post(`/api/tasks/${taskId}/finalize-verdict`, {
    taskId,
  })) as { txHash: string };
  ok('finalize txHash', finalizeTx);

  log('8/8', '[A] Polling for completed status...');
  const finalStatus = await pollStatus(taskId, ['completed', 'accepted']);
  ok('final status', finalStatus);
}

// --- Scenario B: REJECT verdict, no appeal, finalize → open ---
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

  await sleep(2000);
  const afterEval = (await get(`/api/tasks/${taskId}`)) as { status: string };
  if (afterEval.status !== 'appealing') {
    throw new Error(`Expected appealing after evaluate, got ${afterEval.status}`);
  }
  ok('status after evaluate', afterEval.status);

  log('6/8', '[B] Waiting 8s for appeal window to expire...');
  await sleep(8000);

  log('7/8', '[B] Calling finalizeVerdict (permissionless)...');
  const { txHash: finalizeTx } = (await post(`/api/tasks/${taskId}/finalize-verdict`, {
    taskId,
  })) as { txHash: string };
  ok('finalize txHash', finalizeTx);

  log('8/8', '[B] Polling for open status (task reset after REJECT)...');
  const finalStatus = await pollStatus(taskId, ['open']);
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

  await sleep(2000);
  const afterEval = (await get(`/api/tasks/${taskId}`)) as { status: string };
  if (afterEval.status !== 'appealing') {
    throw new Error(`Expected appealing after evaluate, got ${afterEval.status}`);
  }
  ok('status after evaluate', afterEval.status);

  log('6/9', '[C] Waiting 7s for evaluation window to expire (appeal window still open)...');
  await sleep(7000);

  log('7/9', '[C] Worker filing appeal...');
  const { txHash: appealTx } = (await x402Post(
    `/api/tasks/${taskId}/appeal`,
    { taskId },
    worker
  )) as { txHash: string };
  ok('appeal txHash', appealTx);

  await sleep(2000);
  const afterAppeal = (await get(`/api/tasks/${taskId}`)) as { status: string };
  if (afterAppeal.status !== 'disputed') {
    throw new Error(`Expected disputed after appeal, got ${afterAppeal.status}`);
  }
  ok('status after appeal', afterAppeal.status);

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
    await runScenario('B — REJECT verdict, no appeal, finalize → open', () =>
      scenarioB(requester, worker)
    )
  );

  results.push(
    await runScenario('C — APPROVE verdict, worker appeals, dispute resolver settles → completed', () =>
      scenarioC(requester, worker)
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

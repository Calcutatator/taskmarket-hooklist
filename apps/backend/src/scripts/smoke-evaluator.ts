/**
 * Evaluator flow smoke test — three scenarios:
 *   A. APPROVE verdict, no appeal, finalize → completed
 *   B. REJECT verdict, no appeal, finalize → cancelled (refund + terminate,
 *      not reopened — see EvaluatorFacet.finalizeVerdict's REJECT branch)
 *   C. APPROVE verdict, worker appeals, dispute resolver settles → completed
 *   D. Creation with an evaluator is a single transaction — the evaluator, its fee, both
 *      windows and the dispute resolver are all live before any second call could be made
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
  API_URL,
  expectActionQueueIntent,
  get,
  getAccounts,
  log,
  nudgeChainForward,
  ok,
  pollTaskStatus,
  pollUntil,
  post,
  requireShortAppealWindow,
  sleep,
  x402Post,
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

/**
 * The evaluator must be a different address from the requester. rev018 moved that from a
 * convention to a contract guard: LibTaskMarket._applyEvaluatorConfig reverts
 * EvaluatorCannotBeRequester when `cfg.evaluator == requester`, and
 * DisputeResolverCannotBeRequester when `cfg.disputeResolver == requester` -- so a task created
 * with the requester in either slot never escrows at all.
 *
 * rev018 does NOT require the dispute resolver to differ from the evaluator; the only two
 * identity checks are the ones against the requester. One account is therefore enough to satisfy
 * the contract for both slots, and that is what this returns.
 *
 * EVALUATOR_PRIVATE_KEY is set by scripts/cloud-env-setup.sh's generated .env. There is
 * deliberately no fallback to DEV_PRIVATE_KEY/REQUESTER_PRIVATE_KEY: every such fallback lands
 * back on the requester's own address on a default sandbox, which is precisely the state the
 * contract now rejects, and a confusing on-chain revert is a worse failure than an explicit one
 * here.
 */
function getEvaluatorAccount(requesterAddress: string) {
  const key = process.env.EVALUATOR_PRIVATE_KEY as `0x${string}` | undefined;
  if (!key) {
    throw new Error(
      'EVALUATOR_PRIVATE_KEY is required: the evaluator and dispute resolver must differ from ' +
        'the requester (rev018 EvaluatorCannotBeRequester / DisputeResolverCannotBeRequester).'
    );
  }
  const account = privateKeyToAccount(key);
  if (account.address.toLowerCase() === requesterAddress.toLowerCase()) {
    throw new Error(
      `EVALUATOR_PRIVATE_KEY resolves to the requester address (${account.address}); ` +
        'the contract rejects an evaluator or dispute resolver equal to the requester.'
    );
  }
  return account;
}

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
  evaluator: ReturnType<typeof getEvaluatorAccount>;
  label: string;
  evaluationWindowHours: number;
  appealWindowHours: number;
}): Promise<string> {
  const { requester, worker, evaluator, label, evaluationWindowHours, appealWindowHours } = opts;

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
  worker: ReturnType<typeof getAccounts>['worker'],
  evaluator: ReturnType<typeof getEvaluatorAccount>
) {
  const taskId = await setupReviewTask({
    requester,
    worker,
    evaluator,
    label: 'A',
    evaluationWindowHours: 0.00139, // ~5 seconds
    appealWindowHours: toHours(shortWindowSecs),
  });

  // Action-queue assertions (Action Inbox). The queue is a projection of on-chain state, so it
  // is checked at both edges of each transition: the action appears for the actor who can take
  // it, and stops appearing once it has been taken. `evaluator` stands in for the dispute
  // resolver here because this script assigns one account to both slots -- rev018 only requires
  // each to differ from the requester.
  await expectActionQueueIntent(taskId, evaluator, 'evaluate_work', true);

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
  await expectActionQueueIntent(taskId, worker, 'appeal_verdict', false);
}

// --- Scenario B: REJECT verdict, no appeal, finalize → cancelled ---
async function scenarioB(
  requester: ReturnType<typeof getAccounts>['requester'],
  worker: ReturnType<typeof getAccounts>['worker'],
  evaluator: ReturnType<typeof getEvaluatorAccount>
) {
  const taskId = await setupReviewTask({
    requester,
    worker,
    evaluator,
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
  await expectActionQueueIntent(taskId, evaluator, 'evaluate_work', false);
}

// --- Scenario C: APPROVE verdict, worker appeals, dispute resolver settles → completed ---
async function scenarioC(
  requester: ReturnType<typeof getAccounts>['requester'],
  worker: ReturnType<typeof getAccounts>['worker'],
  evaluator: ReturnType<typeof getEvaluatorAccount>
) {
  const taskId = await setupReviewTask({
    requester,
    worker,
    evaluator,
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
  await expectActionQueueIntent(taskId, evaluator, 'resolve_dispute', true);

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
  await expectActionQueueIntent(taskId, evaluator, 'resolve_dispute', false);
}

/**
 * Scenario D — an evaluator supplied at creation is configured by the create transaction.
 *
 * The contract's createTask takes evaluator terms directly (rev016). Before that it did not, so
 * a task with an evaluator needed a second contract call, and that call raced the first worker
 * to claim: the task is Open, and so claimable, the instant the escrow mines, and
 * assignEvaluator reverts TaskNotOpen once it is claimed. ADR-0047 recorded a sandbox run in
 * which 4 of 4 assignments became permanently unreachable that way.
 *
 * What this asserts is the absence of that window rather than its narrowness. The task is read
 * back before anything else touches it, and the full configuration must already be there — not
 * just the evaluator address, but the fee, both windows and the dispute resolver, none of which
 * appear in the EvaluatorAssigned event and so cannot have been backfilled by the indexer.
 * Only the create transaction could have written them.
 *
 * smoke-nonce asserts the database-side half of the same fact: zero tasks.assignEvaluator
 * intents exist for a task created with an evaluator.
 */
async function scenarioD(
  requester: ReturnType<typeof getAccounts>['requester'],
  worker: ReturnType<typeof getAccounts>['worker'],
  evaluator: ReturnType<typeof getEvaluatorAccount>
): Promise<void> {
  const evaluationWindowHours = 0.5;
  const appealWindowHours = 0.25;

  log('1/5', 'Creating a claim task with a full evaluator configuration...');
  const { taskId } = (await x402Post(
    '/api/tasks',
    {
      description: 'Evaluator smoke test — D (atomic creation)',
      reward: '1000',
      duration: 300,
      mode: 'claim',
      tags: ['smoke-evaluator'],
      evaluator: evaluator.address,
      disputeResolver: evaluator.address,
      evaluatorFeeBps: 250,
      evaluationWindowHours,
      appealWindowHours,
    },
    requester
  )) as { taskId: string };
  ok('taskId', taskId);

  log('2/5', 'Reading the task back before anything else touches it...');
  const created = await pollUntil(
    () =>
      get(`/api/tasks/${taskId}`) as Promise<{
        appealWindow: number | null;
        disputeResolver: string | null;
        evaluationWindow: number | null;
        evaluator: string | null;
        evaluatorFeeBps: number | null;
        status: string;
      }>,
    (task) => Boolean(task.evaluator),
    { label: `the evaluator on task ${taskId}`, timeoutMs: 120_000 }
  );

  if (created.evaluator?.toLowerCase() !== evaluator.address.toLowerCase()) {
    throw new Error(`evaluator is ${created.evaluator}, expected ${evaluator.address}`);
  }
  if (created.disputeResolver?.toLowerCase() !== evaluator.address.toLowerCase()) {
    throw new Error(`disputeResolver is ${created.disputeResolver}, expected ${evaluator.address}`);
  }
  if (created.evaluatorFeeBps !== 250) {
    throw new Error(`evaluatorFeeBps is ${created.evaluatorFeeBps}, expected 250`);
  }
  if (created.evaluationWindow !== Math.round(evaluationWindowHours * 3600)) {
    throw new Error(`evaluationWindow is ${created.evaluationWindow}, expected 1800`);
  }
  if (created.appealWindow !== Math.round(appealWindowHours * 3600)) {
    throw new Error(`appealWindow is ${created.appealWindow}, expected 900`);
  }
  if (created.status !== 'open') {
    throw new Error(`status is ${created.status}, expected open`);
  }
  ok('full evaluator configuration live on an open task', 'fee=250 eval=1800s appeal=900s');

  log('3/5', 'Worker claiming and submitting...');
  const claimSig = await worker.signMessage({ message: `taskmarket:claim:${taskId}` });
  await post(`/api/tasks/${taskId}/claim`, {
    taskId,
    workerAddress: worker.address,
    signature: claimSig,
  });
  const submitPayload = 'smoke-evaluator-atomic-payload';
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

  // Review, not PendingApproval. submitWork routes a CLAIM task to Review only when the contract
  // already holds an evaluator for it, so reaching Review is the on-chain proof that the create
  // transaction -- the only relayed transaction that has ever existed for this task -- wrote the
  // evaluator config.
  log('4/5', 'Waiting for the evaluator-gated state...');
  const status = await pollStatus(taskId, ['review']);
  ok('status', status);

  const afterClaim = (await get(`/api/tasks/${taskId}`)) as { evaluator: string | null };
  if (afterClaim.evaluator?.toLowerCase() !== evaluator.address.toLowerCase()) {
    throw new Error(`evaluator lost after claim: ${afterClaim.evaluator}`);
  }
  ok('evaluator survived the claim it used to race', afterClaim.evaluator);

  // Error path: the creation route must not become the cheap way past a guard the assignment
  // route enforces. A fee above 100% is rejected before any escrow is taken.
  log('5/5', 'Checking an out-of-range evaluator fee is rejected...');
  let rejection: string | null = null;
  try {
    await x402Post(
      '/api/tasks',
      {
        description: 'Evaluator smoke test — D (invalid fee)',
        reward: '1000',
        duration: 300,
        mode: 'claim',
        tags: ['smoke-evaluator'],
        // Must be the distinct evaluator account, not the requester: under rev018 a
        // requester-as-evaluator task reverts EvaluatorCannotBeRequester, which would satisfy
        // "something threw" while never reaching the fee guard this step exists to check --
        // and the /evaluatorFeeBps/ assertion below would then fail for the wrong reason.
        evaluator: evaluator.address,
        evaluatorFeeBps: 10001,
      },
      requester
    );
  } catch (error) {
    rejection = error instanceof Error ? error.message : String(error);
  }
  if (rejection === null) {
    throw new Error('createTask accepted an evaluatorFeeBps above 10000');
  }
  // Any thrown error used to count as a pass here, which made this step unable to fail for the
  // reason it exists: a backend that was down, an unfunded payer, or a typo in the request body
  // all throw, and all reported the fee guard as verified. Naming the field the rejection has
  // to mention is what separates "the guard refused this" from "something else went wrong".
  if (!/evaluatorFeeBps/i.test(rejection)) {
    throw new Error(`createTask rejected the out-of-range fee, but not for the fee: ${rejection}`);
  }
  ok('evaluatorFeeBps above 10000 rejected', rejection);
}

async function main() {
  const { requester, worker } = getAccounts();
  const evaluator = getEvaluatorAccount(requester.address);

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
        scenarioA(requester, worker, evaluator)
      )
    );

    results.push(
      await runScenario('B — REJECT verdict, no appeal, finalize → cancelled', () =>
        scenarioB(requester, worker, evaluator)
      )
    );

    results.push(
      await runScenario(
        'C — APPROVE verdict, worker appeals, dispute resolver settles → completed',
        () => scenarioC(requester, worker, evaluator)
      )
    );

    results.push(
      await runScenario('D — creation with an evaluator is a single transaction', () =>
        scenarioD(requester, worker, evaluator)
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

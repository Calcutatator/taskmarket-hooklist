/**
 * Rate-limit smoke test: proves RFC-0006 Tier 1 (free-allowance pricing, ADR-0035/0036)
 * and Tier 2 (hard ceiling, ADR-0037) end-to-end against a real running backend, across
 * all three zones of `submissionAllowanceGate`'s behavior for a single (worker, task) pair:
 *
 *   1. free zone     -- submissions 1..FREE_ALLOWANCE                : no payment required
 *   2. paid zone     -- submissions FREE_ALLOWANCE+1..HARD_CEILING   : X402-paid, still allowed
 *   3. ceiling zone  -- submission HARD_CEILING+1 and beyond         : 429, permanently
 *
 * plus confirms the ceiling is scoped per (worker, task), not global or per-worker-across-
 * tasks -- ADR-0037's own central, explicitly-emphasized policy point.
 *
 * No dedicated automated coverage exercises this end-to-end today (unit tests cover the
 * pieces in isolation -- see docs/specs/submission-tier-2-hard-ceiling.md "Testing &
 * Verification"; smoke-bounty.ts only submits 3 times total, never reaching the free
 * allowance). This script is that end-to-end proof.
 *
 * Runs against a *small* HARD_SUBMISSION_CEILING override so the whole test completes in a
 * handful of requests instead of ~94 real paid X402 round-trips to reach the real
 * production ceiling of 100 (apps/backend/src/config/payments.ts). The override is read by
 * the BACKEND process itself (apps/backend/src/config/env.ts's
 * getHardSubmissionCeilingOverride), so it must be set in the backend's own environment --
 * not this script's -- before the backend under test starts. FREE_SUBMISSION_ALLOWANCE (5)
 * stays at its real, unoverridden production default -- it's already cheap enough to
 * exercise as-is.
 *
 * Usage (start/restart the backend under test with a small ceiling override first):
 *   HARD_SUBMISSION_CEILING=7 pnpm --filter @taskmarket/backend dev
 *
 *   # in another shell, against that backend:
 *   HARD_SUBMISSION_CEILING=7 REQUESTER_PRIVATE_KEY=0x... WORKER_PRIVATE_KEY=0x... \
 *     npx tsx --env-file=../../.env src/scripts/smoke-rate-limit.ts
 *
 * This script's own HARD_SUBMISSION_CEILING is read only to know what ceiling to expect
 * and assert against -- it does not itself change the backend's behavior. If unset, it
 * defaults to 7, matching the value the "Usage" example above sets on the backend.
 */
import { createHash } from 'crypto';
import { buildSubmitMessage } from '@taskmarket/shared';
import { log, ok, post, x402Post, getAccounts, API_URL, type Account } from './_x402';

// Must match whatever HARD_SUBMISSION_CEILING the backend under test was actually started
// with -- see the header comment above. Small on purpose: this script's whole point is to
// reach the ceiling in a handful of requests, not the real production value of 100.
const HARD_CEILING = Number(process.env.HARD_SUBMISSION_CEILING ?? 7);
// FREE_SUBMISSION_ALLOWANCE's real, unoverridden production default (apps/backend/src/
// config/payments.ts) -- cheap enough (5) that this script doesn't need its own override.
const FREE_ALLOWANCE = 5;

function contentHash(payload: string): string {
  return createHash('sha256').update(Buffer.from(payload)).digest('hex');
}

async function signedSubmissionBody(
  taskId: string,
  worker: Account,
  index: number
): Promise<Record<string, unknown>> {
  const payload = `smoke-rate-limit-payload-${taskId}-${index}`;
  const signature = await worker.signMessage({
    message: buildSubmitMessage(taskId, [contentHash(payload)]),
  });
  return {
    taskId,
    workerAddress: worker.address,
    signature,
    artifacts: [
      {
        fileName: `submission-${index}.txt`,
        mimeType: 'text/plain',
        role: 'attachment',
        file: Buffer.from(payload).toString('base64'),
      },
    ],
  };
}

/**
 * Raw fetch, bypassing post()/x402Post() -- both throw generically (via _x402.ts's fail())
 * on any non-2xx response and discard the parsed body. The ceiling-boundary assertions
 * below need the *exact* response shape (HTTP status + JSON body), not just pass/fail, so
 * they can't reuse either helper.
 */
async function rawSubmit(
  taskId: string,
  body: Record<string, unknown>
): Promise<{ status: number; body: unknown }> {
  const r = await fetch(`${API_URL}/api/tasks/${taskId}/submissions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const parsed = await r.json();
  return { status: r.status, body: parsed };
}

/**
 * Asserts the exact shape submissionAllowanceGate.ts's HARD_CEILING_MESSAGE path returns:
 * HTTP 429, JSON body `{ error: "..." }`.
 */
function assertRejectedByCeiling(step: string, result: { status: number; body: unknown }) {
  if (result.status !== 429) {
    throw new Error(
      `[${step}] expected HTTP 429 from the hard ceiling, got ${result.status}: ${JSON.stringify(result.body)}`
    );
  }
  const body = result.body as { error?: unknown };
  if (typeof body.error !== 'string' || body.error.length === 0) {
    throw new Error(
      `[${step}] expected JSON { error: string } body, got: ${JSON.stringify(result.body)}`
    );
  }
  ok(`${step}: status`, result.status);
  ok(`${step}: error`, body.error);
}

async function createBountyTask(requester: Account, description: string): Promise<string> {
  const { taskId } = (await x402Post(
    '/api/tasks',
    {
      description,
      reward: '1000', // 0.001 USDC
      duration: 1,
      mode: 'bounty',
      tags: ['smoke-test'],
    },
    requester
  )) as { taskId: string };
  return taskId;
}

async function main() {
  const { requester, worker } = getAccounts();

  console.log('=== Taskmarket Smoke Test — Rate Limit (RFC-0006 Tier 1 + Tier 2) ===');
  console.log('requester:      ', requester.address);
  console.log('worker:         ', worker.address);
  console.log('api:            ', API_URL);
  console.log('free allowance: ', FREE_ALLOWANCE, '(real production default, unoverridden)');
  console.log(
    'hard ceiling:   ',
    HARD_CEILING,
    '(expects the backend under test to have been started with a matching HARD_SUBMISSION_CEILING override)'
  );

  if (HARD_CEILING <= FREE_ALLOWANCE) {
    throw new Error(
      `HARD_SUBMISSION_CEILING (${HARD_CEILING}) must be greater than FREE_SUBMISSION_ALLOWANCE (${FREE_ALLOWANCE}) for this script's three zones to be distinct`
    );
  }

  // 1. Create a bounty task.
  log('1/7', 'Creating bounty task...');
  const taskId = await createBountyTask(requester, 'Rate-limit smoke test task');
  ok('taskId', taskId);

  // 2. Free zone: submissions 1..FREE_ALLOWANCE succeed via plain post() -- no payment.
  //    post() throws on any non-2xx response, so a successful post() here is itself the
  //    assertion that no payment was demanded.
  log('2/7', `Submitting ${FREE_ALLOWANCE} times within the free allowance (no payment)...`);
  for (let i = 1; i <= FREE_ALLOWANCE; i++) {
    const body = await signedSubmissionBody(taskId, worker, i);
    const { submissionId } = (await post(`/api/tasks/${taskId}/submissions`, body)) as {
      submissionId: string;
    };
    ok(`free submission ${i}/${FREE_ALLOWANCE}`, submissionId);
  }

  // 3. Past the free allowance: this submission now requires payment. x402Post's own
  //    round 1 asserts the server responds 402 before it ever signs anything (_x402.ts's
  //    fail() throws if round 1 doesn't come back 402) -- that assertion, plus a
  //    successful round 2, is this script's confirmation that submission
  //    FREE_ALLOWANCE+1 is correctly gated behind X402 and that the paid submission itself
  //    succeeds.
  const firstPaidIndex = FREE_ALLOWANCE + 1;
  log(
    '3/7',
    `Submitting past the free allowance (submission ${firstPaidIndex}, expect 402 challenge -> paid)...`
  );
  {
    const body = await signedSubmissionBody(taskId, worker, firstPaidIndex);
    const { submissionId } = (await x402Post(`/api/tasks/${taskId}/submissions`, body, worker)) as {
      submissionId: string;
    };
    ok(`paid submission ${firstPaidIndex}`, submissionId);
  }

  // 4. Continue submitting (paid) up through the ceiling itself -- every one of these
  //    must still succeed, since the gate only rejects once the worker's prior successful
  //    count on this task has REACHED the ceiling (isOverFixedCeiling: priorCount >=
  //    ceiling). The last iteration here (i === HARD_CEILING) is the submission that
  //    brings the running total to exactly HARD_CEILING.
  if (firstPaidIndex < HARD_CEILING) {
    log(
      '4/7',
      `Submitting remaining paid submissions up to the ceiling (${firstPaidIndex + 1}..${HARD_CEILING})...`
    );
    for (let i = firstPaidIndex + 1; i <= HARD_CEILING; i++) {
      const body = await signedSubmissionBody(taskId, worker, i);
      const { submissionId } = (await x402Post(
        `/api/tasks/${taskId}/submissions`,
        body,
        worker
      )) as { submissionId: string };
      ok(`paid submission ${i}/${HARD_CEILING}`, submissionId);
    }
  } else {
    log('4/7', 'Skipped -- ceiling reached directly by the first paid submission above.');
  }

  // 5. The critical boundary assertion: the worker now has exactly HARD_CEILING successful
  //    submissions on this task. The next attempt must be rejected outright -- HTTP 429,
  //    JSON { error: "..." } matching submissionAllowanceGate.ts's HARD_CEILING_MESSAGE --
  //    not offered a paid path past the ceiling.
  const boundaryIndex = HARD_CEILING + 1;
  log('5/7', `Submitting at the ceiling boundary (submission ${boundaryIndex}, expect 429)...`);
  {
    const body = await signedSubmissionBody(taskId, worker, boundaryIndex);
    const result = await rawSubmit(taskId, body);
    assertRejectedByCeiling('boundary submission', result);
  }

  // 6. One more past the boundary: the ceiling must stay closed, not just reject the exact
  //    boundary submission once.
  const pastBoundaryIndex = HARD_CEILING + 2;
  log('6/7', `Submitting past the boundary (submission ${pastBoundaryIndex}, expect 429 again)...`);
  {
    const body = await signedSubmissionBody(taskId, worker, pastBoundaryIndex);
    const result = await rawSubmit(taskId, body);
    assertRejectedByCeiling('past-boundary submission', result);
  }

  // 7. A second task, same worker: the ceiling (and the free allowance) is scoped per
  //    (worker, task), not global or cross-task -- ADR-0037's own central policy point.
  //    The same worker who just hit the ceiling on taskId must be able to submit freely
  //    (no payment) to a brand-new task.
  log('7/7', 'Creating a second bounty task and confirming the ceiling is per-task, not global...');
  const taskId2 = await createBountyTask(requester, 'Rate-limit smoke test task (second task)');
  ok('taskId2', taskId2);
  {
    const body = await signedSubmissionBody(taskId2, worker, 1);
    const { submissionId } = (await post(`/api/tasks/${taskId2}/submissions`, body)) as {
      submissionId: string;
    };
    ok('free submission on second task (ceiling did not carry over)', submissionId);
  }

  console.log('\n=== Rate-limit smoke test passed ===');
  console.log('taskId: ', taskId, `(hit the ${HARD_CEILING}-submission ceiling)`);
  console.log('taskId2:', taskId2, '(fresh ceiling, submitted freely)');
}

main().catch((err) => {
  console.error('\nFatal:', err);
  process.exit(1);
});

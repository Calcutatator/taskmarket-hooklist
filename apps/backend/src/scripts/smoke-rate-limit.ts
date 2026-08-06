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
 * **This script owns its own environment by adapting to it, not by changing it.** The limits
 * it asserts against are read from GET /api/health, and the work it does is derived from
 * them: it does not set, override, restart or otherwise disturb anything on the backend, so
 * there is nothing to tear down afterwards and no way for a failed run to leave the stack
 * different from how it found it.
 *
 * That is a deliberate choice over the alternative. The ceiling and the allowance are read by
 * the BACKEND process itself (apps/backend/src/config/env.ts), so the only way for this
 * script to *set* them would be to restart the backend under test -- a process it does not
 * own, may not be able to see (a container, a deployment), and could leave down if this run
 * died between stop and start. Adapting needs none of that.
 *
 * The script used to keep its own copies of both numbers, and had no way to notice when the
 * backend was enforcing something else. Under the standard `make smoke rate-limit` invocation
 * it always was, and in two different ways at once: cloud-env-setup.sh sets
 * SUBMISSION_FREE_ALLOWANCE=1000 and no ceiling override, so the backend runs a free allowance
 * of 1000 against a ceiling of 100. Setting HARD_SUBMISSION_CEILING for the script alone would
 * have made that worse, not better -- it would have moved the disagreement rather than
 * resolving it.
 *
 * **Zones are skipped individually, not all together.** That same sandbox configuration makes
 * the paid zone empty: with an allowance above the ceiling, every submission up to the ceiling
 * is free and there is no priced band between them. Tier 1 genuinely cannot be observed
 * against that backend -- but Tier 2 can, completely, and a whole-script skip threw that away
 * and reported nothing. So each zone checks whether the effective configuration makes it
 * reachable, runs if it does, and prints a named skip with its remedy if it does not. Only a
 * configuration that puts the ceiling itself out of reach skips the whole run.
 *
 * Usage (no special backend environment required):
 *   REQUESTER_PRIVATE_KEY=0x... WORKER_PRIVATE_KEY=0x... \
 *     npx tsx --env-file=../../.env src/scripts/smoke-rate-limit.ts
 *
 * To exercise the paid zone as well, start the backend under test with an allowance below its
 * ceiling, e.g. SUBMISSION_FREE_ALLOWANCE=2 HARD_SUBMISSION_CEILING=5.
 */
import { createHash } from 'crypto';
import { buildSubmitMessage } from '@taskmarket/shared';
import { log, ok, post, x402Post, getAccounts, API_URL, type Account } from './_x402';

/**
 * Two budgets, because the two kinds of submission cost wildly different things.
 *
 * A free submission is one plain POST. A paid one is a real X402 round-trip that settles a
 * USDC authorization, so a hundred of them is money and minutes, not just requests. Budgeting
 * them together would either forbid a perfectly cheap 100-free-submission run or permit an
 * expensive 94-paid one.
 */
/**
 * Read one budget, or refuse to start.
 *
 * `Number('abc')` is NaN, and every `count < budget` guard downstream is false against NaN --
 * so a mistyped override did not cap the run at some wrong number, it removed the cap and let
 * the submission loops run unbounded. On the paid budget that is real USDC, settled one
 * authorization at a time until something else stops it. An override that cannot be honoured
 * has to end the run rather than be silently ignored, and it is validated here, at the read,
 * so it cannot reach a guard at all.
 */
/**
 * The most either budget may be raised to.
 *
 * A budget's whole job is to make the run refuse a configuration it cannot afford, so a budget
 * large enough that the refusal can never fire is the unbounded run wearing a number. These are
 * the point past which raising the budget stops being "pay for a longer run" and becomes
 * "remove the guard": a thousand plain POSTs is slow but survivable, whereas two hundred real
 * X402 round-trips is minutes and USDC, one settled authorization at a time.
 *
 * Deliberately far above both defaults (150 and 20), because this is not a tuning knob -- an
 * operator with a genuine reason to raise a budget should not hit it, and one who has typed a
 * number by mistake should.
 */
const BUDGET_CEILINGS = { free: 1000, paid: 200 } as const;

function submissionBudget(name: string, fallback: number, ceiling: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const parsed = Number(raw);
  // isSafeInteger, not isInteger: `Number('1e30')` is an integer by that test, and this budget
  // caps a loop that settles one real USDC authorization per iteration. A value that large is
  // not a cap at all, and it is indistinguishable from the unbounded run this guard exists to
  // prevent.
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > ceiling) {
    console.error('\n=== Rate-limit smoke test ABORTED (nothing was checked) ===');
    console.error(
      `reason: ${name}=${raw} is not a whole number of submissions between 1 and ${ceiling}`
    );
    console.error(
      `fix:    unset ${name} to use the default (${fallback}), or set an integer in 1..${ceiling}`
    );
    process.exit(2);
  }
  return parsed;
}

const MAX_FREE_SUBMISSIONS = submissionBudget(
  'SMOKE_RATE_LIMIT_MAX_FREE',
  150,
  BUDGET_CEILINGS.free
);
const MAX_PAID_SUBMISSIONS = submissionBudget(
  'SMOKE_RATE_LIMIT_MAX_PAID',
  20,
  BUDGET_CEILINGS.paid
);

type BackendLimits = { freeSubmissionAllowance: number; hardSubmissionCeiling: number };

/**
 * Stop the run without claiming a pass.
 *
 * A skipped smoke test that exits 0 is indistinguishable from one that verified something,
 * which smoke-nonce.ts argues is the worse of the two failures -- and this skip covers the
 * entire script, not one step of it. So it exits non-zero and says exactly what to change.
 */
function skip(reason: string, remedy: string): never {
  console.error(`\n=== Rate-limit smoke test SKIPPED (this is not a pass) ===`);
  console.error(`reason: ${reason}`);
  console.error(`fix:    ${remedy}`);
  process.exit(2);
}

/**
 * Announce that one zone could not be checked, and carry on with the rest.
 *
 * Distinct from skip() above, which ends the run. A zone the effective configuration puts out
 * of reach is not a failure and not a pass: naming it, with the configuration change that
 * would make it reachable, is the most this run can honestly say about it. Recorded so the
 * final summary states it again -- a skip announced only in the middle of several hundred
 * lines of submission output is a skip nobody reads.
 */
const skippedZones: string[] = [];
function skipZone(zone: string, reason: string, remedy: string): void {
  const message = `${zone} NOT CHECKED -- ${reason}. To check it: ${remedy}`;
  skippedZones.push(message);
  console.log(`\n  ! ${message}`);
}

/**
 * Ask the backend what it is actually enforcing.
 *
 * The whole point of reading rather than assuming: the script and the backend disagreeing
 * about a limit is a misconfiguration, and it should be reported as one rather than
 * discovered as a failed assertion three minutes into the run.
 */
async function readBackendLimits(): Promise<BackendLimits> {
  const response = await fetch(`${API_URL}/api/health`);
  if (!response.ok) {
    skip(
      `GET ${API_URL}/api/health returned ${response.status}`,
      'start the backend under test, then re-run'
    );
  }
  const body = (await response.json()) as { limits?: Partial<BackendLimits> };
  const limits = body.limits;
  if (
    !limits ||
    typeof limits.freeSubmissionAllowance !== 'number' ||
    typeof limits.hardSubmissionCeiling !== 'number'
  ) {
    skip(
      'the backend under test does not report its submission limits on /api/health',
      'it predates the limits field; redeploy it from this branch'
    );
  }
  return limits as BackendLimits;
}

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
  const limits = await readBackendLimits();
  const FREE_ALLOWANCE = limits.freeSubmissionAllowance;
  const HARD_CEILING = limits.hardSubmissionCeiling;

  console.log('=== Taskmarket Smoke Test — Rate Limit (RFC-0006 Tier 1 + Tier 2) ===');
  console.log('requester:      ', requester.address);
  console.log('worker:         ', worker.address);
  console.log('api:            ', API_URL);
  console.log('free allowance: ', FREE_ALLOWANCE, '(as reported by the backend under test)');
  console.log('hard ceiling:   ', HARD_CEILING, '(as reported by the backend under test)');

  // How many submissions of each kind it actually takes to stand at the ceiling, derived from
  // what the backend reports rather than assumed. Submissions 1..min(allowance, ceiling) are
  // free; anything between the allowance and the ceiling is paid. On a backend whose allowance
  // is at or above its ceiling the paid band is empty -- which is a configuration to report,
  // not a run to abandon.
  const freeSubmissions = Math.min(FREE_ALLOWANCE, HARD_CEILING);
  const paidSubmissions = Math.max(0, HARD_CEILING - FREE_ALLOWANCE);
  console.log('free submissions to ceiling:', freeSubmissions);
  console.log('paid submissions to ceiling:', paidSubmissions);

  // The one condition that ends the run: the ceiling itself is out of reach, so no zone can be
  // checked. Everything below this point can report something useful.
  if (freeSubmissions > MAX_FREE_SUBMISSIONS) {
    skip(
      `reaching the ceiling of ${HARD_CEILING} needs ${freeSubmissions} free submissions, above this run's budget of ${MAX_FREE_SUBMISSIONS}`,
      `restart the backend with a smaller HARD_SUBMISSION_CEILING, or raise SMOKE_RATE_LIMIT_MAX_FREE above ${freeSubmissions}`
    );
  }
  if (paidSubmissions > MAX_PAID_SUBMISSIONS) {
    skip(
      `reaching the ceiling of ${HARD_CEILING} needs ${paidSubmissions} real paid X402 round-trips, above this run's budget of ${MAX_PAID_SUBMISSIONS}`,
      `restart the backend with HARD_SUBMISSION_CEILING closer to its free allowance of ${FREE_ALLOWANCE}, or raise SMOKE_RATE_LIMIT_MAX_PAID above ${paidSubmissions} to pay for the full run`
    );
  }

  // 1. Create a bounty task.
  log('1/7', 'Creating bounty task...');
  const taskId = await createBountyTask(requester, 'Rate-limit smoke test task');
  ok('taskId', taskId);

  // 2. Free zone: submissions 1..freeSubmissions succeed via plain post() -- no payment.
  //    post() throws on any non-2xx response, so a successful post() here is itself the
  //    assertion that no payment was demanded.
  log('2/7', `Submitting ${freeSubmissions} times within the free allowance (no payment)...`);
  for (let i = 1; i <= freeSubmissions; i++) {
    const body = await signedSubmissionBody(taskId, worker, i);
    const { submissionId } = (await post(`/api/tasks/${taskId}/submissions`, body)) as {
      submissionId: string;
    };
    ok(`free submission ${i}/${freeSubmissions}`, submissionId);
  }

  // 3. Past the free allowance: this submission now requires payment. x402Post's own
  //    round 1 asserts the server responds 402 before it ever signs anything (_x402.ts's
  //    fail() throws if round 1 doesn't come back 402) -- that assertion, plus a
  //    successful round 2, is this script's confirmation that submission
  //    FREE_ALLOWANCE+1 is correctly gated behind X402 and that the paid submission itself
  //    succeeds.
  //
  //    Steps 3 and 4 together are the paid zone, and it exists only when the backend's free
  //    allowance sits below its ceiling. When it does not, Tier 1 has no band to be observed
  //    in on this backend and the skip says so by name rather than the run failing at a 402
  //    that was never going to arrive.
  if (paidSubmissions === 0) {
    log('3/7', 'Paid zone (Tier 1)...');
    skipZone(
      'paid zone (RFC-0006 Tier 1, ADR-0035/0036)',
      `the backend's free allowance (${FREE_ALLOWANCE}) is at or above its hard ceiling (${HARD_CEILING}), so every submission up to the ceiling is free and no priced band exists`,
      `restart the backend with SUBMISSION_FREE_ALLOWANCE below HARD_SUBMISSION_CEILING, e.g. SUBMISSION_FREE_ALLOWANCE=2 HARD_SUBMISSION_CEILING=5`
    );
    log('4/7', 'Skipped with the paid zone above.');
  } else {
    const firstPaidIndex = FREE_ALLOWANCE + 1;
    log(
      '3/7',
      `Submitting past the free allowance (submission ${firstPaidIndex}, expect 402 challenge -> paid)...`
    );
    {
      const body = await signedSubmissionBody(taskId, worker, firstPaidIndex);
      const { submissionId } = (await x402Post(
        `/api/tasks/${taskId}/submissions`,
        body,
        worker
      )) as { submissionId: string };
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
  // Repeated at the end so what this run did NOT check is as visible as what it did. A pass
  // that quietly covered less than the reader assumes is the failure this script's own skip
  // handling exists to prevent.
  if (skippedZones.length > 0) {
    console.log('\nZones this backend configuration put out of reach:');
    for (const message of skippedZones) console.log(`  - ${message}`);
  } else {
    console.log('all three zones checked');
  }
}

main().catch((err) => {
  console.error('\nFatal:', err);
  process.exit(1);
});

/**
 * Refund-expired smoke test: verifies the full refund flow for an expired bounty
 * task that received no submissions, and verifies that a task with a submission
 * does NOT surface the refund_expired action (on-chain guard still applies).
 *
 * Verifies: ADR-0054 (scenarios D and E)
 *
 * Scenarios:
 *   A. Create bounty → let it expire with no submissions → assert refund_expired
 *      in pendingActions → call refundExpired (X402) → poll until status=expired
 *   B. Create bounty → submit work → let it expire → assert refund_expired is
 *      absent from pendingActions (has submissions, on-chain refund would revert)
 *   C. Create bounty → let it expire with no submissions → worker (not the
 *      requester) calls refundExpired → succeeds (ADR-0026: permissionless)
 *   D. A refunded bounty cannot be refunded a second time, and an unrelated funded
 *      task's escrow is untouched by the attempt and still fully refundable after it
 *   E. The same two properties for the auction claimed-but-no-deliverable branch,
 *      which had the identical defect
 *
 * ## Why D and E exist, and why they assert balances rather than status
 *
 * `refundExpired` is permissionless by design (ADR-0026), and before ADR-0054 it was also
 * repeatable: every guard it checked still passed on a second call, so each repeat paid the
 * reward out again. Escrow is one pooled USDC balance held by the Diamond across every task,
 * so those repeats were not drawing on the refunded task's own money -- there was none left.
 * They drained unrelated, fully funded tasks. That was live on mainnet (#432).
 *
 * The first refund succeeding therefore proves nothing, and neither does the second attempt
 * merely throwing: what has to be true is that no money moved. So both scenarios read the
 * Diamond's pooled USDC balance directly around the repeat attempt, and then refund a
 * bystander task created before any of it -- if the pool had been drained, that bystander is
 * where the loss would show up, either as a short refund or as a transfer that reverts.
 *
 * `test_RefundExpired_RepeatCannotDrainAnotherTasksEscrow` in
 * packages/contracts/test/TaskMarket.t.sol is the Forge form of the same property. These
 * scenarios are not a duplicate of it: they go through the real API, the relayed-intent path
 * and the deployed Diamond, which is where the guard has to hold for a paying caller.
 *
 * Usage (CONTRACT_ADDRESS and USDC_TOKEN_ADDRESS must point at the deployed stack -- the
 * cloud-env-setup.sh .env sets both):
 *   REQUESTER_PRIVATE_KEY=0x... WORKER_PRIVATE_KEY=0x... \
 *     npx tsx --env-file=../../.env src/scripts/smoke-refund-expired.ts
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
  pollUntil,
  nudgeChainForward,
  usdcBalanceOf,
  type Account,
} from './_x402';

function contentHash(payload: string): string {
  return createHash('sha256').update(Buffer.from(payload)).digest('hex');
}

type PendingAction = { role: string; action: string; command: string };
type TaskResponse = {
  status: string;
  submissionWindowOpen: boolean;
  pendingActions: PendingAction[];
};

/** Every task in scenarios D and E escrows this, in USDC base units. */
const REWARD = 1000n;

/**
 * The two guards ADR-0054 put in the way of a second refund, and the layers they live at.
 *
 * Both are legitimate outcomes of a repeat attempt and which one fires is a timing question,
 * so the assertion accepts either -- but it does not accept anything else. "Something threw"
 * is not the property under test: a repeat that failed because the payment was rejected, or
 * because the task lookup 500'd, would leave the actual guard unexercised and look identical.
 *
 *   - `already expired` -- tasks.router.ts refuses to relay a refund for a task whose row is
 *     already `expired`. Cheap, but it is only as good as the indexer's timing.
 *   - `TaskAlreadyRefunded` -- CoreFacet.refundExpired treats the `Expired` status it sets
 *     itself as terminal. This is the one that matters: it holds against a caller who got
 *     past the row check, which is precisely what a racing second call does.
 */
const REPEAT_REFUND_GUARDS = /already expired|TaskAlreadyRefunded/i;

function diamondAddress(): string {
  const address = process.env.CONTRACT_ADDRESS;
  if (!address) {
    throw new Error(
      'CONTRACT_ADDRESS is required: scenarios D and E read the Diamond escrow balance to prove a repeat refund moved no money'
    );
  }
  return address;
}

/** Escrow is pooled, so "this task's money" is only ever observable as the pool's total. */
function escrowBalance(): Promise<bigint> {
  return usdcBalanceOf(diamondAddress());
}

type RefundAttempt = { error: string; txHash: null } | { error: null; txHash: string };

/** One refund attempt that is allowed to fail, with the failure kept rather than thrown. */
async function attemptRefund(taskId: string, caller: Account): Promise<RefundAttempt> {
  try {
    const result = (await x402Post(`/api/tasks/${taskId}/refund-expired`, { taskId }, caller)) as {
      txHash?: string;
    };
    if (!result.txHash) throw new Error(`refund returned no txHash: ${JSON.stringify(result)}`);
    return { error: null, txHash: result.txHash };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err), txHash: null };
  }
}

function assertRejectedByRepeatGuard(step: string, attempt: RefundAttempt): void {
  if (attempt.txHash !== null) {
    throw new Error(
      `[${step}] a second refund succeeded (${attempt.txHash}) -- an expiry refund must be single-shot (ADR-0054); this is the #432 fund drain`
    );
  }
  if (!REPEAT_REFUND_GUARDS.test(attempt.error)) {
    throw new Error(
      `[${step}] the repeat refund failed, but not on either ADR-0054 guard. Expected a message naming "already expired" or "TaskAlreadyRefunded", got: ${attempt.error}`
    );
  }
  ok(`${step}: rejected by`, /TaskAlreadyRefunded/i.test(attempt.error) ? 'contract' : 'API row');
  ok(`${step}: reason`, attempt.error);
}

/** Create a bounty escrowing REWARD, expiring `seconds` from now. */
async function createBounty(
  requester: Account,
  description: string,
  seconds: number
): Promise<string> {
  const { taskId } = (await x402Post(
    '/api/tasks',
    {
      description,
      reward: REWARD.toString(),
      duration: seconds / 3600,
      mode: 'bounty',
      tags: ['smoke-refund-expired'],
    },
    requester
  )) as { taskId: string };
  return taskId;
}

/**
 * Slack allowed on top of a task's own window before its expiry is called a failure.
 *
 * The window itself is known exactly (it is what the task was created with), so the only
 * unknown is how long the API takes to report the window closed -- indexer poll interval plus
 * one `get` round trip. A minute covers that with room to spare on a slow stack.
 */
const EXPIRY_POLL_HEADROOM_MS = 60_000;

/**
 * How long to wait for a task created with a `windowSecs` window to expire.
 *
 * Derived from the task's own window rather than fixed, because a fixed budget is only ever
 * correct by accident: a bystander with a 120s or 150s window is waited on at the END of its
 * scenario, so a flat 90s left the whole wait dependent on the preceding steps happening to
 * burn more than 30s (or 60s) first. That is not slack, it is a race the script loses the same
 * way on every run. Sizing from the window makes the wait sufficient no matter how fast the
 * steps before it ran; if any time has already elapsed, the poll just returns sooner.
 */
function expiryTimeoutMs(windowSecs: number): number {
  return windowSecs * 1000 + EXPIRY_POLL_HEADROOM_MS;
}

/**
 * A bystander task carried together with the window it was created with, so the wait for its
 * expiry can never be sized from a number that has drifted away from the creation call.
 */
type Bystander = { taskId: string; windowSecs: number };

async function createBystander(
  requester: Account,
  description: string,
  windowSecs: number
): Promise<Bystander> {
  return { taskId: await createBounty(requester, description, windowSecs), windowSecs };
}

async function waitForExpiry(taskId: string, timeoutMs = 90_000): Promise<void> {
  await pollUntil(
    () => get(`/api/tasks/${taskId}`) as Promise<TaskResponse>,
    (t) => !t.submissionWindowOpen,
    { label: `task ${taskId} submission window to close`, timeoutMs }
  );
  // Anvil's block.timestamp only advances on a mined transaction, so the contract's own
  // `block.timestamp <= task.expiryTime` guard can still read as unexpired after the API says
  // the window has closed. Harmless against a live chain.
  await nudgeChainForward();
}

async function waitForExpiredStatus(taskId: string): Promise<void> {
  await pollUntil(
    () => get(`/api/tasks/${taskId}`) as Promise<TaskResponse>,
    (t) => t.status === 'expired',
    { label: `task ${taskId} to reach status=expired`, timeoutMs: 90_000 }
  );
}

/**
 * The bystander assertion: an unrelated task funded before any of this still refunds in full.
 *
 * This is the one that actually tests the vulnerability. A repeat refund that is blocked moves
 * nothing, so the pool still covers every task that paid into it; a repeat refund that is not
 * blocked spends this task's money, and the proof is that this refund comes up short or the
 * Diamond's transfer reverts outright.
 */
async function assertBystanderStillRefundable(
  label: string,
  bystander: Bystander,
  requester: Account
): Promise<void> {
  const { taskId } = bystander;
  await waitForExpiry(taskId, expiryTimeoutMs(bystander.windowSecs));
  const requesterBefore = await usdcBalanceOf(requester.address);
  const escrowBefore = await escrowBalance();

  const attempt = await attemptRefund(taskId, requester);
  if (attempt.txHash === null) {
    throw new Error(
      `[${label}] the bystander task could not be refunded at all: ${attempt.error} -- its escrow was consumed by another task's refund`
    );
  }
  await waitForExpiredStatus(taskId);

  const requesterAfter = await usdcBalanceOf(requester.address);
  const escrowAfter = await escrowBalance();
  // Exact equality, not "increased": a partially drained pool would still pay something.
  if (escrowBefore - escrowAfter !== REWARD) {
    throw new Error(
      `[${label}] the bystander refund moved ${escrowBefore - escrowAfter} out of escrow, expected exactly ${REWARD}`
    );
  }
  // The requester also paid an X402 fee for this call, which does not come out of escrow, so
  // the balance check is that the refund arrived at all rather than a net figure.
  if (requesterAfter <= requesterBefore - REWARD) {
    throw new Error(
      `[${label}] the requester did not receive the bystander refund (before ${requesterBefore}, after ${requesterAfter})`
    );
  }
  ok(`${label}: bystander refunded in full after the repeat attempts`, REWARD.toString());
}

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

  // --- Scenario D: a bounty refund is single-shot, and no bystander's escrow moves (ADR-0054) ---

  // The bystander is funded FIRST, before anything is refunded, so its escrow is already in the
  // pool while the repeat attempts are made against it. Created with a long window so it is
  // still un-refunded when the repeats happen -- it has to be a live claim on the pool at that
  // moment, not an already-settled one.
  log('D1/6', 'Funding a bystander bounty that must survive every repeat attempt below...');
  const bystanderD = await createBystander(requester, 'Refund-expired bystander (scenario D)', 120);
  ok('bystander taskId (D)', bystanderD.taskId);

  log('D2/6', 'Creating and refunding a bounty task normally...');
  const taskD = await createBounty(requester, 'Refund-expired repeat guard (scenario D)', 1);
  ok('taskId (D)', taskD);
  await waitForExpiry(taskD);
  const firstRefundD = await attemptRefund(taskD, requester);
  if (firstRefundD.txHash === null) {
    throw new Error(`Expected the first refund of ${taskD} to succeed: ${firstRefundD.error}`);
  }
  await waitForExpiredStatus(taskD);
  ok('first refund txHash (D)', firstRefundD.txHash);

  log('D3/6', 'Attempting a second refund of the same task (must be refused, and move nothing)...');
  const escrowBeforeRepeat = await escrowBalance();
  const repeatD = await attemptRefund(taskD, requester);
  assertRejectedByRepeatGuard('second refund (D)', repeatD);
  const escrowAfterRepeat = await escrowBalance();
  if (escrowAfterRepeat !== escrowBeforeRepeat) {
    throw new Error(
      `A refused repeat refund still moved escrow: ${escrowBeforeRepeat} -> ${escrowAfterRepeat}`
    );
  }
  ok('escrow unchanged by the refused repeat', escrowAfterRepeat.toString());

  // A sequential repeat is stopped by the API row check before it ever reaches the chain, so on
  // its own it says nothing about the contract guard -- which is the one that has to hold. Two
  // refunds fired at once both pass that row check (the row is not `expired` until the first
  // one completes), so the second reaches the Diamond and lands on TaskAlreadyRefunded. That is
  // the shape the drain actually had: a permissionless endpoint called again before anything
  // recorded that it had already been called.
  log('D4/6', 'Racing two refunds of one task so the second reaches the contract guard...');
  const taskDRace = await createBounty(requester, 'Refund-expired race (scenario D)', 1);
  ok('taskId (D race)', taskDRace);
  await waitForExpiry(taskDRace);
  const escrowBeforeRace = await escrowBalance();
  const raced = await Promise.all([
    attemptRefund(taskDRace, requester),
    attemptRefund(taskDRace, worker),
  ]);
  const winners = raced.filter((attempt) => attempt.txHash !== null);
  if (winners.length !== 1) {
    throw new Error(
      `Expected exactly one of two concurrent refunds to succeed, ${winners.length} did: ${JSON.stringify(raced)}`
    );
  }
  assertRejectedByRepeatGuard(
    'losing concurrent refund (D)',
    raced.find((attempt) => attempt.txHash === null)!
  );
  await waitForExpiredStatus(taskDRace);

  log('D5/6', 'Confirming the racing pair paid the reward exactly once...');
  const escrowAfterRace = await escrowBalance();
  if (escrowBeforeRace - escrowAfterRace !== REWARD) {
    throw new Error(
      `Two concurrent refunds moved ${escrowBeforeRace - escrowAfterRace} out of escrow, expected exactly ${REWARD} -- a second payout is the #432 drain`
    );
  }
  ok('escrow paid the reward exactly once', REWARD.toString());

  log('D6/6', 'Refunding the bystander to prove its escrow was never touched...');
  await assertBystanderStillRefundable('scenario D', bystanderD, requester);

  console.log('\n--- Scenario D passed: bounty refunds are single-shot and drain nothing ---');

  // --- Scenario E: the same, for the auction claimed-but-no-deliverable branch (ADR-0054) ---
  //
  // CoreFacet routes an expired auction task in `Claimed` with no deliverable through
  // _refundAuctionClaimed's refund path rather than _refundExpiredNormal. It is a separate
  // function reached by a separate branch, it had the identical repeatable defect, and nothing
  // above exercises it -- scenario A's tasks are all bounties, which take the other branch.

  log('E1/5', 'Funding a bystander bounty for the auction branch...');
  const bystanderE = await createBystander(requester, 'Refund-expired bystander (scenario E)', 150);
  ok('bystander taskId (E)', bystanderE.taskId);

  log('E2/5', 'Creating an auction task (20s bid window, 60s expiry)...');
  const { taskId: taskE } = (await x402Post(
    '/api/tasks',
    {
      description: 'Refund-expired auction, claimed but never delivered (scenario E)',
      reward: REWARD.toString(),
      maxPrice: REWARD.toString(),
      duration: 60 / 3600,
      mode: 'auction',
      auctionType: 'english',
      bidDeadline: 20 / 3600,
      tags: ['smoke-refund-expired'],
    },
    requester
  )) as { taskId: string };
  ok('taskId (E)', taskE);

  log('E3/5', 'Worker bidding, then winning the auction without ever submitting a deliverable...');
  await x402Post(`/api/tasks/${taskE}/bids`, { taskId: taskE, price: '800' }, worker);
  await new Promise((r) => setTimeout(r, 22_000));
  await nudgeChainForward();
  const { workerAddress: auctionWinner } = (await post(`/api/tasks/${taskE}/bids/select-winner`, {
    taskId: taskE,
  })) as { workerAddress: string };
  if (auctionWinner.toLowerCase() !== worker.address.toLowerCase()) {
    throw new Error(`Expected ${worker.address} to win the auction, got ${auctionWinner}`);
  }
  ok('auction winner (no deliverable will follow)', auctionWinner);

  log('E4/5', 'Letting it expire undelivered, refunding it, then attempting the refund again...');
  await waitForExpiry(taskE);
  const firstRefundE = await attemptRefund(taskE, requester);
  if (firstRefundE.txHash === null) {
    throw new Error(`Expected the auction no-deliverable refund to succeed: ${firstRefundE.error}`);
  }
  await waitForExpiredStatus(taskE);
  ok('auction refund txHash (E)', firstRefundE.txHash);

  const escrowBeforeRepeatE = await escrowBalance();
  const repeatE = await attemptRefund(taskE, requester);
  assertRejectedByRepeatGuard('second auction refund (E)', repeatE);
  const escrowAfterRepeatE = await escrowBalance();
  if (escrowAfterRepeatE !== escrowBeforeRepeatE) {
    throw new Error(
      `A refused repeat auction refund still moved escrow: ${escrowBeforeRepeatE} -> ${escrowAfterRepeatE}`
    );
  }
  ok('escrow unchanged by the refused auction repeat', escrowAfterRepeatE.toString());

  log('E5/5', 'Refunding the auction branch bystander to prove its escrow was never touched...');
  await assertBystanderStillRefundable('scenario E', bystanderE, requester);

  console.log(
    '\n--- Scenario E passed: auction no-deliverable refunds are single-shot and drain nothing ---'
  );

  console.log('\n=== Refund-expired smoke test passed ===');
  console.log('taskA (refunded):', taskA, '  txHash:', refundResult.txHash);
  console.log('taskB (has sub, no refund action):', taskB);
  console.log('taskC (refunded by non-requester):', taskC, '  txHash:', nonRequesterRefund.txHash);
  console.log('taskD (repeat refused, bystander intact):', taskD, ' race:', taskDRace);
  console.log('taskE (auction no-deliverable, repeat refused):', taskE);
}

main().catch((err) => {
  console.error('\nFatal:', err);
  process.exit(1);
});

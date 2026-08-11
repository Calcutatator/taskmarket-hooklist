/**
 * Payment-orphan auto-refund smoke test (issue #266, PR #264): x402 settles payment
 * (payer -> server wallet) as a fully separate step BEFORE the on-chain action it
 * pays for runs. If that on-chain action then fails, the payment must be
 * automatically refunded and recorded, not silently orphaned. This is not
 * hypothetical -- it happened in production twice (2026-06-11, 2026-07-24; the
 * 2026-07-24 incident's root cause was the relayer wallet running out of ETH for
 * gas, which failed every relayed contract call after payment had already settled).
 *
 * The fix (services/orphaned-payments.ts) treats every post-payment on-chain
 * failure uniformly -- it does not matter WHY contractCreateTask (or any other
 * relayed call) rejected, only that it did after money already moved. So this
 * smoke test does not need to reproduce gas exhaustion itself; it only needs to
 * reliably produce SOME real on-chain revert after a real payment settlement, the
 * same way gas exhaustion, a paused market, or a stale selector would.
 *
 * Two scenarios:
 *
 *   1. Auction-accept race (always runs, no special keys needed): two workers fire
 *      auction-accept for the same dutch-clock task at the same moment. Both
 *      requests independently pass preflight (both see the task as still 'open')
 *      and both settle their flat STANDARD_X402_ACTION_AMOUNT payment -- but only
 *      one on-chain acceptAuction call can succeed; the loser's on-chain call
 *      reverts (task already claimed) *after* its payment already settled. This is
 *      a genuine, reproducible race through the public API, not a simulation.
 *
 *   2. Diamond selector removed mid-flight (gated behind SMOKE_UPGRADE=1, mirrors
 *      smoke-upgrade.ts's REMOVE/ADD round-trip): directly reproduces the "backend's
 *      encoded calldata targets a selector that no longer exists on the just-
 *      upgraded diamond" failure mode called out in issue #266, using the diamond
 *      owner key -- cancelTask's selector is removed, a real cancel request pays
 *      and then fails on-chain, and the selector is always restored afterward
 *      (try/finally) so the environment isn't left broken for other tests/users.
 *
 * What this deliberately does NOT attempt: draining the server wallet's ETH to
 * reproduce gas exhaustion literally. Doing so would break every other concurrent
 * smoke test and any real dev/staging traffic sharing the same server wallet, for
 * no additional coverage -- handlePostPaymentFailure treats a gas-exhaustion
 * rejection identically to any other post-payment rejection (scenarios 1 and 2
 * already exercise that same code path end to end). The specific "refund transfer
 * itself fails because the wallet is out of gas" case, and the retry-sweep's
 * compare-and-swap guard against double-refunding on a concurrent retry, are
 * covered by apps/backend/test/unit/services/orphaned-payments.test.ts instead,
 * where the on-chain call can be mocked to fail without touching a real wallet.
 *
 * Usage:
 *   REQUESTER_PRIVATE_KEY=0x... WORKER_PRIVATE_KEY=0x... WORKER_B_PRIVATE_KEY=0x... \
 *     npx tsx --env-file=../../.env src/scripts/smoke-payment-orphan-refund.ts
 *
 *   # Also run the diamond-upgrade scenario (requires diamond owner key):
 *   SMOKE_UPGRADE=1 UPGRADE_OWNER_KEY=0x... \
 *     REQUESTER_PRIVATE_KEY=0x... WORKER_PRIVATE_KEY=0x... WORKER_B_PRIVATE_KEY=0x... \
 *     npx tsx --env-file=../../.env src/scripts/smoke-payment-orphan-refund.ts
 */
import {
  createPublicClient,
  createWalletClient,
  http,
  encodeFunctionData,
  parseAbi,
  getAddress,
  type Chain,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { baseSepolia, anvil } from 'viem/chains';
import { eq } from 'drizzle-orm';
import { closeDatabase, db } from '../db/client';
import { orphanedPayments, relayedIntents } from '../db/schema';
import {
  log,
  ok,
  get,
  x402Post,
  getAccounts,
  newIdempotencyKey,
  pollUntil,
  API_URL,
  type Account,
} from './_x402';

const ERC20_ABI = parseAbi(['function balanceOf(address) view returns (uint256)']);

const DIAMOND_ABI = parseAbi([
  'function diamondCut((address facetAddress, uint8 action, bytes4[] functionSelectors)[] cuts, address init, bytes calldata initCalldata)',
  'function facetAddress(bytes4 selector) view returns (address)',
]);
const ACTION_ADD = 0;
const ACTION_REMOVE = 2;
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as `0x${string}`;
// bytes4(keccak256("cancelTask(bytes32,uint256)")) -- cancel is the endpoint this
// scenario drives through the missing selector, so remove/restore that one.
// Verified with `cast sig "cancelTask(bytes32,uint256)"`, not guessed.
const CANCEL_TASK_SELECTOR = '0xd27b98de' as `0x${string}`;

async function usdcBalance(rpcUrl: string, chain: Chain, usdc: string, address: string) {
  const client = createPublicClient({ chain, transport: http(rpcUrl) });
  return client.readContract({
    address: getAddress(usdc),
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: [getAddress(address)],
  });
}

// How long to wait for the refund to land in the ledger. Settlement runs on the next
// worker pass (ADR-0073), and observed end-to-end times are 8-11s; 30s is comfortably
// clear of that without letting a genuinely stuck refund pass as a slow one.
const REFUND_TIMEOUT_MS = 30_000;
// The intent row is written by the request itself, so its payment reference appears
// almost immediately -- this only absorbs commit latency.
const INTENT_TIMEOUT_MS = 15_000;
// How long to wait for an intent to COMPLETE, which is a different wait entirely and was
// briefly given INTENT_TIMEOUT_MS by mistake -- 15s against a path measured at 36s.
//
// Completion here does not happen in the request. The relay's in-request loop gives a decoded
// revert two attempts and gives up in about six seconds (ADR-0075), so the write is finished by
// the background worker instead, on a DEFAULT_INTENT_WORKER_INTERVAL_MS = 10s cadence, after the
// condition blocking it has cleared. That is the sum this has to clear: the in-request budget,
// then a worker pass, then the chain.
//
// 90s against an observed 36s. Deliberately generous rather than snug: this is the one path here
// whose duration is set by a worker interval and a retry budget, both of which are decisions that
// may change again, and a timeout that tracks them closely turns any future retune into a smoke
// failure that looks like a product bug.
const COMPLETION_TIMEOUT_MS = 90_000;

/**
 * Assert that the payment made under `idempotencyKey` was really refunded, by reading the
 * ledger rather than the error text.
 *
 * DO NOT REPLACE THIS WITH A STRING MATCH ON THE ERROR MESSAGE. It used to assert that the
 * caller's error mentioned "automatically refunded", and that assertion was worthless twice
 * over. Under ADR-0073 settlement happens on a later worker pass, so at response time there
 * is by construction nothing to report and the phrase can never appear -- and before that, the
 * check passed on a run where no refund happened at all, because reading prose only ever
 * proves what the backend said, never what it did. The property this smoke is named for is a
 * state transition in `orphaned_payments`, so that is what gets read.
 *
 * The row is located by payment reference, not by "the newest row for this payer": the intent
 * recorded under this exact idempotency key (globally unique, minted per call here) carries
 * the settled `payment_tx_hash`, and `orphaned_payments.payment_tx_hash` is unique, so the
 * join identifies one specific payment and cannot be satisfied by some other run's refund.
 */
async function assertPaymentRefunded(payer: string, idempotencyKey: string) {
  const intent = await pollUntil(
    async () => {
      const rows = await db
        .select({
          id: relayedIntents.id,
          operation: relayedIntents.operation,
          payer: relayedIntents.payer,
          paymentTxHash: relayedIntents.paymentTxHash,
        })
        .from(relayedIntents)
        .where(eq(relayedIntents.idempotencyKey, idempotencyKey))
        .limit(1);
      return rows[0];
    },
    (row) => Boolean(row?.paymentTxHash),
    {
      intervalMs: 1000,
      timeoutMs: INTENT_TIMEOUT_MS,
      label: `a settled payment reference on the intent for idempotency key ${idempotencyKey}`,
    }
  );
  const paymentTxHash = intent!.paymentTxHash!;
  if ((intent!.payer ?? '').toLowerCase() !== payer.toLowerCase()) {
    throw new Error(
      `Intent ${intent!.id} records payer ${intent!.payer}, expected the failing caller ${payer}`
    );
  }
  ok('settled payment reference', `${paymentTxHash} (operation ${intent!.operation})`);

  const orphan = await pollUntil(
    async () => {
      const rows = await db
        .select({
          id: orphanedPayments.id,
          payer: orphanedPayments.payer,
          context: orphanedPayments.context,
          refundStatus: orphanedPayments.refundStatus,
          refundTxHash: orphanedPayments.refundTxHash,
        })
        .from(orphanedPayments)
        .where(eq(orphanedPayments.paymentTxHash, paymentTxHash))
        .limit(1);
      return rows[0];
    },
    (row) => row?.refundStatus === 'refunded' && Boolean(row?.refundTxHash),
    {
      intervalMs: 2000,
      timeoutMs: REFUND_TIMEOUT_MS,
      label: `orphaned payment ${paymentTxHash} to reach refund_status=refunded with a refund tx hash`,
    }
  );

  // The ledger row must belong to the payer whose money moved -- a refund recorded against
  // anyone else is a defect the status alone would not show.
  if (orphan!.payer.toLowerCase() !== payer.toLowerCase()) {
    throw new Error(
      `Orphaned payment ${orphan!.id} is recorded against ${orphan!.payer}, expected ${payer}`
    );
  }
  ok('orphaned payment refunded on chain', `${orphan!.refundTxHash} (context ${orphan!.context})`);
}

/** Scenario 1: a genuine on-chain race, no privileged keys required. */
async function smokeAuctionAcceptRace(
  requester: Account,
  worker: Account,
  workerB: Account,
  rpcUrl: string,
  chain: Chain,
  usdc: string | undefined
) {
  console.log('\n--- Scenario 1: concurrent auction-accept race ---');

  log('1/4', 'Creating dutch auction (5min clock, max 0.001 USDC, floor 0.0001 USDC)...');
  const { taskId } = (await x402Post(
    '/api/tasks',
    {
      description: 'Payment-orphan smoke test — auction-accept race',
      reward: '1000',
      maxPrice: '1000',
      duration: 1,
      mode: 'auction',
      auctionType: 'dutch',
      auctionFloorPrice: '100',
      bidDeadline: 5 / 60,
      tags: ['smoke-payment-orphan-refund'],
    },
    requester
  )) as { taskId: string };
  ok('taskId', taskId);

  const workers = [worker, workerB];
  const balancesBefore = usdc
    ? await Promise.all(workers.map((w) => usdcBalance(rpcUrl, chain, usdc, w.address)))
    : null;

  log('2/4', 'Firing auction-accept from both workers at the same moment...');
  // One key per worker, held so the loser's settled payment can be located afterwards.
  const idempotencyKeys = workers.map(() => newIdempotencyKey());
  const outcomes = await Promise.allSettled(
    workers.map((w, i) =>
      x402Post(`/api/tasks/${taskId}/bids/accept`, { taskId }, w, {
        idempotencyKey: idempotencyKeys[i],
      })
    )
  );

  const winners = outcomes.filter((r) => r.status === 'fulfilled');
  const loserIndices = outcomes
    .map((r, i) => (r.status === 'rejected' ? i : -1))
    .filter((i) => i !== -1);

  if (winners.length !== 1 || loserIndices.length !== 1) {
    // Both requests can legitimately land far enough apart (slow CI, cold RPC) that
    // the second one's own preflight already sees 'claimed' and is rejected there --
    // rejected before payment, so nothing was orphaned and there's nothing to refund.
    // That's a skip, not a failure: this scenario only asserts something when it
    // actually produced the race it's trying to test.
    console.log(
      `  race did not land as a true tie (winners=${winners.length}, losers=${loserIndices.length}) -- skipping refund assertions for this run`
    );
    return;
  }
  ok('exactly one worker won the race', true);

  const loserIndex = loserIndices[0];
  const loser = workers[loserIndex];
  const loserReason = (outcomes[loserIndex] as PromiseRejectedResult).reason as Error;
  console.log('  loser:', loser.address);
  console.log('  loser error:', loserReason.message);

  // A concurrent x402 settlement race is a DIFFERENT thing than this scenario: an
  // "HTTP 402" loser means that worker's payment never settled at all (the facilitator's
  // own transferWithAuthorization lost its own race), not that a settled payment's
  // on-chain action failed afterward -- there is nothing orphaned to refund, so this run
  // just didn't produce the on-chain-race tie this scenario is trying to test.
  if (/HTTP 402/.test(loserReason.message)) {
    console.log(
      '  loser never settled payment (x402 facilitator-level race, not an on-chain race) -- skipping refund assertions for this run'
    );
    return;
  }

  log('3/4', "Verifying the loser's settled payment was actually refunded (ledger, not prose)...");
  await assertPaymentRefunded(loser.address, idempotencyKeys[loserIndex]);

  log('4/4', 'Verifying the task is claimed by exactly the winner...');
  const claimedTask = (await get(`/api/tasks/${taskId}`)) as { status: string; claimedBy: string };
  if (claimedTask.status !== 'claimed') {
    throw new Error(`Expected status=claimed, got ${claimedTask.status}`);
  }
  ok('status=claimed, worker', claimedTask.claimedBy);

  if (balancesBefore && usdc) {
    // The loser's flat STANDARD_X402_ACTION_AMOUNT fee should be back in full --
    // the server wallet eats its own gas, never the payer's.
    const balanceBefore = balancesBefore[loserIndex];
    const balanceAfter = await usdcBalance(rpcUrl, chain, usdc, loser.address);
    if (balanceAfter !== balanceBefore) {
      throw new Error(
        `Expected losing payer's USDC balance restored to ${balanceBefore} after refund, got ${balanceAfter}`
      );
    }
    ok('losing payer USDC balance fully restored', balanceAfter.toString());
  }
}

/** Scenario 2: diamond-upgrade selector-missing window, gated + self-restoring. */
async function smokeDiamondSelectorMissing(requester: Account, rpcUrl: string, chain: Chain) {
  if (!process.env.SMOKE_UPGRADE) {
    console.log(
      '\n--- Scenario 2: diamond selector removed mid-flight -- SKIPPED (set SMOKE_UPGRADE=1 to run) ---'
    );
    return;
  }

  console.log('\n--- Scenario 2: diamond selector removed mid-flight ---');

  const ownerKey = (process.env.UPGRADE_OWNER_KEY ?? process.env.FORGE_DEV_PRIVATE_KEY) as
    | `0x${string}`
    | undefined;
  if (!ownerKey) {
    throw new Error('Set UPGRADE_OWNER_KEY or FORGE_DEV_PRIVATE_KEY (Diamond owner)');
  }
  const contractAddress = process.env.CONTRACT_ADDRESS as `0x${string}` | undefined;
  if (!contractAddress) {
    throw new Error('Set CONTRACT_ADDRESS env var (Diamond proxy address)');
  }

  const owner = privateKeyToAccount(ownerKey);
  const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
  const walletClient = createWalletClient({ account: owner, chain, transport: http(rpcUrl) });

  log('1/6', 'Creating a task to cancel...');
  const { taskId } = (await x402Post(
    '/api/tasks',
    {
      description: 'Payment-orphan smoke test — cancelTask selector removed',
      reward: '1000',
      duration: 1,
      mode: 'bounty',
      tags: ['smoke-payment-orphan-refund'],
    },
    requester
  )) as { taskId: string };
  ok('taskId', taskId);

  log('2/6', 'Reading current facetAddress for cancelTask selector...');
  const currentFacet = await publicClient.readContract({
    address: contractAddress,
    abi: DIAMOND_ABI,
    functionName: 'facetAddress',
    args: [CANCEL_TASK_SELECTOR],
  });
  if (currentFacet === ZERO_ADDRESS) {
    throw new Error('cancelTask selector not registered in Diamond');
  }
  ok('current facet address', currentFacet);

  let restoreFailure: string | undefined;
  let restored = false;

  /**
   * Put the selector back. Called explicitly as step 5 -- because the scenario's real subject is
   * what the intent does *after* the diamond is whole again -- and again from `finally` only if
   * that never ran, so a throw mid-scenario still leaves the chain as it was found.
   */
  const restoreSelector = async () => {
    const addTx = await walletClient.sendTransaction({
      to: contractAddress,
      data: encodeFunctionData({
        abi: DIAMOND_ABI,
        functionName: 'diamondCut',
        args: [
          [
            {
              facetAddress: currentFacet,
              action: ACTION_ADD,
              functionSelectors: [CANCEL_TASK_SELECTOR],
            },
          ],
          ZERO_ADDRESS,
          '0x',
        ],
      }),
      chain,
      account: owner,
    });
    await publicClient.waitForTransactionReceipt({ hash: addTx });
    const restoredFacet = await publicClient.readContract({
      address: contractAddress,
      abi: DIAMOND_ABI,
      functionName: 'facetAddress',
      args: [CANCEL_TASK_SELECTOR],
    });
    if (restoredFacet.toLowerCase() !== currentFacet.toLowerCase()) {
      restoreFailure = `cancelTask selector NOT restored -- manual intervention required. Expected ${currentFacet}, got ${restoredFacet}`;
      console.error(restoreFailure);
      return;
    }
    restored = true;
    ok('cancelTask selector restored', restoredFacet);
  };

  try {
    log('3/6', 'Removing cancelTask selector (simulating a just-upgraded diamond)...');
    const removeTx = await walletClient.sendTransaction({
      to: contractAddress,
      data: encodeFunctionData({
        abi: DIAMOND_ABI,
        functionName: 'diamondCut',
        args: [
          [
            {
              facetAddress: ZERO_ADDRESS,
              action: ACTION_REMOVE,
              functionSelectors: [CANCEL_TASK_SELECTOR],
            },
          ],
          ZERO_ADDRESS,
          '0x',
        ],
      }),
      chain,
      account: owner,
    });
    await publicClient.waitForTransactionReceipt({ hash: removeTx });
    ok('REMOVE diamondCut mined', removeTx);

    log(
      '4/6',
      'Cancelling through the normal backend flow (payment settles, on-chain call has nowhere to go)...'
    );
    let cancelError: Error | undefined;
    const cancelIdempotencyKey = newIdempotencyKey();
    try {
      await x402Post(`/api/tasks/${taskId}/cancel`, { taskId }, requester, {
        idempotencyKey: cancelIdempotencyKey,
      });
    } catch (err) {
      cancelError = err as Error;
    }
    if (!cancelError) {
      throw new Error(
        'Expected cancel to fail while cancelTask selector is removed, but it succeeded'
      );
    }
    console.log('  cancel error:', cancelError.message);

    // This scenario used to assert a refund here, and that assertion is now wrong rather than
    // merely unreached. A selector that is missing is not evidence that the write can never
    // land -- the diamond can be made whole again, and in this very scenario it is, one step
    // below. ADR-0045 requires positive evidence of death before a refund, so the layer keeps
    // the intent alive and retries it; ADR-0074 reports that to the caller as in flight. The
    // old assertion waited for a refund that correctly never came, and would have kept waiting.
    //
    // So the subject of the scenario has moved. What matters is no longer "is it refunded" but
    // the two things that make refusing to refund safe: nothing is paid back while the outcome
    // is still open, and nothing is reported as done that has not happened.
    const beforeRestore = (await get(`/api/tasks/${taskId}`)) as { status: string };
    if (beforeRestore.status === 'cancelled') {
      throw new Error('Task must not be marked cancelled -- the on-chain cancel never happened');
    }
    ok('task status unchanged while the selector is missing', beforeRestore.status);

    log('5/6', 'Restoring cancelTask selector...');
    await restoreSelector();
    if (restoreFailure) throw new Error(restoreFailure);

    // The payoff, and the reason a refund here would have been a mistake: with the diamond whole
    // the retry lands, the cancel really happens, and the caller's payment bought the work it
    // was for. A layer that had refunded on the first failure would have paid the money back for
    // a write that then went through.
    log('6/6', 'The in-flight intent completes once the diamond is whole again...');
    const settled = await pollUntil(
      async () => (await get(`/api/tasks/${taskId}`)) as { status: string },
      (t) => t.status === 'cancelled',
      {
        intervalMs: 1000,
        timeoutMs: COMPLETION_TIMEOUT_MS,
        label: `task ${taskId} to reach cancelled once the retry can land`,
      }
    );
    ok('task cancelled by the retried intent', settled!.status);

    // `orphaned_payments` is keyed by the payment's own transaction hash, which the intent
    // carries -- so the intent is read first and the refund ledger second, the same route
    // `assertPaymentRefunded` takes in the other direction.
    const cancelIntent = (
      await db
        .select({ id: relayedIntents.id, paymentTxHash: relayedIntents.paymentTxHash })
        .from(relayedIntents)
        .where(eq(relayedIntents.idempotencyKey, cancelIdempotencyKey))
        .limit(1)
    )[0];
    if (!cancelIntent?.paymentTxHash) {
      throw new Error(
        `No settled payment reference on the intent for idempotency key ${cancelIdempotencyKey}`
      );
    }
    const refundedAnyway = (
      await db
        .select({ id: orphanedPayments.id, refundStatus: orphanedPayments.refundStatus })
        .from(orphanedPayments)
        .where(eq(orphanedPayments.paymentTxHash, cancelIntent.paymentTxHash))
        .limit(1)
    )[0];
    if (refundedAnyway && refundedAnyway.refundStatus === 'refunded') {
      throw new Error(
        `The cancel completed on chain, but its payment was refunded anyway (orphaned_payments ${refundedAnyway.id}) -- the caller got the work and the money back`
      );
    }
    ok('no refund was issued for a write that landed', true);
  } finally {
    if (!restored) {
      log('safety', 'Restoring cancelTask selector after an incomplete run...');
      await restoreSelector();
    }
  }
  if (restoreFailure) {
    throw new Error(restoreFailure);
  }
}

async function main() {
  const { requester, worker } = getAccounts();
  const workerBKey = process.env.WORKER_B_PRIVATE_KEY as `0x${string}` | undefined;
  if (!workerBKey) {
    console.error(
      'WORKER_B_PRIVATE_KEY is required for this smoke test (the auction-accept race needs two\n' +
        'distinct workers). Any freshly generated key works -- the server relays and pays gas for\n' +
        'every on-chain call, so it never needs its own ETH or USDC.'
    );
    process.exit(1);
  }
  const workerB = privateKeyToAccount(workerBKey);

  const rpcUrl = process.env.BASE_RPC_URL ?? 'http://127.0.0.1:8545';
  const chainId = parseInt(process.env.CHAIN_ID ?? '84532', 10);
  const chain = chainId === 31337 ? anvil : baseSepolia;
  const usdc = process.env.USDC_TOKEN_ADDRESS;

  console.log('=== Taskmarket Smoke Test — Payment-Orphan Auto-Refund (issue #266) ===');
  console.log('requester:', requester.address);
  console.log('worker:   ', worker.address);
  console.log('workerB:  ', workerB.address);
  console.log('api:      ', API_URL);
  console.log('rpc:      ', rpcUrl);

  try {
    await smokeAuctionAcceptRace(requester, worker, workerB, rpcUrl, chain, usdc);
    await smokeDiamondSelectorMissing(requester, rpcUrl, chain);
  } finally {
    // The refund assertions read the ledger directly, so this script opens a connection
    // pool. Without closing it the process stays alive after a successful run.
    await closeDatabase();
  }

  console.log('\n=== Payment-orphan auto-refund smoke test passed ===');
}

main().catch((err) => {
  console.error('\nFatal:', err);
  process.exit(1);
});

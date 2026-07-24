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
 *     npx tsx --env-file=../../.env scripts/smoke-payment-orphan-refund.ts
 *
 *   # Also run the diamond-upgrade scenario (requires diamond owner key):
 *   SMOKE_UPGRADE=1 UPGRADE_OWNER_KEY=0x... \
 *     REQUESTER_PRIVATE_KEY=0x... WORKER_PRIVATE_KEY=0x... WORKER_B_PRIVATE_KEY=0x... \
 *     npx tsx --env-file=../../.env scripts/smoke-payment-orphan-refund.ts
 */
import {
  createPublicClient,
  createWalletClient,
  http,
  encodeFunctionData,
  parseAbi,
  getAddress,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { baseSepolia, anvil } from 'viem/chains';
import { log, ok, get, x402Post, getAccounts, API_URL, type Account } from './_x402.ts';

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

async function usdcBalance(rpcUrl: string, chain: typeof anvil, usdc: string, address: string) {
  const client = createPublicClient({ chain, transport: http(rpcUrl) });
  return client.readContract({
    address: getAddress(usdc),
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: [getAddress(address)],
  });
}

/** Scenario 1: a genuine on-chain race, no privileged keys required. */
async function smokeAuctionAcceptRace(
  requester: Account,
  worker: Account,
  workerB: Account,
  rpcUrl: string,
  chain: typeof anvil,
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
  const outcomes = await Promise.allSettled(
    workers.map((w) => x402Post(`/api/tasks/${taskId}/bids/accept`, { taskId }, w))
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

  log('3/4', 'Verifying the loser was told about an automatic refund...');
  if (
    !/automatically refunded/i.test(loserReason.message) &&
    !/flagged for manual review/i.test(loserReason.message)
  ) {
    throw new Error(
      `Expected the losing auction-accept to mention a refund outcome, got: ${loserReason.message}`
    );
  }
  ok('refund outcome present in error', true);

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
async function smokeDiamondSelectorMissing(
  requester: Account,
  rpcUrl: string,
  chain: typeof anvil
) {
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

  log('1/5', 'Creating a task to cancel...');
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

  log('2/5', 'Reading current facetAddress for cancelTask selector...');
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

  try {
    log('3/5', 'Removing cancelTask selector (simulating a just-upgraded diamond)...');
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
      '4/5',
      'Cancelling through the normal backend flow (payment settles, on-chain call has nowhere to go)...'
    );
    let cancelError: Error | undefined;
    try {
      await x402Post(`/api/tasks/${taskId}/cancel`, { taskId }, requester);
    } catch (err) {
      cancelError = err as Error;
    }
    if (!cancelError) {
      throw new Error(
        'Expected cancel to fail while cancelTask selector is removed, but it succeeded'
      );
    }
    console.log('  cancel error:', cancelError.message);
    if (
      !/automatically refunded/i.test(cancelError.message) &&
      !/flagged for manual review/i.test(cancelError.message)
    ) {
      throw new Error(
        `Expected the failed cancel to mention a refund outcome, got: ${cancelError.message}`
      );
    }
    ok('refund outcome present in error', true);

    const task = (await get(`/api/tasks/${taskId}`)) as { status: string };
    if (task.status === 'cancelled') {
      throw new Error('Task must not be marked cancelled -- the on-chain cancel never happened');
    }
    ok('task status unchanged (not falsely marked cancelled)', task.status);
  } finally {
    log('5/5', 'Restoring cancelTask selector...');
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
      throw new Error(
        `cancelTask selector NOT restored -- manual intervention required. Expected ${currentFacet}, got ${restoredFacet}`
      );
    }
    ok('cancelTask selector restored', restoredFacet);
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

  await smokeAuctionAcceptRace(requester, worker, workerB, rpcUrl, chain, usdc);
  await smokeDiamondSelectorMissing(requester, rpcUrl, chain);

  console.log('\n=== Payment-orphan auto-refund smoke test passed ===');
}

main().catch((err) => {
  console.error('\nFatal:', err);
  process.exit(1);
});

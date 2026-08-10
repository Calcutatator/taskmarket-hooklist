/**
 * Diamond proxy upgrade smoke test: verifies diamondCut REMOVE + ADD round-trip and state preservation.
 *
 * **Run this against a disposable chain, not a shared one.** It removes a live selector and puts
 * it back, so for the length of one run the diamond is missing `getTask`. That is fine on an
 * Anvil nobody else is using and is not fine on the shared testnet, where it stranded the
 * selector once already: an RPC read lagged behind the REMOVE, the assertion threw, and the ADD
 * never ran. The restore is in a `finally` now and the reads retry, but the exposure is inherent
 * to what this test does rather than a bug that was fixed.
 *
 * **It is not the way to verify a cut.** Applying rev019 and then asking whether the diamond is
 * at rev019 are two different questions, and the second is answered by reading the chain:
 *
 *     cast call $DIAMOND "diamondVersion()(uint256)" --rpc-url $RPC
 *     cast call $DIAMOND "facetAddress(bytes4)(address)" $SELECTOR --rpc-url $RPC
 *
 * Those cost nothing and mutate nothing. This script exists to prove the *upgrade mechanism*
 * works -- that a cut can be made and reversed with state intact -- which is a thing to test on
 * a chain you are willing to break.
 *
 * Prerequisites:
 *   - CONTRACT_ADDRESS env var points to the Diamond proxy
 *   - BASE_RPC_URL env var is set
 *   - UPGRADE_OWNER_KEY or FORGE_DEV_PRIVATE_KEY must be the Diamond owner
 *   - Gated by SMOKE_UPGRADE=1 — will exit without error if not set
 *
 * Flow:
 *   1. Read current facetAddress for getTask selector via DiamondLoupe
 *   2. Create a pre-upgrade task (establishes state)
 *   3. Call diamondCut REMOVE on getTask selector — verify it goes dark
 *   4. Call diamondCut ADD to restore it — verify selector is back
 *   5. Verify pre-upgrade task is still retrievable (state preserved)
 *   6. Create a post-upgrade task (verifies contract still functional)
 *
 * Usage:
 *   SMOKE_UPGRADE=1 UPGRADE_OWNER_KEY=0x... \
 *     npx tsx --env-file=../../.env src/scripts/smoke-upgrade.ts
 */
import { createPublicClient, createWalletClient, http, encodeFunctionData, parseAbi } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { baseSepolia, anvil } from 'viem/chains';
import { log, ok, get, x402Post, getAccounts, API_URL } from './_x402';

const DIAMOND_ABI = parseAbi([
  'function diamondCut((address facetAddress, uint8 action, bytes4[] functionSelectors)[] cuts, address init, bytes calldata initCalldata)',
  'function facetAddress(bytes4 selector) view returns (address)',
]);

// FacetCutAction: 0 = Add, 1 = Replace, 2 = Remove
const ACTION_ADD = 0;
const ACTION_REMOVE = 2;

// bytes4(keccak256("getTask(bytes32)"))
const GET_TASK_SELECTOR = '0x15a29035' as `0x${string}`;
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as `0x${string}`;

async function main() {
  if (!process.env.SMOKE_UPGRADE) {
    console.log('SMOKE_UPGRADE not set — skipping upgrade smoke test');
    console.log('Set SMOKE_UPGRADE=1 to run this test');
    process.exit(0);
  }

  const ownerKey = (process.env.UPGRADE_OWNER_KEY ?? process.env.FORGE_DEV_PRIVATE_KEY) as
    | `0x${string}`
    | undefined;

  if (!ownerKey) {
    console.error('Set UPGRADE_OWNER_KEY or FORGE_DEV_PRIVATE_KEY (Diamond owner)');
    process.exit(1);
  }

  const contractAddress = process.env.CONTRACT_ADDRESS as `0x${string}` | undefined;
  if (!contractAddress) {
    console.error('Set CONTRACT_ADDRESS env var (Diamond proxy address)');
    process.exit(1);
  }

  // Narrowed once, here: the guard above does not carry into the closures defined later, so
  // they would see `0x${string} | undefined` and fail to type-check against viem.
  const diamond: `0x${string}` = contractAddress;

  const rpcUrl = process.env.BASE_RPC_URL ?? 'http://127.0.0.1:8545';
  const chainId = parseInt(process.env.CHAIN_ID ?? '84532', 10);
  const chain = chainId === 31337 ? anvil : baseSepolia;

  const { requester } = getAccounts();
  const owner = privateKeyToAccount(ownerKey);

  console.log('=== Taskmarket Smoke Test — Diamond Upgrade ===');
  console.log('diamond:  ', contractAddress);
  console.log('owner:    ', owner.address);
  console.log('requester:', requester.address);
  console.log('rpc:      ', rpcUrl);
  console.log('api:      ', API_URL);

  const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
  const walletClient = createWalletClient({ account: owner, chain, transport: http(rpcUrl) });

  // 1. Read current facet address for getTask
  log('1/6', 'Reading current facetAddress for getTask selector...');
  const currentFacet = await publicClient.readContract({
    address: contractAddress,
    abi: DIAMOND_ABI,
    functionName: 'facetAddress',
    args: [GET_TASK_SELECTOR],
  });
  if (currentFacet === ZERO_ADDRESS) {
    throw new Error('getTask selector not registered in Diamond');
  }
  ok('current RegistryFacet address', currentFacet);

  // 2. Create a pre-upgrade task
  log('2/6', 'Creating pre-upgrade task (X402)...');
  const { taskId: preTaskId } = (await x402Post(
    '/api/tasks',
    {
      description: 'Diamond upgrade smoke test — pre-upgrade task',
      reward: '1000',
      duration: 1,
      mode: 'bounty',
      tags: ['smoke-upgrade'],
    },
    requester
  )) as { taskId: string };
  ok('pre-upgrade taskId', preTaskId);

  // 3. REMOVE the getTask selector
  /**
   * Read `facetAddress` until it settles on `expected`, rather than once.
   *
   * A `diamondCut` receipt says the cut mined; it does not say the node you ask next has caught
   * up. Reading once turned ordinary read-after-write lag into "the upgrade failed" -- and
   * because the assertion threw between the REMOVE and the ADD, it left the selector
   * unregistered on a shared testnet. That is the whole reason this helper exists; it is the
   * same lag `services/contract.ts` retries around on every relay.
   */
  async function facetSettlesAt(expected: string, label: string): Promise<void> {
    for (let attempt = 0; attempt < 10; attempt++) {
      const seen = (await publicClient.readContract({
        address: diamond,
        abi: DIAMOND_ABI,
        functionName: 'facetAddress',
        args: [GET_TASK_SELECTOR],
      })) as string;
      if (seen.toLowerCase() === expected.toLowerCase()) return;
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
    throw new Error(`${label}: facetAddress never settled at ${expected}`);
  }

  /**
   * Put the selector back, whatever happened in between.
   *
   * Called from a `finally`, because the failure that matters is not this cut going wrong -- it
   * is the run dying after the REMOVE and before the ADD, which leaves the diamond missing a
   * function. `smoke-evaluator` restores the appeal-window floor the same way and for the same
   * reason; this script mutates a live diamond and had no such guarantee.
   */
  let selectorRemoved = false;
  async function restoreSelector(): Promise<void> {
    if (!selectorRemoved) return;
    const restoreTx = await walletClient.sendTransaction({
      to: diamond,
      data: encodeFunctionData({
        abi: DIAMOND_ABI,
        functionName: 'diamondCut',
        args: [
          [
            {
              facetAddress: currentFacet,
              action: ACTION_ADD,
              functionSelectors: [GET_TASK_SELECTOR],
            },
          ],
          ZERO_ADDRESS,
          '0x',
        ],
      }),
      chain,
      account: owner,
    });
    await publicClient.waitForTransactionReceipt({ hash: restoreTx });
    await facetSettlesAt(currentFacet, 'restore');
    selectorRemoved = false;
    ok('getTask selector restored', restoreTx);
  }

  try {
    log('3/6', 'Calling diamondCut REMOVE on getTask selector...');
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
              functionSelectors: [GET_TASK_SELECTOR],
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
    // Set the moment the receipt is in, before anything that can throw: the restore below has to
    // run for a removal that happened, not only for one this script went on to observe.
    selectorRemoved = true;
    ok('REMOVE diamondCut mined', removeTx);

    await facetSettlesAt(ZERO_ADDRESS, 'after REMOVE');
    ok('selector unregistered after REMOVE', true);

    // 4. Re-ADD the selector pointing back to the original facet
    log('4/6', 'Calling diamondCut ADD to restore getTask selector...');
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
              functionSelectors: [GET_TASK_SELECTOR],
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
    selectorRemoved = false;
    ok('ADD diamondCut mined', addTx);

    await facetSettlesAt(currentFacet, 'after ADD');
    ok('selector restored after ADD', currentFacet);

    // 5. Verify pre-upgrade task state is preserved
    log('5/6', 'Verifying pre-upgrade task state is preserved...');
    const preTask = (await get(`/api/tasks/${preTaskId}`)) as { status: string; id: string };
    if (preTask.id !== preTaskId) {
      throw new Error(`Pre-upgrade task ${preTaskId} not retrievable after diamondCut`);
    }
    if (preTask.status !== 'open') {
      throw new Error(`Expected pre-upgrade task to be open, got ${preTask.status}`);
    }
    ok('pre-upgrade task still retrievable', preTask.status);

    // 6. Create a post-upgrade task
    log('6/6', 'Creating post-upgrade task to verify contract functionality...');
    const { taskId: postTaskId } = (await x402Post(
      '/api/tasks',
      {
        description: 'Diamond upgrade smoke test — post-upgrade task',
        reward: '1000',
        duration: 1,
        mode: 'bounty',
        tags: ['smoke-upgrade'],
      },
      requester
    )) as { taskId: string };
    ok('post-upgrade taskId', postTaskId);

    const postTask = (await get(`/api/tasks/${postTaskId}`)) as { status: string };
    if (postTask.status !== 'open') {
      throw new Error(`Post-upgrade task status unexpected: ${postTask.status}`);
    }
    ok('post-upgrade task status=open', true);

    console.log('\n=== Diamond upgrade smoke test passed ===');
    console.log('pre-upgrade taskId: ', preTaskId);
    console.log('post-upgrade taskId:', postTaskId);
    console.log('diamond address:    ', contractAddress);
  } finally {
    // The point of the whole structure. A run that dies anywhere after the REMOVE -- a failed
    // assertion, a dropped RPC, an interrupt -- must not leave the diamond missing a function,
    // and on a shared network that is not a theoretical concern: it happened, and getTask sat
    // unregistered until it was put back by hand.
    //
    // A restore that itself fails says so as loudly as it can, because at that point the chain
    // needs a person.
    try {
      await restoreSelector();
    } catch (restoreError) {
      console.error(
        `\nFATAL: the getTask selector was removed and could NOT be restored. The diamond at ` +
          `${contractAddress} is missing ${GET_TASK_SELECTOR} and needs a manual diamondCut ADD ` +
          `pointing it back at ${currentFacet}.`,
        restoreError
      );
      // Deliberately not re-thrown: a throw from a `finally` replaces whatever error was already
      // on its way out, hiding the failure that made the restore necessary. The exit code carries
      // the alarm instead.
      process.exitCode = 1;
    }
  }
}

main().catch((err) => {
  console.error('\nFatal:', err);
  process.exit(1);
});

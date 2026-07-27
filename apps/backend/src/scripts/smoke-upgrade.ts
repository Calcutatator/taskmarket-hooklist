/**
 * Diamond proxy upgrade smoke test: verifies diamondCut REMOVE + ADD round-trip and state preservation.
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
  ok('REMOVE diamondCut mined', removeTx);

  const removedFacet = await publicClient.readContract({
    address: contractAddress,
    abi: DIAMOND_ABI,
    functionName: 'facetAddress',
    args: [GET_TASK_SELECTOR],
  });
  if (removedFacet !== ZERO_ADDRESS) {
    throw new Error(`Expected zero address after REMOVE, got ${removedFacet}`);
  }
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
  ok('ADD diamondCut mined', addTx);

  const restoredFacet = await publicClient.readContract({
    address: contractAddress,
    abi: DIAMOND_ABI,
    functionName: 'facetAddress',
    args: [GET_TASK_SELECTOR],
  });
  if (restoredFacet.toLowerCase() !== currentFacet.toLowerCase()) {
    throw new Error(`Expected facet restored to ${currentFacet}, got ${restoredFacet}`);
  }
  ok('selector restored after ADD', restoredFacet);

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
}

main().catch((err) => {
  console.error('\nFatal:', err);
  process.exit(1);
});

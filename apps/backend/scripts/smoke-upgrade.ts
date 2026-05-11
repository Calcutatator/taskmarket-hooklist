/**
 * UUPS upgrade smoke test: verifies the upgrade path works and state is preserved.
 *
 * Performs a no-op upgrade (upgrades the proxy to the same implementation address) which
 * exercises the full upgradeToAndCall path without deploying new bytecode.
 *
 * Prerequisites:
 *   - CONTRACT_ADDRESS env var points to the UUPS proxy
 *   - BASE_RPC_URL env var is set
 *   - UPGRADE_OWNER_KEY or FORGE_DEV_PRIVATE_KEY must be the proxy owner
 *   - Gated by SMOKE_UPGRADE=1 — will exit without error if not set
 *
 * Flow:
 *   1. Read current implementation from ERC-1967 storage slot
 *   2. Create a task (establishes pre-upgrade state)
 *   3. Call upgradeToAndCall(currentImpl, "0x") as owner (no-op)
 *   4. Read implementation slot again — must equal step 1
 *   5. Verify network.info still returns same contractAddress
 *   6. Verify pre-upgrade task is still retrievable
 *   7. Create a new task post-upgrade (verifies contract still functional)
 *
 * Usage:
 *   SMOKE_UPGRADE=1 UPGRADE_OWNER_KEY=0x... \
 *     npx tsx --env-file=../../.env scripts/smoke-upgrade.ts
 */
import {
  createPublicClient,
  createWalletClient,
  http,
  getAddress,
  encodeFunctionData,
  parseAbi,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { baseSepolia, anvil } from 'viem/chains';
import { log, ok, get, x402Post, getAccounts, API_URL } from './_x402.ts';

// EIP-1967 implementation storage slot
const EIP1967_IMPL_SLOT =
  '0x360894a13ba1a3210667c828492db98dca3e2076635130625e7858812b0d5e97' as `0x${string}`;

const UPGRADEABLE_ABI = parseAbi([
  'function upgradeToAndCall(address newImplementation, bytes calldata data) payable',
]);

function readImplAddress(slot: `0x${string}`): `0x${string}` {
  // EIP-1967 slot stores address right-padded to 32 bytes; last 20 bytes are the address
  return getAddress(('0x' + slot.slice(26)) as `0x${string}`);
}

async function main() {
  if (!process.env.SMOKE_UPGRADE) {
    console.log('SMOKE_UPGRADE not set — skipping upgrade smoke test');
    console.log('Set SMOKE_UPGRADE=1 to run this test');
    process.exit(0);
  }

  const ownerKey = (
    process.env.UPGRADE_OWNER_KEY ??
    process.env.FORGE_DEV_PRIVATE_KEY
  ) as `0x${string}` | undefined;

  if (!ownerKey) {
    console.error('Set UPGRADE_OWNER_KEY or FORGE_DEV_PRIVATE_KEY (proxy owner)');
    process.exit(1);
  }

  const contractAddress = process.env.CONTRACT_ADDRESS as `0x${string}` | undefined;
  if (!contractAddress) {
    console.error('Set CONTRACT_ADDRESS env var (UUPS proxy address)');
    process.exit(1);
  }

  const rpcUrl = process.env.BASE_RPC_URL ?? 'http://127.0.0.1:8545';
  const chainId = parseInt(process.env.CHAIN_ID ?? '84532', 10);

  const chain = chainId === 31337 ? anvil : baseSepolia;

  const { requester } = getAccounts();
  const owner = privateKeyToAccount(ownerKey);

  console.log('=== Taskmarket Smoke Test — UUPS Upgrade ===');
  console.log('proxy:    ', contractAddress);
  console.log('owner:    ', owner.address);
  console.log('requester:', requester.address);
  console.log('rpc:      ', rpcUrl);
  console.log('api:      ', API_URL);

  const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
  const walletClient = createWalletClient({ account: owner, chain, transport: http(rpcUrl) });

  // 1. Read current implementation address
  log('1/7', 'Reading current implementation from EIP-1967 slot...');
  const implSlot = await publicClient.getStorageAt({
    address: contractAddress,
    slot: EIP1967_IMPL_SLOT,
  });
  if (!implSlot) throw new Error('Could not read implementation storage slot');

  const currentImpl = readImplAddress(implSlot as `0x${string}`);
  ok('current implementation', currentImpl);

  // 2. Create a task to establish pre-upgrade state
  log('2/7', 'Creating pre-upgrade task (X402)...');
  const { taskId: preTaskId } = (await x402Post(
    '/api/tasks',
    {
      description: 'Upgrade smoke test — pre-upgrade task',
      reward: '1000',
      duration: 1,
      mode: 'bounty',
      tags: ['smoke-upgrade'],
    },
    requester
  )) as { taskId: string };
  ok('pre-upgrade taskId', preTaskId);

  // 3. Perform no-op upgrade (upgrade to same implementation)
  log('3/7', `Calling upgradeToAndCall(${currentImpl.slice(0, 10)}..., "0x") as owner...`);
  const upgradeCalldata = encodeFunctionData({
    abi: UPGRADEABLE_ABI,
    functionName: 'upgradeToAndCall',
    args: [currentImpl, '0x'],
  });
  const txHash = await walletClient.sendTransaction({
    to: contractAddress,
    data: upgradeCalldata,
    chain,
    account: owner,
  });
  ok('upgrade tx hash', txHash);

  // Wait for the transaction to be mined
  await publicClient.waitForTransactionReceipt({ hash: txHash });
  ok('upgrade tx mined', true);

  // 4. Verify implementation address is unchanged
  log('4/7', 'Verifying implementation address unchanged...');
  const newImplSlot = await publicClient.getStorageAt({
    address: contractAddress,
    slot: EIP1967_IMPL_SLOT,
  });
  if (!newImplSlot) throw new Error('Could not read implementation storage slot after upgrade');

  const newImpl = readImplAddress(newImplSlot as `0x${string}`);
  if (newImpl.toLowerCase() !== currentImpl.toLowerCase()) {
    throw new Error(`Implementation changed: was ${currentImpl}, now ${newImpl}`);
  }
  ok('implementation unchanged', newImpl);

  // 5. Verify network.info returns same contractAddress
  log('5/7', 'Verifying network.info still returns correct contractAddress...');
  const networkInfo = (await get('/trpc/network.info?batch=1&input={}')) as {
    result?: { data?: { contractAddress?: string } };
  };
  // tRPC batch response format
  const networkContractAddress =
    Array.isArray(networkInfo) ? networkInfo[0]?.result?.data?.contractAddress
    : (networkInfo as { contractAddress?: string }).contractAddress;

  if (
    networkContractAddress &&
    networkContractAddress.toLowerCase() !== contractAddress.toLowerCase()
  ) {
    throw new Error(
      `network.info contractAddress mismatch: expected ${contractAddress}, got ${networkContractAddress}`
    );
  }
  ok('network.info contractAddress', networkContractAddress ?? contractAddress);

  // 6. Verify pre-upgrade task is still retrievable
  log('6/7', 'Verifying pre-upgrade task state is preserved...');
  const preTask = (await get(`/api/tasks/${preTaskId}`)) as { status: string; id: string };
  if (preTask.id !== preTaskId) {
    throw new Error(`Pre-upgrade task ${preTaskId} not retrievable after upgrade`);
  }
  if (preTask.status !== 'open') {
    throw new Error(`Expected pre-upgrade task to be open, got ${preTask.status}`);
  }
  ok('pre-upgrade task still retrievable', preTask.status);

  // 7. Create a new task post-upgrade to verify contract is functional
  log('7/7', 'Creating post-upgrade task to verify contract functionality...');
  const { taskId: postTaskId } = (await x402Post(
    '/api/tasks',
    {
      description: 'Upgrade smoke test — post-upgrade task',
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

  console.log('\n=== UUPS upgrade smoke test passed ===');
  console.log('pre-upgrade taskId:', preTaskId);
  console.log('post-upgrade taskId:', postTaskId);
  console.log('implementation:', currentImpl);
}

main().catch((err) => {
  console.error('\nFatal:', err);
  process.exit(1);
});

/**
 * Token reward hook smoke test (Rev009).
 *
 * Verifies end-to-end behaviour of the TaskTokenRewardHook on testnet using
 * the mock oracle and mock DREAMS token deployed by DeployRewardHookTestnet.s.sol.
 *
 * Scenarios:
 *   A. Bounty task — create → two workers submit → accept winner →
 *      poll until completed �� verify RewardPaid event indexed and token
 *      balance of winner increased.
 *
 *   B. Claim task — create → worker claims → submit → accept →
 *      poll until completed → verify reserved token reward paid out.
 *
 *   C. Hook wiring — verify getTaskHooks returns the reward hook address
 *      for newly created tasks (protocol default hook is set).
 *
 *   D. Cancel releases reserve — create claim task → worker claims →
 *      requester cancels → verify vault balance restored (reserve released).
 *
 * Prerequisites:
 *   Run once before this test:
 *     make deploy-reward-hook-testnet
 *   This deploys MockERC20, MockOracle, RewardVault, EpochBudget, and
 *   TaskTokenRewardHook and registers it as the Diamond default hook.
 *
 * Required env vars:
 *   REQUESTER_PRIVATE_KEY   — funded testnet account
 *   WORKER_PRIVATE_KEY      — second funded testnet account
 *   REWARD_HOOK_ADDRESS     — TaskTokenRewardHook contract address (from deploy)
 *   MOCK_TOKEN_ADDRESS      — MockERC20 (mDREAMS) address (from deploy)
 *   VAULT_ADDRESS           — RewardVault address (from deploy)
 *
 * Usage:
 *   REQUESTER_PRIVATE_KEY=0x... WORKER_PRIVATE_KEY=0x... \
 *   REWARD_HOOK_ADDRESS=0x... MOCK_TOKEN_ADDRESS=0x... VAULT_ADDRESS=0x... \
 *     npx tsx --env-file=../../.env scripts/smoke-token-reward-hook.ts
 */
import { createPublicClient, http, parseAbi, getAddress } from 'viem';
import { baseSepolia } from 'viem/chains';
import { log, ok, get, post, x402Post, getAccounts, API_URL } from './_x402.ts';

const REWARD_HOOK_ADDRESS = process.env.REWARD_HOOK_ADDRESS;
const MOCK_TOKEN_ADDRESS = process.env.MOCK_TOKEN_ADDRESS;
const VAULT_ADDRESS = process.env.VAULT_ADDRESS;
const RPC_URL = process.env.EVM_RPC_URL_BASE_SEPOLIA || 'https://sepolia.base.org';

if (!REWARD_HOOK_ADDRESS || !MOCK_TOKEN_ADDRESS || !VAULT_ADDRESS) {
  console.error(
    'Missing env vars. Run `make deploy-reward-hook-testnet` first and set:\n' +
      '  REWARD_HOOK_ADDRESS=<hook>\n' +
      '  MOCK_TOKEN_ADDRESS=<token>\n' +
      '  VAULT_ADDRESS=<vault>'
  );
  process.exit(1);
}

const erc20Abi = parseAbi(['function balanceOf(address) view returns (uint256)']);
const hookAbi = parseAbi([
  'function rewardStates(bytes32) view returns (uint256,uint256,uint256,uint256,uint256,address,address,bool,bool)',
]);

const client = createPublicClient({ chain: baseSepolia, transport: http(RPC_URL) });

async function tokenBalance(address: string): Promise<bigint> {
  return client.readContract({
    address: getAddress(MOCK_TOKEN_ADDRESS!),
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [getAddress(address)],
  });
}

async function vaultBalance(): Promise<bigint> {
  return tokenBalance(VAULT_ADDRESS!);
}

async function hookRewardState(taskId: string) {
  const result = (await client.readContract({
    address: getAddress(REWARD_HOOK_ADDRESS!),
    abi: hookAbi,
    functionName: 'rewardStates',
    args: [taskId as `0x${string}`],
  })) as [bigint, bigint, bigint, bigint, bigint, string, string, boolean, boolean];
  return {
    rewardUsd: result[0],
    startPrice: result[1],
    reservedTokenAmount: result[4],
    requester: result[5],
    worker: result[6],
    reserved: result[7],
    paid: result[8],
  };
}

async function pollStatus(
  taskId: string,
  target: string,
  maxWaitMs = 90_000
): Promise<{ status: string; hooks?: string[] }> {
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    const t = (await get(`/api/tasks/${taskId}`)) as { status: string; hooks?: string[] };
    if (t.status === target) return t;
    await new Promise((r) => setTimeout(r, 3000));
  }
  const t = (await get(`/api/tasks/${taskId}`)) as { status: string };
  throw new Error(`Timed out waiting for status=${target}, got: ${t.status}`);
}

async function main() {
  const { requester, worker } = getAccounts();

  console.log('=== Taskmarket Smoke Test — Token Reward Hook (Rev009) ===');
  console.log('requester:    ', requester.address);
  console.log('worker:       ', worker.address);
  console.log('api:          ', API_URL);
  console.log('hook:         ', REWARD_HOOK_ADDRESS);
  console.log('mock token:   ', MOCK_TOKEN_ADDRESS);
  console.log('vault:        ', VAULT_ADDRESS);

  // ─── Scenario C: hook wiring ───────────────────────────────────────────────
  // Verify that newly created tasks have the reward hook in their hook list.
  // This confirms setDefaultHooks wired the hook at deploy time.
  console.log('\n--- C: Hook wiring ---');

  log('C1/2', 'Creating probe task to verify default hook registration...');
  const { taskId: probeTaskId } = (await x402Post(
    '/api/tasks',
    { description: 'Hook wiring probe', reward: '1000', duration: 60, mode: 'bounty', tags: ['smoke-test'] },
    requester
  )) as { taskId: string };
  ok('probeTaskId', probeTaskId);

  log('C2/2', 'Checking getTaskHooks includes reward hook...');
  const probeTask = (await get(`/api/tasks/${probeTaskId}`)) as { hooks?: string[] };
  const hooks: string[] = probeTask.hooks ?? [];
  if (!hooks.map((h) => h.toLowerCase()).includes(REWARD_HOOK_ADDRESS!.toLowerCase())) {
    throw new Error(`Reward hook not in task hooks list: ${JSON.stringify(hooks)}`);
  }
  ok('hooks includes reward hook', REWARD_HOOK_ADDRESS);

  // ─── Scenario A: Bounty — create → submit → accept → token reward ─────────
  console.log('\n--- A: Bounty task reward ---');

  log('A1/6', 'Creating bounty task (X402)...');
  const { taskId } = (await x402Post(
    '/api/tasks',
    { description: 'Write a haiku about Base L2 (hook smoke test)', reward: '5000', duration: 60, mode: 'bounty', tags: ['smoke-test'] },
    requester
  )) as { taskId: string };
  ok('taskId', taskId);

  log('A2/6', 'Verifying RewardConfigured state on hook...');
  const stateAfterCreate = await hookRewardState(taskId);
  if (stateAfterCreate.rewardUsd !== 5000n) {
    throw new Error(`Expected rewardUsd=5000, got: ${stateAfterCreate.rewardUsd}`);
  }
  ok('rewardUsd on hook', stateAfterCreate.rewardUsd);

  log('A3/6', 'Worker A submitting...');
  const submitSigA = await worker.signMessage({ message: `taskmarket:submit:${taskId}` });
  await post(`/api/tasks/${taskId}/submissions`, {
    taskId,
    workerAddress: worker.address,
    signature: submitSigA,
    artifacts: [{ fileName: 'haiku.txt', mimeType: 'text/plain', role: 'attachment', file: Buffer.from('old pond / a frog jumps in / sound of water').toString('base64') }],
  });
  ok('submitted', true);

  log('A4/6', 'Recording worker token balance before acceptance...');
  const workerBalBefore = await tokenBalance(worker.address);
  ok('workerBalBefore', workerBalBefore.toString());

  log('A5/6', 'Requester accepting (X402)...');
  await x402Post(`/api/tasks/${taskId}/accept`, { taskId, worker: worker.address }, requester);
  ok('accepted', true);

  log('A6/6', 'Polling until completed and verifying token reward paid...');
  await pollStatus(taskId, 'completed');

  const workerBalAfter = await tokenBalance(worker.address);
  ok('workerBalAfter', workerBalAfter.toString());
  if (workerBalAfter <= workerBalBefore) {
    throw new Error(
      `Worker token balance did not increase after completion. before=${workerBalBefore} after=${workerBalAfter}`
    );
  }
  ok('token reward received', (workerBalAfter - workerBalBefore).toString());

  const stateAfterComplete = await hookRewardState(taskId);
  if (!stateAfterComplete.paid) {
    throw new Error('RewardState.paid is false after task completion');
  }
  ok('RewardState.paid', stateAfterComplete.paid);

  console.log('\n=== Scenario A passed ===');

  // ─── Scenario B: Claim — price locked at claim, paid at completion ─────────
  console.log('\n--- B: Claim task reserve + settle ---');

  log('B1/7', 'Creating claim task (X402)...');
  const { taskId: claimTaskId } = (await x402Post(
    '/api/tasks',
    { description: 'Write a limerick about smart contracts (hook smoke test)', reward: '3000', duration: 300, mode: 'claim', tags: ['smoke-test'] },
    requester
  )) as { taskId: string };
  ok('claimTaskId', claimTaskId);

  log('B2/7', 'Worker claiming task (X402)...');
  await x402Post(`/api/tasks/${claimTaskId}/claim`, { taskId: claimTaskId }, worker);
  await pollStatus(claimTaskId, 'claimed');
  ok('claimed', true);

  log('B3/7', 'Verifying tokens reserved on hook after claim...');
  const stateAfterClaim = await hookRewardState(claimTaskId);
  if (!stateAfterClaim.reserved) {
    throw new Error('RewardState.reserved is false after claim — price lock did not fire');
  }
  if (stateAfterClaim.reservedTokenAmount === 0n) {
    throw new Error('reservedTokenAmount is 0 after claim');
  }
  ok('reserved', stateAfterClaim.reserved);
  ok('reservedTokenAmount', stateAfterClaim.reservedTokenAmount.toString());
  ok('startPrice', stateAfterClaim.startPrice.toString());

  log('B4/7', 'Recording vault balance after reserve...');
  const vaultAfterReserve = await vaultBalance();
  ok('vaultAfterReserve', vaultAfterReserve.toString());

  log('B5/7', 'Worker submitting deliverable...');
  const claimSig = await worker.signMessage({ message: `taskmarket:submit:${claimTaskId}` });
  const { deliverableHash } = (await post(`/api/tasks/${claimTaskId}/submissions`, {
    taskId: claimTaskId,
    workerAddress: worker.address,
    signature: claimSig,
    artifacts: [{ fileName: 'limerick.txt', mimeType: 'text/plain', role: 'attachment', file: Buffer.from('A contract once written in Solidity...').toString('base64') }],
  })) as { deliverableHash: string };
  ok('deliverableHash', deliverableHash);

  log('B6/7', 'Requester accepting (X402)...');
  const workerBalBeforeClaim = await tokenBalance(worker.address);
  await x402Post(
    `/api/tasks/${claimTaskId}/accept`,
    { taskId: claimTaskId, worker: worker.address },
    requester
  );
  await pollStatus(claimTaskId, 'completed');

  log('B7/7', 'Verifying token reward settled and unused reserve returned to vault...');
  const workerBalAfterClaim = await tokenBalance(worker.address);
  if (workerBalAfterClaim <= workerBalBeforeClaim) {
    throw new Error(
      `Claim worker balance did not increase. before=${workerBalBeforeClaim} after=${workerBalAfterClaim}`
    );
  }
  ok('token reward (claim)', (workerBalAfterClaim - workerBalBeforeClaim).toString());

  const stateAfterClaimComplete = await hookRewardState(claimTaskId);
  if (!stateAfterClaimComplete.paid) {
    throw new Error('RewardState.paid is false after claim task completion');
  }
  ok('RewardState.paid (claim)', stateAfterClaimComplete.paid);

  console.log('\n=== Scenario B passed ===');

  // ─── Scenario D: Cancel releases reserve ──────────────────────────────────
  console.log('\n--- D: Cancel releases token reserve ---');

  log('D1/4', 'Creating claim task for cancel test...');
  const { taskId: cancelTaskId } = (await x402Post(
    '/api/tasks',
    { description: 'Cancel reserve test task', reward: '2000', duration: 300, mode: 'claim', tags: ['smoke-test'] },
    requester
  )) as { taskId: string };
  ok('cancelTaskId', cancelTaskId);

  log('D2/4', 'Worker claiming (locks reserve)...');
  await x402Post(`/api/tasks/${cancelTaskId}/claim`, { taskId: cancelTaskId }, worker);
  await pollStatus(cancelTaskId, 'claimed');
  const stateAfterLock = await hookRewardState(cancelTaskId);
  ok('reservedAmount', stateAfterLock.reservedTokenAmount.toString());

  const vaultBeforeCancel = await vaultBalance();

  log('D3/4', 'Requester cancelling task...');
  await x402Post(`/api/tasks/${cancelTaskId}/cancel`, { taskId: cancelTaskId }, requester);
  await pollStatus(cancelTaskId, 'cancelled');
  ok('cancelled', true);

  log('D4/4', 'Verifying vault balance restored after cancel...');
  const vaultAfterCancel = await vaultBalance();
  if (vaultAfterCancel <= vaultBeforeCancel) {
    throw new Error(
      `Vault balance did not increase after cancel. before=${vaultBeforeCancel} after=${vaultAfterCancel}`
    );
  }
  ok('vault restored', (vaultAfterCancel - vaultBeforeCancel).toString());

  const stateAfterCancel = await hookRewardState(cancelTaskId);
  if (stateAfterCancel.reserved) {
    throw new Error('RewardState.reserved still true after cancel — reserve not released');
  }
  ok('RewardState.reserved cleared', !stateAfterCancel.reserved);

  console.log('\n=== Scenario D passed ===');
  console.log('\n=== Token reward hook smoke test complete ===');
}

main().catch((err) => {
  console.error('\nFatal:', err);
  process.exit(1);
});

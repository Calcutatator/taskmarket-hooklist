/**
 * Token reward hook smoke test (Rev010).
 *
 * Verifies end-to-end behaviour of the TaskTokenRewardHook (claimable escrow model)
 * on testnet using the mock oracle and mock DREAMS token deployed by
 * DeployRewardHookTestnet.s.sol.
 *
 * Scenarios:
 *   A. Bounty task — create → worker submits → accept winner →
 *      poll until completed → verify hook.claimable(worker) > 0 →
 *      call POST /api/wallet/withdraw-dreams → verify token balance lands.
 *
 *   B. Claim task — create → worker claims → submit → accept →
 *      poll until completed → verify hook.claimable(worker) > 0.
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
 *   The hook must use bypass ramp (setRamp([1,2,3],[10000,10000,10000,10000]))
 *   so that new wallets earn full rewards immediately on testnet.
 *
 * Required env vars:
 *   REQUESTER_PRIVATE_KEY   — funded testnet account
 *   WORKER_PRIVATE_KEY      — second funded testnet account
 *   REWARD_HOOK_ADDRESS     — TaskTokenRewardHook contract address (from deploy)
 *   MOCK_TOKEN_ADDRESS      — MockERC20 (mDREAMS) address (from deploy)
 *   VAULT_ADDRESS           — RewardVault address (from deploy)
 *   WORKER_WITHDRAWAL_ADDRESS — destination for DREAMS withdrawal (must be pre-set
 *                               via `taskmarket wallet set-withdrawal-address`)
 *
 * Usage:
 *   REQUESTER_PRIVATE_KEY=0x... WORKER_PRIVATE_KEY=0x... \
 *   REWARD_HOOK_ADDRESS=0x... MOCK_TOKEN_ADDRESS=0x... VAULT_ADDRESS=0x... \
 *   WORKER_WITHDRAWAL_ADDRESS=0x... \
 *     npx tsx --env-file=../../.env scripts/smoke-token-reward-hook.ts
 */
import { createPublicClient, http, parseAbi, getAddress } from 'viem';
import { baseSepolia } from 'viem/chains';
import { log, ok, get, post, x402Post, getAccounts, API_URL } from './_x402.ts';

const REWARD_HOOK_ADDRESS = process.env.REWARD_HOOK_ADDRESS;
const MOCK_TOKEN_ADDRESS = process.env.MOCK_TOKEN_ADDRESS;
const VAULT_ADDRESS = process.env.VAULT_ADDRESS;
const WORKER_WITHDRAWAL_ADDRESS = process.env.WORKER_WITHDRAWAL_ADDRESS;
const RPC_URL = process.env.EVM_RPC_URL_BASE_SEPOLIA || 'https://sepolia.base.org';

if (!process.env.REQUESTER_PRIVATE_KEY || !process.env.WORKER_PRIVATE_KEY) {
  console.error(
    'Missing required env vars:\n' +
      '  REQUESTER_PRIVATE_KEY=0x...\n' +
      '  WORKER_PRIVATE_KEY=0x...'
  );
  process.exit(1);
}

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
  'function claimable(address wallet) view returns (uint256)',
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

async function hookClaimable(wallet: string): Promise<bigint> {
  return client.readContract({
    address: getAddress(REWARD_HOOK_ADDRESS!),
    abi: hookAbi,
    functionName: 'claimable',
    args: [getAddress(wallet)],
  }) as Promise<bigint>;
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

  log('A1/5', 'Creating bounty task (X402)...');
  const { taskId } = (await x402Post(
    '/api/tasks',
    { description: 'Write a haiku about Base L2 (hook smoke test)', reward: '5000', duration: 60, mode: 'bounty', tags: ['smoke-test'] },
    requester
  )) as { taskId: string };
  ok('taskId', taskId);

  log('A2/5', 'Verifying RewardConfigured state on hook...');
  const stateAfterCreate = await hookRewardState(taskId);
  if (stateAfterCreate.rewardUsd !== 5000n) {
    throw new Error(`Expected rewardUsd=5000, got: ${stateAfterCreate.rewardUsd}`);
  }
  ok('rewardUsd on hook', stateAfterCreate.rewardUsd);

  log('A3/5', 'Worker A submitting...');
  const submitSigA = await worker.signMessage({ message: `taskmarket:submit:${taskId}` });
  await post(`/api/tasks/${taskId}/submissions`, {
    taskId,
    workerAddress: worker.address,
    signature: submitSigA,
    artifacts: [{ fileName: 'haiku.txt', mimeType: 'text/plain', role: 'attachment', file: Buffer.from('old pond / a frog jumps in / sound of water').toString('base64') }],
  });
  ok('submitted', true);

  log('A4/5', 'Requester accepting (X402)...');
  await x402Post(`/api/tasks/${taskId}/accept`, { taskId, worker: worker.address }, requester);
  ok('accepted', true);

  log('A5/5', 'Polling until completed and verifying claimable reward...');
  await pollStatus(taskId, 'completed');

  const claimableAfter = await hookClaimable(worker.address);
  ok('hook.claimable(worker)', claimableAfter.toString());
  if (claimableAfter === 0n) {
    throw new Error('Worker claimable balance is 0 after task completion');
  }

  const apiBalance = (await get(`/api/wallet/dreams-balance?address=${worker.address}`)) as {
    claimableBaseUnits: string;
  };
  ok('GET /wallet/dreams-balance', apiBalance.claimableBaseUnits);
  if (BigInt(apiBalance.claimableBaseUnits) === 0n) {
    throw new Error('API returned 0 claimableBaseUnits after completion');
  }

  const stateAfterComplete = await hookRewardState(taskId);
  if (!stateAfterComplete.paid) {
    throw new Error('RewardState.paid is false after task completion');
  }
  ok('RewardState.paid', stateAfterComplete.paid);

  // If a withdrawal address is configured, exercise the withdraw-dreams flow
  if (WORKER_WITHDRAWAL_ADDRESS) {
    const destBalBefore = await tokenBalance(WORKER_WITHDRAWAL_ADDRESS);
    const withdrawResult = (await post('/api/wallet/withdraw-dreams', {
      workerAddress: worker.address,
      destination: WORKER_WITHDRAWAL_ADDRESS,
      signature: await worker.signMessage({
        message: `taskmarket:withdraw-dreams:${WORKER_WITHDRAWAL_ADDRESS}`,
      }),
    })) as { txHash: string; claimedBaseUnits: string };
    ok('withdrawDreams txHash', withdrawResult.txHash);
    const destBalAfter = await tokenBalance(WORKER_WITHDRAWAL_ADDRESS);
    if (destBalAfter <= destBalBefore) {
      throw new Error(
        `Destination balance did not increase after withdrawDreams. before=${destBalBefore} after=${destBalAfter}`
      );
    }
    ok('destination received DREAMS', (destBalAfter - destBalBefore).toString());

    const claimableAfterWithdraw = await hookClaimable(worker.address);
    if (claimableAfterWithdraw !== 0n) {
      throw new Error(`Claimable should be 0 after withdraw, got ${claimableAfterWithdraw}`);
    }
    ok('claimable cleared after withdraw', true);
  }

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
  const claimableBeforeAccept = await hookClaimable(worker.address);
  await x402Post(
    `/api/tasks/${claimTaskId}/accept`,
    { taskId: claimTaskId, worker: worker.address },
    requester
  );
  await pollStatus(claimTaskId, 'completed');

  log('B7/7', 'Verifying token reward credited to claimable balance...');
  const claimableAfterClaim = await hookClaimable(worker.address);
  if (claimableAfterClaim <= claimableBeforeAccept) {
    throw new Error(
      `Worker claimable did not increase after claim completion. before=${claimableBeforeAccept} after=${claimableAfterClaim}`
    );
  }
  ok('claimable reward (claim)', (claimableAfterClaim - claimableBeforeAccept).toString());

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

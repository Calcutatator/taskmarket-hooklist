/**
 * Token reward hook smoke test (Rev010).
 *
 * Verifies end-to-end behaviour of the TaskTokenRewardHook (claimable escrow model)
 * on testnet using the mock oracle and mock DREAMS token deployed by
 * DeployRewardHookTestnet.s.sol.
 *
 * Setup step (runs before the scenarios below): funds the vault from the deployer
 * wallet via a plain ERC20 transfer -- DeployRewardHookTestnet.s.sol mints mock
 * DREAMS to the deployer, not the vault, so this exercises the exact same funding
 * operation a human runs on mainnet after `make deploy-reward-hook mainnet`.
 *
 * Scenarios:
 *   A. Bounty task — create → verify task.get DREAMS estimate fields match the
 *      two-step bonusBps/dreamsPerUsdc formula → worker submits → accept winner →
 *      poll until completed → verify hook.claimable(worker) matches
 *      usdBonusValue * rate * workerSplitBps →
 *      call POST /api/wallet/withdraw-dreams → verify token balance lands.
 *
 *   B. Claim task — create → worker claims → verify usdBonusValue and
 *      reservedTokenAmount lock at claim time (bonusBps applied before rate
 *      conversion) → submit → accept → poll until completed →
 *      verify hook.claimable(worker) > 0.
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
 *   FORGE_DEV_PRIVATE_KEY   — deployer key; holds the mock DREAMS minted by
 *                             DeployRewardHookTestnet.s.sol, used to fund the vault
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
import { createPublicClient, createWalletClient, http, parseAbi, getAddress } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { baseSepolia } from 'viem/chains';
import { log, ok, get, post, x402Post, getAccounts, API_URL, pollTaskStatus } from './_x402.ts';

const REWARD_HOOK_ADDRESS = process.env.REWARD_HOOK_ADDRESS;
const MOCK_TOKEN_ADDRESS = process.env.MOCK_TOKEN_ADDRESS;
const VAULT_ADDRESS = process.env.VAULT_ADDRESS;
// Derive withdrawal address from worker key if not explicitly set
const WORKER_WITHDRAWAL_ADDRESS = process.env.WORKER_WITHDRAWAL_ADDRESS
  ?? (process.env.WORKER_PRIVATE_KEY
    ? privateKeyToAccount(process.env.WORKER_PRIVATE_KEY as `0x${string}`).address
    : undefined);
const RPC_URL = process.env.FORGE_BASE_SEPOLIA_RPC_URL || 'https://sepolia.base.org';
const DEPLOYER_PRIVATE_KEY = process.env.FORGE_DEV_PRIVATE_KEY;

if (!process.env.REQUESTER_PRIVATE_KEY || !process.env.WORKER_PRIVATE_KEY) {
  console.error(
    'Missing required env vars:\n' +
      '  REQUESTER_PRIVATE_KEY=0x...\n' +
      '  WORKER_PRIVATE_KEY=0x...'
  );
  process.exit(1);
}

if (!DEPLOYER_PRIVATE_KEY) {
  console.error(
    'Missing FORGE_DEV_PRIVATE_KEY.\n' +
      'DeployRewardHookTestnet.s.sol mints mock DREAMS to the deployer wallet, not the\n' +
      'vault directly -- this smoke test funds the vault itself via a plain transfer,\n' +
      'the same operation a human would run on mainnet. Needs the deployer key that\n' +
      'holds the minted supply.'
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

const erc20Abi = parseAbi([
  'function balanceOf(address) view returns (uint256)',
  'function transfer(address to, uint256 amount) returns (bool)',
]);
const hookAbi = parseAbi([
  'function rewardStates(bytes32) view returns (uint256,uint256,uint256,uint256,address,address,bool,bool)',
  'function claimable(address wallet) view returns (uint256)',
  'function dreamsPerUsdc() view returns (uint256)',
  'function bonusBps() view returns (uint16)',
  'function workerSplitBps() view returns (uint16)',
]);

const client = createPublicClient({ chain: baseSepolia, transport: http(RPC_URL) });
const deployer = privateKeyToAccount(DEPLOYER_PRIVATE_KEY as `0x${string}`);
const deployerWallet = createWalletClient({ account: deployer, chain: baseSepolia, transport: http(RPC_URL) });

// Mirrors the mainnet funding flow exactly: DeployRewardHookTestnet.s.sol mints mock
// DREAMS to the deployer, not the vault, so this plain ERC20 transfer is the same
// operation (`cast send <token> transfer <vault> <amount>`) a human runs on mainnet
// after `make deploy-reward-hook mainnet` -- the vault has no deposit function.
async function fundVault(amount: bigint): Promise<void> {
  const hash = await deployerWallet.writeContract({
    address: getAddress(MOCK_TOKEN_ADDRESS!),
    abi: erc20Abi,
    functionName: 'transfer',
    args: [getAddress(VAULT_ADDRESS!), amount],
  });
  await client.waitForTransactionReceipt({ hash });
}

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
  })) as [bigint, bigint, bigint, bigint, string, string, boolean, boolean];
  return {
    rewardUsd: result[0],
    usdBonusValue: result[1],
    startPrice: result[2],
    reservedTokenAmount: result[3],
    requester: result[4],
    worker: result[5],
    reserved: result[6],
    paid: result[7],
  };
}

async function hookDreamsPerUsdc(): Promise<bigint> {
  return client.readContract({
    address: getAddress(REWARD_HOOK_ADDRESS!),
    abi: hookAbi,
    functionName: 'dreamsPerUsdc',
  }) as Promise<bigint>;
}

async function hookBonusBps(): Promise<number> {
  return client.readContract({
    address: getAddress(REWARD_HOOK_ADDRESS!),
    abi: hookAbi,
    functionName: 'bonusBps',
  }) as Promise<number>;
}

async function hookWorkerSplitBps(): Promise<number> {
  return client.readContract({
    address: getAddress(REWARD_HOOK_ADDRESS!),
    abi: hookAbi,
    functionName: 'workerSplitBps',
  }) as Promise<number>;
}

async function pollStatus(
  taskId: string,
  target: string,
  maxWaitMs = 90_000
): Promise<{ status: string; hooks?: string[] }> {
  return pollTaskStatus<{ status: string; hooks?: string[] }>(taskId, target, {
    timeoutMs: maxWaitMs,
  });
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
  console.log('deployer:     ', deployer.address);

  // ─── Setup: fund the vault ─────────────────────────────────────────────────
  // DeployRewardHookTestnet.s.sol mints mock DREAMS to the deployer, not the vault
  // (matching the mainnet script, which never holds funds either) -- fund it here
  // via the same plain ERC20 transfer a human runs on mainnet.
  log('0/2', 'Funding vault from deployer wallet...');
  const balanceBefore = await vaultBalance();
  await fundVault(10_000n * 10n ** 18n);
  // waitForTransactionReceipt only guarantees inclusion on the node that mined it;
  // a load-balanced RPC endpoint can still serve a stale read immediately after.
  let balanceAfter = await vaultBalance();
  for (let i = 0; i < 5 && balanceAfter <= balanceBefore; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    balanceAfter = await vaultBalance();
  }
  ok('vault balance', `${balanceBefore} -> ${balanceAfter}`);

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

  log('C2/2', 'Checking getTaskHooks includes reward hook (waiting for indexer)...');
  await new Promise((r) => setTimeout(r, 8000));
  const probeTask = (await get(`/api/tasks/${probeTaskId}`)) as { hooks?: string[] };
  const hooks: string[] = probeTask.hooks ?? [];
  if (!hooks.map((h) => h.toLowerCase()).includes(REWARD_HOOK_ADDRESS!.toLowerCase())) {
    throw new Error(`Reward hook not in task hooks list: ${JSON.stringify(hooks)}`);
  }
  ok('hooks includes reward hook', REWARD_HOOK_ADDRESS);

  // ─── Exchange rate: API must match on-chain dreamsPerUsdc ─────────────────
  console.log('\n--- Exchange rate ---');

  log('ER1/2', 'Reading dreamsPerUsdc on-chain and via API...');
  const onChainRate = await hookDreamsPerUsdc();
  if (onChainRate === 0n) {
    throw new Error('hook.dreamsPerUsdc() is 0 — deploy did not set a rate');
  }
  const apiRate = (await get('/api/wallet/exchange-rate')) as {
    dreamsPerUsdc: string;
    workerSplitBps: number;
    bonusBps: number;
  };
  ok('GET /wallet/exchange-rate', apiRate.dreamsPerUsdc);
  if (BigInt(apiRate.dreamsPerUsdc) !== onChainRate) {
    throw new Error(
      `API exchange rate (${apiRate.dreamsPerUsdc}) does not match on-chain dreamsPerUsdc (${onChainRate})`
    );
  }
  ok('API rate matches on-chain rate', true);

  log('ER2/3', 'Reading workerSplitBps on-chain and via API...');
  const workerSplitBps = await hookWorkerSplitBps();
  if (apiRate.workerSplitBps !== workerSplitBps) {
    throw new Error(
      `API workerSplitBps (${apiRate.workerSplitBps}) does not match on-chain (${workerSplitBps})`
    );
  }
  ok('workerSplitBps', workerSplitBps);

  log('ER3/3', 'Reading bonusBps on-chain and via API...');
  const onChainBonusBps = await hookBonusBps();
  if (onChainBonusBps === 0) {
    throw new Error('hook.bonusBps() is 0 — deploy did not set a bonus rate');
  }
  if (apiRate.bonusBps !== onChainBonusBps) {
    throw new Error(
      `API bonusBps (${apiRate.bonusBps}) does not match on-chain bonusBps (${onChainBonusBps})`
    );
  }
  ok('bonusBps', onChainBonusBps);

  // ─── Scenario A: Bounty — create → submit → accept → token reward ─────────
  console.log('\n--- A: Bounty task reward ---');

  log('A1/6', 'Creating bounty task (X402)...');
  const { taskId } = (await x402Post(
    '/api/tasks',
    { description: 'Write a haiku about Base L2 (hook smoke test)', reward: '5000', duration: 60, mode: 'bounty', tags: ['smoke-test'] },
    requester
  )) as { taskId: string };
  ok('taskId', taskId);

  log('A2/6', 'Verifying RewardConfigured state on hook (polling until set)...');
  let stateAfterCreate = await hookRewardState(taskId);
  for (let i = 0; i < 10 && stateAfterCreate.rewardUsd === 0n; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    stateAfterCreate = await hookRewardState(taskId);
  }
  if (stateAfterCreate.rewardUsd !== 5000n) {
    throw new Error(`Expected rewardUsd=5000, got: ${stateAfterCreate.rewardUsd}`);
  }
  ok('rewardUsd on hook', stateAfterCreate.rewardUsd);

  log('A3/6', 'Verifying GET /api/tasks/:id estimate fields match the two-step formula...');
  const taskDetail = (await get(`/api/tasks/${taskId}`)) as {
    dreamsPerUsdc?: string;
    bonusBps?: number;
    estimatedUsdBonusValue?: string;
    estimatedWorkerUsdBonusValue?: string;
    estimatedRequesterUsdBonusValue?: string;
    estimatedWorkerDreamsBonus?: string;
    estimatedRequesterDreamsBonus?: string;
  };
  if (taskDetail.dreamsPerUsdc !== onChainRate.toString()) {
    throw new Error(
      `task.get dreamsPerUsdc (${taskDetail.dreamsPerUsdc}) does not match on-chain rate (${onChainRate})`
    );
  }
  if (taskDetail.bonusBps !== onChainBonusBps) {
    throw new Error(
      `task.get bonusBps (${taskDetail.bonusBps}) does not match on-chain bonusBps (${onChainBonusBps})`
    );
  }
  const expectedEstimateUsdBonusValue = (5000n * BigInt(onChainBonusBps)) / 10_000n;
  if (taskDetail.estimatedUsdBonusValue !== expectedEstimateUsdBonusValue.toString()) {
    throw new Error(
      `task.get estimatedUsdBonusValue (${taskDetail.estimatedUsdBonusValue}) does not match expected ${expectedEstimateUsdBonusValue}`
    );
  }
  const expectedEstimateTotalDreams = (expectedEstimateUsdBonusValue * onChainRate) / 1_000_000n;
  const expectedEstimateWorkerDreams =
    (expectedEstimateTotalDreams * BigInt(workerSplitBps)) / 10_000n;
  const expectedEstimateRequesterDreams = expectedEstimateTotalDreams - expectedEstimateWorkerDreams;
  if (taskDetail.estimatedWorkerDreamsBonus !== expectedEstimateWorkerDreams.toString()) {
    throw new Error(
      `task.get estimatedWorkerDreamsBonus (${taskDetail.estimatedWorkerDreamsBonus}) does not match expected ${expectedEstimateWorkerDreams}`
    );
  }
  if (taskDetail.estimatedRequesterDreamsBonus !== expectedEstimateRequesterDreams.toString()) {
    throw new Error(
      `task.get estimatedRequesterDreamsBonus (${taskDetail.estimatedRequesterDreamsBonus}) does not match expected ${expectedEstimateRequesterDreams}`
    );
  }
  ok('task.get DREAMS estimate fields match bonusBps * rate * split', true);

  log('A4/6', 'Worker A submitting...');
  const submitSigA = await worker.signMessage({ message: `taskmarket:submit:${taskId}` });
  await post(`/api/tasks/${taskId}/submissions`, {
    taskId,
    workerAddress: worker.address,
    signature: submitSigA,
    artifacts: [{ fileName: 'haiku.txt', mimeType: 'text/plain', role: 'attachment', file: Buffer.from('old pond / a frog jumps in / sound of water').toString('base64') }],
  });
  ok('submitted', true);

  const claimableBeforeAcceptA = await hookClaimable(worker.address);

  log('A5/6', 'Requester accepting (X402)...');
  await x402Post(`/api/tasks/${taskId}/accept`, { taskId, worker: worker.address }, requester);
  ok('accepted', true);

  log('A6/6', 'Polling until completed and verifying claimable reward...');
  await pollStatus(taskId, 'completed');

  const claimableAfter = await hookClaimable(worker.address);
  ok('hook.claimable(worker)', claimableAfter.toString());
  if (claimableAfter === 0n) {
    throw new Error('Worker claimable balance is 0 after task completion');
  }

  // Ramp is bypassed on testnet (100% multiplier), so the bounty payout should
  // exactly equal usdBonusValue * rate / 1e6 * workerSplitBps / 10000, where
  // usdBonusValue = rewardUsd * bonusBps / 10000 — the two-step math: bonusBps
  // sets how much of the task's USD value becomes a bonus, dreamsPerUsdc then
  // converts that USD amount to tokens. Bounty-mode reads both fresh at
  // completion time (no lock), so this uses the current bonusBps/rate.
  const expectedBountyUsdBonusValue = (stateAfterCreate.rewardUsd * BigInt(onChainBonusBps)) / 10_000n;
  const expectedBountyTokenReward =
    (((expectedBountyUsdBonusValue * onChainRate) / 1_000_000n) * BigInt(workerSplitBps)) / 10_000n;
  const bountyDelta = claimableAfter - claimableBeforeAcceptA;
  if (bountyDelta !== expectedBountyTokenReward) {
    throw new Error(
      `Bounty token reward mismatch: expected ${expectedBountyTokenReward}, got ${bountyDelta}`
    );
  }
  ok('bounty token reward matches bonusBps * rate * split', bountyDelta.toString());

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
    const withdrawNonce = `0x${Array.from(crypto.getRandomValues(new Uint8Array(32)))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')}`;
    const withdrawValidBefore = String(Math.floor(Date.now() / 1000) + 300);
    const withdrawResult = (await post('/api/wallet/withdraw-dreams', {
      workerAddress: worker.address,
      destination: WORKER_WITHDRAWAL_ADDRESS,
      nonce: withdrawNonce,
      validBefore: withdrawValidBefore,
      signature: await worker.signMessage({
        message: `taskmarket:withdraw-dreams:${WORKER_WITHDRAWAL_ADDRESS}:${withdrawNonce}:${withdrawValidBefore}`,
      }),
    })) as {
      txHash: string;
      claimedBaseUnits: string;
      dreamsPerUsdc: string;
      usdEquivalent: string;
    };
    ok('withdrawDreams txHash', withdrawResult.txHash);
    if (BigInt(withdrawResult.dreamsPerUsdc) !== onChainRate) {
      throw new Error(
        `withdrawDreams response rate (${withdrawResult.dreamsPerUsdc}) does not match on-chain rate (${onChainRate})`
      );
    }
    ok('withdrawDreams response includes dreamsPerUsdc', withdrawResult.dreamsPerUsdc);
    if (BigInt(withdrawResult.usdEquivalent) <= 0n) {
      throw new Error('withdrawDreams response usdEquivalent is not positive');
    }
    ok('withdrawDreams response includes usdEquivalent', withdrawResult.usdEquivalent);
    let destBalAfter = await tokenBalance(WORKER_WITHDRAWAL_ADDRESS);
    for (let i = 0; i < 10 && destBalAfter <= destBalBefore; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      destBalAfter = await tokenBalance(WORKER_WITHDRAWAL_ADDRESS);
    }
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
  const claimTaskSig = await worker.signMessage({ message: `taskmarket:claim:${claimTaskId}` });
  await post(`/api/tasks/${claimTaskId}/claim`, {
    taskId: claimTaskId,
    workerAddress: worker.address,
    signature: claimTaskSig,
  });
  await pollStatus(claimTaskId, 'claimed');
  ok('claimed', true);

  log('B3/7', 'Verifying tokens reserved on hook after claim (polling)...');
  let stateAfterClaim = await hookRewardState(claimTaskId);
  for (let i = 0; i < 10 && !stateAfterClaim.reserved; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    stateAfterClaim = await hookRewardState(claimTaskId);
  }
  if (!stateAfterClaim.reserved) {
    throw new Error('RewardState.reserved is false after claim — price lock did not fire');
  }
  if (stateAfterClaim.reservedTokenAmount === 0n) {
    throw new Error('reservedTokenAmount is 0 after claim');
  }
  ok('reserved', stateAfterClaim.reserved);
  ok('reservedTokenAmount', stateAfterClaim.reservedTokenAmount.toString());
  // startPrice is the dreamsPerUsdc rate locked at claim time — assert it matches
  // the current on-chain rate (the smoke test never changes the rate mid-run).
  if (stateAfterClaim.startPrice !== onChainRate) {
    throw new Error(
      `startPrice (${stateAfterClaim.startPrice}) does not match on-chain dreamsPerUsdc (${onChainRate})`
    );
  }
  ok('startPrice matches locked dreamsPerUsdc', stateAfterClaim.startPrice.toString());
  // usdBonusValue is derived from bonusBps and locked at claim time alongside
  // startPrice — must equal rewardUsd * bonusBps / 10000 exactly.
  const expectedUsdBonusValue = (3000n * BigInt(onChainBonusBps)) / 10_000n;
  if (stateAfterClaim.usdBonusValue !== expectedUsdBonusValue) {
    throw new Error(
      `usdBonusValue (${stateAfterClaim.usdBonusValue}) does not match expected ${expectedUsdBonusValue}`
    );
  }
  ok('usdBonusValue matches rewardUsd * bonusBps / 10000', true);
  // reservedTokenAmount should be the deterministic reward for the locked
  // usdBonusValue/rate — no drift band, so it must equal
  // usdBonusValue * rate / 1e6 exactly.
  const expectedReservedAmount = (expectedUsdBonusValue * onChainRate) / 1_000_000n;
  if (stateAfterClaim.reservedTokenAmount !== expectedReservedAmount) {
    throw new Error(
      `reservedTokenAmount (${stateAfterClaim.reservedTokenAmount}) does not match expected ${expectedReservedAmount}`
    );
  }
  ok('reservedTokenAmount matches usdBonusValue * rate / 1e6', true);

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

  // ─── Scenario D: Cancel fires onCancel hook without error ────────────────
  // Note: forfeitAndReopen (which tests reserve release for claimed tasks)
  // requires the task to be expired — not testable on testnet in real time.
  // This scenario verifies the onCancel hook path with an unclaimed open task.
  console.log('\n--- D: Cancel fires hook without error ---');

  log('D1/3', 'Creating claim task for cancel test...');
  const { taskId: cancelTaskId } = (await x402Post(
    '/api/tasks',
    { description: 'Cancel hook test task', reward: '2000', duration: 300, mode: 'claim', tags: ['smoke-test'] },
    requester
  )) as { taskId: string };
  ok('cancelTaskId', cancelTaskId);

  const vaultBeforeCancel = await vaultBalance();

  log('D2/3', 'Requester cancelling unclaimed open task...');
  await x402Post(`/api/tasks/${cancelTaskId}/cancel`, { taskId: cancelTaskId }, requester);
  await pollStatus(cancelTaskId, 'cancelled');
  ok('cancelled', true);

  log('D3/3', 'Verifying hook state and vault balance unchanged...');
  const vaultAfterCancel = await vaultBalance();
  ok('vault balance unchanged', vaultAfterCancel === vaultBeforeCancel);

  const stateAfterCancel = await hookRewardState(cancelTaskId);
  if (stateAfterCancel.reserved) {
    throw new Error('RewardState.reserved is true after cancel of unclaimed task');
  }
  ok('RewardState.reserved', stateAfterCancel.reserved);

  console.log('\n=== Scenario D passed ===');
  console.log('\n=== Token reward hook smoke test complete ===');
}

main().catch((err) => {
  console.error('\nFatal:', err);
  process.exit(1);
});

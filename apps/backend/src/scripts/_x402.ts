/**
 * Shared helpers for smoke test scripts.
 */
import { randomBytes, randomUUID } from 'crypto';
import { privateKeyToAccount } from 'viem/accounts';
import { createPublicClient, createWalletClient, http, parseAbi, toHex, type Chain } from 'viem';
import { anvil, baseSepolia } from 'viem/chains';
import {
  buildDeviceRegisterMessage,
  buildReadAuthMessage,
  IDEMPOTENCY_KEY_HEADER,
} from '@taskmarket/shared';

export type Account = ReturnType<typeof privateKeyToAccount>;

/** Fresh ephemeral keypair, for smoke tests that need a throwaway agent identity. */
export function randomAccount(): Account {
  return privateKeyToAccount(`0x${randomBytes(32).toString('hex')}`);
}

// TASKMARKET_API_URL is the same var apps/cli/src/lib/api.ts reads -- one var
// for both the CLI and smoke tests, rather than keeping two in sync. API_URL
// stays as a fallback for anyone already using it directly.
export const API_URL =
  process.env.TASKMARKET_API_URL || process.env.API_URL || 'http://localhost:3000';

export function log(step: string, msg: string) {
  console.log(`\n[${step}] ${msg}`);
}

export function ok(label: string, value: unknown) {
  console.log(`  ✓ ${label}:`, value);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Anvil's instant-mining mode only advances block.timestamp on a real mined transaction,
// so it stays frozen on a quiescent chain regardless of wall-clock sleeps. The relay
// path's read-only simulateContract pre-check (services/contract.ts) evaluates against
// that frozen timestamp, so a time-gated call (bid deadline, appeal window) can revert
// forever even once the deadline has genuinely passed. Force-mining an empty block syncs
// the timestamp to now before such a call. Anvil/Hardhat-only RPC method -- no-ops
// against a real chain with ambient block production, where this is never needed.
export async function nudgeChainForward(): Promise<void> {
  const rpcUrl = process.env.BASE_RPC_URL || 'http://127.0.0.1:8545';
  try {
    await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'evm_mine', params: [] }),
    });
  } catch {
    // Best-effort only.
  }
}

export function fail(step: string, status: number, body: string): never {
  // Parse body to extract message for a cleaner error string.
  let message = body;
  try {
    const parsed = JSON.parse(body) as { message?: string };
    if (parsed.message) message = parsed.message;
  } catch {
    // leave message as raw body
  }
  throw new Error(`${step} failed (HTTP ${status}): ${message}`);
}

/** GET with optional headers. */
export async function get(
  path: string,
  options?: { headers?: Record<string, string> }
): Promise<unknown> {
  const r = await fetch(`${API_URL}${path}`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(options?.headers ?? {}),
    },
  });
  const result = await r.json();
  if (!r.ok) fail(path, r.status, JSON.stringify(result, null, 2));
  return result;
}

/** Poll an arbitrary value until predicate passes, or throw on timeout. */
export async function pollUntil<T>(
  fetchValue: () => Promise<T>,
  predicate: (value: T) => boolean,
  options?: { intervalMs?: number; timeoutMs?: number; label?: string }
): Promise<T> {
  const intervalMs = options?.intervalMs ?? 3000;
  const timeoutMs = options?.timeoutMs ?? 60_000;
  const label = options?.label ?? 'condition';
  const deadline = Date.now() + timeoutMs;
  let lastValue: T | undefined;
  while (Date.now() < deadline) {
    lastValue = await fetchValue();
    if (predicate(lastValue)) return lastValue;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`Timed out waiting for ${label}, last seen: ${JSON.stringify(lastValue)}`);
}

/** Poll GET /api/tasks/:id until predicate passes, or throw on timeout. */
export async function pollTask<T>(
  taskId: string,
  predicate: (task: T) => boolean,
  label: string,
  options?: { intervalMs?: number; timeoutMs?: number }
): Promise<T> {
  return pollUntil(() => get(`/api/tasks/${taskId}`) as Promise<T>, predicate, {
    ...options,
    label,
  });
}

/** Poll GET /api/tasks/:id until task.status reaches one of the target statuses. */
export async function pollTaskStatus<T extends { status: string }>(
  taskId: string,
  target: string | string[],
  options?: { intervalMs?: number; timeoutMs?: number }
): Promise<T> {
  const targets = Array.isArray(target) ? target : [target];
  return pollTask<T>(
    taskId,
    (task) => targets.includes(task.status),
    `task ${taskId} to reach status [${targets.join('|')}]`,
    options
  );
}

/**
 * A fresh idempotency key for one logical operation (ADR-0052).
 *
 * Every relayed write requires one, so the smoke helpers mint one per call. A smoke script
 * genuinely retrying the same operation must hold onto its key and pass it explicitly --
 * a new key means a new operation, which is exactly what these one-shot calls want.
 */
export function newIdempotencyKey(): string {
  return randomUUID();
}

function writeHeaders(idempotencyKey?: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    [IDEMPOTENCY_KEY_HEADER]: idempotencyKey ?? newIdempotencyKey(),
  };
}

/** POST without X402. */
export async function post(
  path: string,
  body: Record<string, unknown>,
  options?: { idempotencyKey?: string }
): Promise<unknown> {
  const r = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    headers: writeHeaders(options?.idempotencyKey),
    body: JSON.stringify(body),
  });
  const result = await r.json();
  if (!r.ok) fail(path, r.status, JSON.stringify(result, null, 2));
  return result;
}

/** POST with full X402 dance — gets 402, signs EIP-712, retries. */
export async function x402Post(
  path: string,
  body: Record<string, unknown>,
  account: Account,
  options?: { idempotencyKey?: string }
): Promise<unknown> {
  const url = `${API_URL}${path}`;

  // One key for both rounds: the 402 challenge and the paid retry are one logical
  // operation, and only the second one records an intent.
  const idempotencyKey = options?.idempotencyKey ?? newIdempotencyKey();

  // Round 1: get payment requirements
  const r1 = await fetch(url, {
    method: 'POST',
    headers: writeHeaders(idempotencyKey),
    body: JSON.stringify(body),
  });

  if (r1.status !== 402) fail(path, r1.status, await r1.text());

  const requirements = (await r1.json()) as {
    resource: unknown;
    accepts: {
      scheme: string;
      network: string;
      amount: string;
      asset: string;
      payTo: string;
      maxTimeoutSeconds: number;
      extra: {
        eip712: {
          domain: Record<string, unknown>;
          types: Record<string, unknown>;
          primaryType: string;
        };
      };
    }[];
  };

  const accept = requirements.accepts[0];
  ok('amount', `${Number(accept.amount) / 1e6} USDC`);

  const now = Math.floor(Date.now() / 1000);
  const authorization = {
    from: account.address,
    to: accept.payTo,
    value: accept.amount,
    validAfter: String(now - 60),
    validBefore: String(now + accept.maxTimeoutSeconds),
    nonce: toHex(crypto.getRandomValues(new Uint8Array(32))),
  };

  const sig = await account.signTypedData({
    domain: accept.extra.eip712.domain,
    types: accept.extra.eip712.types as Parameters<typeof account.signTypedData>[0]['types'],
    primaryType: accept.extra.eip712.primaryType,
    message: authorization,
  });
  ok('signed by', account.address);

  const paymentPayload = {
    x402Version: 2,
    resource: requirements.resource,
    accepted: {
      scheme: accept.scheme,
      network: accept.network,
      amount: accept.amount,
      asset: accept.asset,
      payTo: accept.payTo,
      maxTimeoutSeconds: accept.maxTimeoutSeconds,
      extra: accept.extra,
    },
    payload: { authorization, signature: sig },
  };

  // Round 2: retry with payment
  const r2 = await fetch(url, {
    method: 'POST',
    headers: {
      ...writeHeaders(idempotencyKey),
      'PAYMENT-SIGNATURE': Buffer.from(JSON.stringify(paymentPayload)).toString('base64'),
    },
    body: JSON.stringify(body),
  });

  const result = await r2.json();
  if (!r2.ok) fail(path, r2.status, JSON.stringify(result, null, 2));
  return result;
}

/** Register a device for `account`, signing the required ownership-proof challenge. */
export async function registerDevice(
  account: Account
): Promise<{ deviceId: string; apiToken: string }> {
  const signature = await account.signMessage({
    message: buildDeviceRegisterMessage(account.address),
  });
  return (await post('/api/devices', { walletAddress: account.address, signature })) as {
    deviceId: string;
    apiToken: string;
  };
}

const MOCK_USDC_ABI = parseAbi(['function mint(address to, uint256 amount) external']);

const USDC_BALANCE_ABI = parseAbi(['function balanceOf(address) view returns (uint256)']);

/**
 * USDC balance of `address`, read straight from the token.
 *
 * Escrow in this system is one pooled balance held by the Diamond across every task, so the
 * only way to state "this task's money did not move" is to read the pool itself. A smoke test
 * asserting a refund happened once cannot do it from task status alone -- status is set by the
 * indexer, and the defect ADR-0054 fixes was a second payout leaving status exactly where it
 * already was while the pool went down twice.
 */
export async function usdcBalanceOf(address: string): Promise<bigint> {
  const rpcUrl = process.env.BASE_RPC_URL ?? 'http://127.0.0.1:8545';
  const chainId = parseInt(process.env.CHAIN_ID ?? '84532', 10);
  const chain: Chain = chainId === 31337 ? anvil : baseSepolia;
  const usdc = process.env.USDC_TOKEN_ADDRESS;
  if (!usdc) {
    throw new Error('USDC_TOKEN_ADDRESS is required to read a USDC balance');
  }
  const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
  return publicClient.readContract({
    address: usdc as `0x${string}`,
    abi: USDC_BALANCE_ABI,
    functionName: 'balanceOf',
    args: [address as `0x${string}`],
  });
}

/**
 * Mints mock USDC directly to `recipient` -- MockUSDC.mint is permissionless (see
 * MockUSDC.sol), the same fact cloud-env-setup.sh relies on to fund the
 * requester/worker/etc. accounts. Useful for any smoke test that needs to hand USDC
 * to a throwaway randomAccount() before it can pass through an X402-gated endpoint --
 * without it, settlement fails with "insufficient_funds" before the endpoint's own
 * logic (e.g. an authorization check) is ever reached. `payer` only needs ETH for gas
 * (any of the pre-funded smoke-test accounts), not USDC of its own.
 */
export async function fundWithUsdc(
  payer: Account,
  recipient: string,
  amount: bigint
): Promise<void> {
  const rpcUrl = process.env.BASE_RPC_URL ?? 'http://127.0.0.1:8545';
  const chainId = parseInt(process.env.CHAIN_ID ?? '84532', 10);
  const chain: Chain = chainId === 31337 ? anvil : baseSepolia;
  const usdc = process.env.USDC_TOKEN_ADDRESS;
  if (!usdc) {
    throw new Error('USDC_TOKEN_ADDRESS is required to fund an account with mock USDC');
  }

  const walletClient = createWalletClient({ account: payer, chain, transport: http(rpcUrl) });
  const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
  const hash = await walletClient.writeContract({
    address: usdc as `0x${string}`,
    abi: MOCK_USDC_ABI,
    functionName: 'mint',
    args: [recipient as `0x${string}`, amount],
  });
  await publicClient.waitForTransactionReceipt({ hash });
}

/**
 * The general read-auth headers (ADR-0016/ADR-0022): signs
 * taskmarket:read:<address> and returns it as the X-Taskmarket-Caller-*
 * headers `get()`/context.ts's resolveCaller expect. Used by any smoke test
 * exercising a ctx.caller-gated read (agents.inbox, bids.myBids,
 * submission-visibility, task-visibility).
 */
export async function readAuthHeaders(account: Account): Promise<Record<string, string>> {
  const signature = await account.signMessage({
    message: buildReadAuthMessage(account.address),
  });
  return {
    'X-Taskmarket-Caller-Address': account.address,
    'X-Taskmarket-Caller-Signature': signature,
  };
}

export function getAccounts() {
  const devKey = process.env.DEV_PRIVATE_KEY as `0x${string}`;
  const requesterKey = (process.env.REQUESTER_PRIVATE_KEY ?? devKey) as `0x${string}`;
  const workerKey = (process.env.WORKER_PRIVATE_KEY ?? devKey) as `0x${string}`;

  if (!requesterKey) {
    console.error('Set REQUESTER_PRIVATE_KEY or DEV_PRIVATE_KEY');
    process.exit(1);
  }
  if (!workerKey) {
    console.error('Set WORKER_PRIVATE_KEY or DEV_PRIVATE_KEY');
    process.exit(1);
  }

  return {
    requester: privateKeyToAccount(requesterKey),
    worker: privateKeyToAccount(workerKey),
  };
}

// -----------------------------------------------------------------------------
// Minimum appeal window (rev017)
// -----------------------------------------------------------------------------

const adminAppealWindowAbi = parseAbi([
  'function minAppealWindowSecs() view returns (uint32)',
  'function setMinAppealWindowSecs(uint32 newMinimum)',
]);

export type AppealWindowOverride = {
  /** The floor actually in force for this run. Size appeal windows and sleeps from this. */
  effectiveSecs: number;
  /** True if this process lowered the floor and therefore owes a restore. */
  lowered: boolean;
  /** Human-readable explanation, printed by the caller either way. */
  reason: string;
  /** Idempotent, and safe to call in a `finally` even when nothing was lowered. */
  restore: () => Promise<void>;
};

function firstLine(err: unknown): string {
  return String(err instanceof Error ? err.message : err).split('\n')[0];
}

/**
 * Temporarily lower the protocol-wide minimum appeal window (rev017) so a smoke test can use a
 * short window instead of waiting out the production floor.
 *
 * MUTATES PROTOCOL CONFIGURATION. `setMinAppealWindowSecs` is `onlyOwner` and checks
 * `msg.sender` directly -- there is no forwarder path -- so this needs the diamond owner's key
 * (`UPGRADE_OWNER_KEY` or `FORGE_DEV_PRIVATE_KEY`, the same pair smoke-upgrade.ts uses), and
 * that account must hold ETH for gas. Every other smoke-test key only ever signs off-chain,
 * which is why this is the one helper here that sends a transaction of its own.
 *
 * Callers must restore in a `finally`, not on the happy path: a run that throws partway and
 * leaves the floor lowered hands the next run a weakened guard with nothing to signal it.
 */
export async function lowerMinAppealWindow(desiredSecs: number): Promise<AppealWindowOverride> {
  const address = process.env.CONTRACT_ADDRESS as `0x${string}` | undefined;
  const rpcUrl = process.env.BASE_RPC_URL ?? 'http://127.0.0.1:8545';
  const chainId = parseInt(process.env.CHAIN_ID ?? '84532', 10);
  const chain: Chain = chainId === 31337 ? anvil : baseSepolia;
  const noop = async () => {};

  if (!address) {
    return {
      effectiveSecs: desiredSecs,
      lowered: false,
      reason: 'CONTRACT_ADDRESS is not set -- cannot read or set the floor',
      restore: noop,
    };
  }

  const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
  const readFloor = async (): Promise<number> =>
    Number(
      await publicClient.readContract({
        address,
        abi: adminAppealWindowAbi,
        functionName: 'minAppealWindowSecs',
      })
    );

  let currentSecs: number;
  try {
    currentSecs = await readFloor();
  } catch (err) {
    // A pre-rev017 diamond does not route this selector at all. That is not a failure: such a
    // chain enforces no floor, so the caller's short window is already legal there.
    return {
      effectiveSecs: desiredSecs,
      lowered: false,
      reason: `minAppealWindowSecs is not readable (${firstLine(err)}) -- pre-rev017 diamond, no floor enforced`,
      restore: noop,
    };
  }

  if (currentSecs <= desiredSecs) {
    return {
      effectiveSecs: currentSecs,
      lowered: false,
      reason: `on-chain floor is already ${currentSecs}s, at or below the ${desiredSecs}s this run needs`,
      restore: noop,
    };
  }

  const ownerKey = (process.env.UPGRADE_OWNER_KEY ?? process.env.FORGE_DEV_PRIVATE_KEY) as
    | `0x${string}`
    | undefined;
  if (!ownerKey) {
    return {
      effectiveSecs: currentSecs,
      lowered: false,
      reason:
        'no diamond-owner key available -- set UPGRADE_OWNER_KEY or FORGE_DEV_PRIVATE_KEY to the ' +
        'account that deployed the diamond (cloud-env-setup.sh already exports it locally)',
      restore: noop,
    };
  }

  const ownerWallet = createWalletClient({
    account: privateKeyToAccount(ownerKey),
    chain,
    transport: http(rpcUrl),
  });
  const write = async (secs: number): Promise<void> => {
    const hash = await ownerWallet.writeContract({
      address,
      abi: adminAppealWindowAbi,
      functionName: 'setMinAppealWindowSecs',
      args: [secs],
    });
    await publicClient.waitForTransactionReceipt({ hash });
  };

  try {
    await write(desiredSecs);
  } catch (err) {
    return {
      effectiveSecs: currentSecs,
      lowered: false,
      reason: `setMinAppealWindowSecs reverted (${firstLine(err)}) -- the key is probably not the diamond owner`,
      restore: noop,
    };
  }

  let restored = false;
  return {
    effectiveSecs: desiredSecs,
    lowered: true,
    reason: `lowered ${currentSecs}s -> ${desiredSecs}s for this run`,
    restore: async () => {
      if (restored) return;
      restored = true;
      await write(currentSecs);
      // Verify rather than assume. A restore that silently failed leaves the protocol floor
      // weakened for everyone else on a shared chain -- exactly the state nobody would think
      // to go looking for.
      const after = await readFloor();
      if (after !== currentSecs) {
        throw new Error(
          `FAILED TO RESTORE minAppealWindowSecs: expected ${currentSecs}s, chain reports ${after}s. ` +
            'The protocol floor is left weakened -- restore it manually.'
        );
      }
      console.log(`  [appeal-window] restored minAppealWindowSecs to ${currentSecs}s`);
    },
  };
}

/**
 * As lowerMinAppealWindow, but for scripts whose runtime is dominated by waiting out the appeal
 * window. If the floor could not be lowered, this SKIPS the run loudly and exits rather than
 * silently proceeding against a floor that would make the script take many minutes.
 *
 * The skip is deliberately noisy, and exits non-zero. A silently skipped check reads as a pass,
 * which is the worse failure -- the same argument smoke-nonce.ts makes about its own fault
 * injection. Set SMOKE_APPEAL_WINDOW_SLOW=1 to run anyway against the real floor; that path
 * tests strictly more, it is only slow, so it is the right choice when you have the time.
 */
export async function requireShortAppealWindow(desiredSecs: number): Promise<AppealWindowOverride> {
  const override = await lowerMinAppealWindow(desiredSecs);
  if (override.lowered || override.effectiveSecs <= desiredSecs) {
    console.log(`  [appeal-window] ${override.reason}`);
    return override;
  }

  if (process.env.SMOKE_APPEAL_WINDOW_SLOW === '1') {
    console.warn(
      `\n!!! [appeal-window] could not lower the floor: ${override.reason}\n` +
        `!!! SMOKE_APPEAL_WINDOW_SLOW=1 -- running against the real ${override.effectiveSecs}s floor.\n` +
        '!!! Every appeal-window wait in this run will take that long.\n'
    );
    return override;
  }

  const rule = '='.repeat(72);
  console.error(
    `\n${rule}\nSKIPPED -- this smoke test did NOT run. Nothing was verified.\n${rule}\n` +
      `Reason: ${override.reason}.\n` +
      `The on-chain minimum appeal window is ${override.effectiveSecs}s, but this test needs ` +
      `${desiredSecs}s to\nfinish in reasonable time, and lowering it needs the diamond owner's key.\n\n` +
      'Fix by either:\n' +
      '  - setting UPGRADE_OWNER_KEY (or FORGE_DEV_PRIVATE_KEY) to the diamond owner, or\n' +
      '  - setting SMOKE_APPEAL_WINDOW_SLOW=1 to run against the real floor (correct, but slow).\n' +
      `${rule}\n`
  );
  process.exit(1);
}

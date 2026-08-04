/**
 * Server-wallet nonce management smoke test (ADR-0040).
 *
 * Regression coverage for daydreamsai/skills-market#54: a deterministic pre-broadcast
 * failure advanced viem's cached nonce without sending a transaction, so every later
 * relayer transaction queued behind the resulting gap until the backend restarted.
 *
 * Unlike smoke-withdraw.ts, which exercises the incident's user-facing path, this test
 * asserts against the durable allocator itself. It needs both the API and the backend's
 * database, so run it in the sandbox (or any environment where DATABASE_URL points at the
 * same Postgres the backend uses):
 *
 *   make smoke nonce
 *
 * What it covers:
 *   1. The migration is applied and re-applying it is a genuine no-op (idempotency).
 *   2. A deterministic preflight failure allocates no nonce and writes no outbox row.
 *   3. The very next transaction succeeds -- no restart, which is the #54 regression.
 *   4. Concurrent relayed writes take distinct, contiguous nonces rather than serializing.
 *   5. A deliberately stranded nonce is cleared by the reconciler with no operator restart.
 *      This runs automatically against a loopback RPC (the sandbox and local dev), because it
 *      broadcasts a transaction that is intentionally stuck and strands a nonce on purpose.
 *      Set SMOKE_NONCE_FAULT=1 to force it on elsewhere, or 0 to force it off.
 *   6. The allocator agrees with the chain afterwards, with nothing stranded mid-flight.
 *
 * Without DATABASE_URL the allocator assertions are skipped and the API-level behavior is
 * still checked, so the test degrades usefully against a remote deployment.
 *
 * MUTATES PROTOCOL CONFIGURATION. Its finalizable tasks need an appeal window short enough to
 * wait out, and rev017 enforces a protocol-wide floor on that window (300s by default), so this
 * lowers the floor for the duration of the run and restores it in a `finally`, including when
 * the run throws. That needs the diamond owner's key (UPGRADE_OWNER_KEY or
 * FORGE_DEV_PRIVATE_KEY); without it the run skips loudly rather than pretending to have
 * verified anything. Free on a disposable Anvil chain; on a shared testnet, a run killed hard
 * enough to skip the `finally` leaves the floor lowered until someone puts it back.
 *
 * EvaluatorFacet.assignEvaluator rejects evaluator == requester and disputeResolver ==
 * requester (self-assignment guard, rev017), so the tasks here are created with a distinct
 * EVALUATOR_PRIVATE_KEY account. Nothing in this test signs as the evaluator -- the evaluator
 * exists only so finalizeVerdict becomes callable -- so any freshly generated key works.
 *
 * Usage:
 *   REQUESTER_PRIVATE_KEY=0x... WORKER_PRIVATE_KEY=0x... \
 *     npx tsx --env-file=../../.env src/scripts/smoke-nonce.ts
 */
import { createHash, randomBytes } from 'crypto';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import postgres from 'postgres';
import { createPublicClient, createWalletClient, defineChain, http, toHex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { buildSetWithdrawalAddressMessage, buildSubmitMessage } from '@taskmarket/shared';
import {
  API_URL,
  get,
  getAccounts,
  log,
  ok,
  pollTaskStatus,
  post,
  requireShortAppealWindow,
  sleep,
  x402Post,
} from './_x402';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATION_FILE = join(
  __dirname,
  '../../drizzle/migrations/0041_add_server_wallet_transactions.sql'
);
const CONCURRENCY = 3;

// Re-derived in main() from the floor actually in force, so the SMOKE_APPEAL_WINDOW_SLOW path
// (real floor, no lowering) works unchanged.
const WANTED_APPEAL_WINDOW_SECS = 5;
let appealWindowSecs = WANTED_APPEAL_WINDOW_SECS;

const nonceEvaluatorKey = process.env.EVALUATOR_PRIVATE_KEY as `0x${string}` | undefined;
if (!nonceEvaluatorKey) {
  console.error(
    'Missing EVALUATOR_PRIVATE_KEY.\n' +
      'assignEvaluator rejects evaluator == requester and disputeResolver == requester\n' +
      '(self-assignment guard) -- set EVALUATOR_PRIVATE_KEY to a distinct account. Any\n' +
      'freshly generated key works; this test never signs with it.'
  );
  process.exit(1);
}
const nonceEvaluator = privateKeyToAccount(nonceEvaluatorKey);

// Matches the CLI's withdraw command (apps/cli/src/commands/withdraw.ts) so the smoke test
// signs the same authorization a real client would.
const USDC_TYPES = {
  TransferWithAuthorization: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'validAfter', type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
    { name: 'nonce', type: 'bytes32' },
  ],
} as const;

type AllocatorRow = { next_nonce: number; wallet_address: string };
type OutboxRow = { nonce: number; status: string; context: string | null };

function contentHash(payload: string): string {
  return createHash('sha256').update(Buffer.from(payload)).digest('hex');
}

function serverWalletAddress(): string | null {
  const key = process.env.SERVER_PRIVATE_KEY;
  if (!key) return null;
  return privateKeyToAccount(key as `0x${string}`).address.toLowerCase();
}

function openDatabase() {
  const url = process.env.DATABASE_URL;
  if (!url) return null;
  return postgres(url, { max: 1, onnotice: () => undefined });
}

async function readAllocator(sql: postgres.Sql, wallet: string): Promise<AllocatorRow | null> {
  const rows = await sql<AllocatorRow[]>`
    select wallet_address, next_nonce from server_wallet_nonces
    where lower(wallet_address) = ${wallet}
  `;
  return rows[0] ?? null;
}

async function readOutbox(sql: postgres.Sql, wallet: string): Promise<OutboxRow[]> {
  return sql<OutboxRow[]>`
    select nonce, status, context from server_wallet_transactions
    where lower(wallet_address) = ${wallet}
    order by nonce asc
  `;
}

/**
 * Drive one task to the appealing state so finalize-verdict -- a permissionless endpoint
 * that relays through the server wallet with no X402 payment -- becomes callable.
 */
async function setupFinalizableTask(
  requester: ReturnType<typeof getAccounts>['requester'],
  worker: ReturnType<typeof getAccounts>['worker'],
  label: string
): Promise<string> {
  const { taskId } = (await x402Post(
    '/api/tasks',
    {
      description: `Nonce smoke test task ${label}`,
      reward: '1000',
      duration: 300,
      mode: 'claim',
      tags: ['smoke-nonce'],
      evaluator: nonceEvaluator.address,
      disputeResolver: nonceEvaluator.address,
      evaluationWindowHours: 0.00139, // ~5 seconds
      appealWindowHours: appealWindowSecs / 3600,
    },
    requester
  )) as { taskId: string };

  const claimSig = await worker.signMessage({ message: `taskmarket:claim:${taskId}` });
  await post(`/api/tasks/${taskId}/claim`, {
    taskId,
    workerAddress: worker.address,
    signature: claimSig,
  });

  const payload = `smoke-nonce-payload-${label}`;
  const submitSig = await worker.signMessage({
    message: buildSubmitMessage(taskId, [contentHash(payload)]),
  });
  await post(`/api/tasks/${taskId}/submissions`, {
    taskId,
    workerAddress: worker.address,
    signature: submitSig,
    artifacts: [
      {
        fileName: 'submission.txt',
        mimeType: 'text/plain',
        role: 'attachment',
        file: Buffer.from(payload).toString('base64'),
      },
    ],
  });

  await pollTaskStatus<{ status: string }>(taskId, ['review'], { timeoutMs: 45_000 });
  await x402Post(
    `/api/tasks/${taskId}/evaluate`,
    { taskId, verdict: 'approve', score: 900, confidence: 950 },
    requester
  );
  await pollTaskStatus<{ status: string }>(taskId, ['appealing'], { timeoutMs: 45_000 });

  return taskId;
}

/**
 * Fault injection strands a nonce on purpose, so it must never run against a real deployment.
 *
 * The default is derived from the RPC endpoint rather than the chain ID: the sandbox runs Anvil
 * with `--chain-id 84532`, deliberately impersonating Base Sepolia, so the chain ID cannot tell
 * a disposable local chain from a real one. A loopback RPC can.
 *
 * Deriving it means the sandbox does not have to remember a flag. A silently skipped fault
 * injection reads as a pass, which is the worse failure -- the reconciler is exactly the part
 * with no other live coverage.
 */
function faultInjectionEnabled(): { enabled: boolean; reason: string } {
  const explicit = process.env.SMOKE_NONCE_FAULT;
  if (explicit === '1') return { enabled: true, reason: 'SMOKE_NONCE_FAULT=1' };
  if (explicit === '0') return { enabled: false, reason: 'SMOKE_NONCE_FAULT=0' };

  const rpcUrl = process.env.BASE_RPC_URL || 'http://127.0.0.1:8545';
  let hostname: string;
  try {
    hostname = new URL(rpcUrl).hostname.toLowerCase().replace(/^\[|\]$/g, '');
  } catch {
    return { enabled: false, reason: `BASE_RPC_URL is not a parseable URL` };
  }
  const isLoopback =
    hostname === 'localhost' ||
    hostname === '::1' ||
    hostname === '0.0.0.0' ||
    hostname === 'host.docker.internal' ||
    hostname.startsWith('127.');

  return isLoopback
    ? { enabled: true, reason: `loopback RPC (${hostname})` }
    : {
        enabled: false,
        reason: `non-loopback RPC (${hostname}) -- set SMOKE_NONCE_FAULT=1 to run it anyway`,
      };
}

async function runChecks() {
  const { requester, worker } = getAccounts();
  const wallet = serverWalletAddress();
  const sql = openDatabase();

  console.log('=== Taskmarket Smoke Test — Server Wallet Nonce Management ===');
  console.log('requester:  ', requester.address);
  console.log('worker:     ', worker.address);
  console.log('api:        ', API_URL);
  console.log('server wallet:', wallet ?? '(SERVER_PRIVATE_KEY not set)');
  console.log(
    'database:   ',
    sql ? 'connected' : '(DATABASE_URL not set -- allocator checks skipped)'
  );

  const faultInjection = faultInjectionEnabled();
  console.log(
    'fault injection:',
    faultInjection.enabled ? `on (${faultInjection.reason})` : `off (${faultInjection.reason})`
  );

  const deepChecks = Boolean(sql && wallet);
  if (!deepChecks) {
    console.log(
      '\nNote: set DATABASE_URL and SERVER_PRIVATE_KEY to assert against the allocator itself.'
    );
  }

  // 1. Migration applied, and re-applying it is a no-op.
  if (sql) {
    log('1/6', 'Checking allocator tables exist and the migration is idempotent...');
    const tables = await sql<{ table_name: string }[]>`
      select table_name from information_schema.tables
      where table_name in ('server_wallet_nonces', 'server_wallet_transactions')
    `;
    if (tables.length !== 2) {
      throw new Error(
        `Expected both allocator tables, found: ${tables.map((t) => t.table_name).join(', ') || 'none'}`
      );
    }
    ok('allocator tables present', tables.map((t) => t.table_name).sort());

    // Re-run the migration verbatim. Every statement is guarded, so this must not throw
    // against a database where it already applied -- the property AGENTS.md requires and
    // that a mis-timed journal entry would otherwise turn into a boot crash loop.
    const statements = readFileSync(MIGRATION_FILE, 'utf8')
      .split('--> statement-breakpoint')
      .map((statement) => statement.trim())
      .filter(Boolean);
    for (const statement of statements) {
      await sql.unsafe(statement);
    }
    ok('migration re-applied as a no-op', `${statements.length} statements`);
  } else {
    log('1/6', 'Skipping migration idempotency check (no DATABASE_URL)');
  }

  // 2. Baseline.
  let baselineNextNonce: number | null = null;
  let baselineOutbox = 0;
  if (deepChecks && sql && wallet) {
    log('2/6', 'Reading allocator baseline...');
    const allocator = await readAllocator(sql, wallet);
    const outbox = await readOutbox(sql, wallet);
    baselineNextNonce = allocator?.next_nonce ?? null;
    baselineOutbox = outbox.length;
    ok('allocator next_nonce', baselineNextNonce ?? '(not seeded yet)');
    ok('outbox rows', baselineOutbox);
  } else {
    log('2/6', 'Skipping allocator baseline (no DATABASE_URL)');
  }

  // 3. The #54 trigger: a valid EIP-3009 authorization whose value exceeds the source
  // wallet's balance. It passes every input check and fails only at gas estimation, which
  // is exactly the shape that poisoned the old in-memory nonce cache.
  log('3/6', 'Triggering a deterministic pre-broadcast failure (over-balance withdrawal)...');

  // A withdrawal address must exist before /wallet/withdraw will build an authorization.
  // Setting it is idempotent from this test's point of view: a second attempt is rejected
  // with "already set", which is fine -- we only need the address to be present.
  await fetch(`${API_URL}/api/wallet/set-withdrawal-address`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      walletAddress: worker.address,
      withdrawalAddress: worker.address,
      signature: await worker.signMessage({
        message: buildSetWithdrawalAddressMessage(worker.address),
      }),
    }),
  });

  const withdrawalInfo = (await get(
    `/api/wallet/withdrawal-address?address=${worker.address}`
  )) as {
    withdrawalAddress: string | null;
    usdcDomain: { name: string; version: string; chainId: number; verifyingContract: string };
  };
  if (!withdrawalInfo.withdrawalAddress) {
    throw new Error('Could not establish a withdrawal address for the worker wallet');
  }

  const now = Math.floor(Date.now() / 1000);
  const authorization = {
    from: worker.address,
    to: withdrawalInfo.withdrawalAddress,
    // Far beyond any plausible test balance, so gas estimation reverts deterministically.
    value: '999999999999999',
    validAfter: String(now - 60),
    validBefore: String(now + 300),
    nonce: toHex(randomBytes(32)),
  };
  const authorizationSignature = await worker.signTypedData({
    domain: {
      ...withdrawalInfo.usdcDomain,
      verifyingContract: withdrawalInfo.usdcDomain.verifyingContract as `0x${string}`,
    },
    types: USDC_TYPES as Parameters<typeof worker.signTypedData>[0]['types'],
    primaryType: 'TransferWithAuthorization',
    message: authorization as unknown as Record<string, unknown>,
  });

  const failure = await fetch(`${API_URL}/api/wallet/withdraw`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: worker.address,
      amountBaseUnits: authorization.value,
      authorization,
      signature: authorizationSignature,
    }),
  });
  if (failure.ok) {
    throw new Error('Expected the over-balance withdrawal to be rejected');
  }
  ok('over-balance withdrawal rejected before broadcast', failure.status);

  if (deepChecks && sql && wallet && baselineNextNonce !== null) {
    const allocator = await readAllocator(sql, wallet);
    if (allocator?.next_nonce !== baselineNextNonce) {
      throw new Error(
        `A failed preflight advanced the allocator from ${baselineNextNonce} to ${allocator?.next_nonce} -- this is the issue #54 regression`
      );
    }
    const outbox = await readOutbox(sql, wallet);
    if (outbox.length !== baselineOutbox) {
      throw new Error(
        `A failed preflight wrote ${outbox.length - baselineOutbox} outbox row(s); it must allocate nothing`
      );
    }
    ok('allocator did not advance and no outbox row was written', baselineNextNonce);
  }

  // 4. Recovery: the next transaction must work without a restart.
  log('4/6', 'Setting up tasks and confirming the relayer still works after the failure...');
  const taskIds: string[] = [];
  for (let i = 0; i < CONCURRENCY; i++) {
    taskIds.push(await setupFinalizableTask(requester, worker, String(i)));
  }
  ok('relayer still working after failed preflight', `${taskIds.length} tasks created`);

  // 5. Concurrency: distinct nonces, not one-at-a-time.
  log('5/6', `Waiting for appeal windows, then finalizing ${CONCURRENCY} verdicts concurrently...`);
  await sleep((appealWindowSecs + 3) * 1000);
  const results = await Promise.all(
    taskIds.map((taskId) => post(`/api/tasks/${taskId}/finalize-verdict`, { taskId }))
  );
  const txHashes = results.map((r) => (r as { txHash: string }).txHash);
  if (txHashes.some((hash) => !hash)) {
    throw new Error('At least one finalize-verdict returned no txHash');
  }
  if (new Set(txHashes).size !== txHashes.length) {
    throw new Error(`Expected distinct txHashes, got duplicates: ${txHashes.join(', ')}`);
  }
  ok('concurrent finalize-verdict txHashes distinct', txHashes.length);

  for (const taskId of taskIds) {
    const task = (await get(`/api/tasks/${taskId}`)) as { status: string };
    if (task.status !== 'completed') {
      throw new Error(`Task ${taskId} expected completed, got ${task.status}`);
    }
  }
  ok('every task reached completed', true);

  // 5b. Deliberate fault injection: strand a nonce and prove the reconciler heals it without
  // an operator restart. This is the property the incident actually exposed, and the only way
  // to exercise it is to create the failure on purpose.
  //
  // Enabled automatically against a loopback RPC; see faultInjectionEnabled() for why the
  // chain ID cannot be used for this and why the default is on rather than off.
  if (deepChecks && sql && wallet && faultInjection.enabled) {
    log('5b', 'Injecting a stranded nonce and waiting for the reconciler to clear it...');

    const rpcUrl = process.env.BASE_RPC_URL || 'http://127.0.0.1:8545';
    const faultPublicClient = createPublicClient({ transport: http(rpcUrl) });
    const chainId = await faultPublicClient.getChainId();
    const chain = defineChain({
      id: chainId,
      name: 'smoke-nonce',
      nativeCurrency: { decimals: 18, name: 'Ether', symbol: 'ETH' },
      rpcUrls: { default: { http: [rpcUrl] } },
    });
    const serverAccount = privateKeyToAccount(process.env.SERVER_PRIVATE_KEY as `0x${string}`);
    const faultWalletClient = createWalletClient({
      account: serverAccount,
      chain,
      transport: http(rpcUrl),
    });

    const strandedNonce = await faultPublicClient.getTransactionCount({
      address: serverAccount.address,
      blockTag: 'pending',
    });
    const blockedNonce = strandedNonce + 1;

    // Move the allocator past both nonces first, so ordinary traffic cannot collide with the
    // hole we are about to create.
    await sql`
      update server_wallet_nonces set next_nonce = ${blockedNonce + 1}
      where lower(wallet_address) = ${wallet} and next_nonce <= ${blockedNonce}
    `;

    // A real transaction at the higher nonce. It cannot mine while the lower one is missing,
    // which is exactly the queue-blocking state the reconciler has to resolve.
    const blockedHash = await faultWalletClient.sendTransaction({
      nonce: blockedNonce,
      to: serverAccount.address,
      value: 0n,
    });
    ok('broadcast a transaction that cannot mine yet', { blockedHash, blockedNonce });

    // Record both rows the way the dispatcher would have: the lower nonce recycled by a
    // rejected broadcast, the higher one live. Backdate the recycled row so it is immediately
    // past the reconciler's stuck threshold rather than waiting it out.
    await sql`
      insert into server_wallet_transactions
        (id, wallet_address, chain_id, nonce, status, context, updated_at)
      values (${`smoke-nonce-stranded-${strandedNonce}`}, ${wallet}, ${chainId},
        ${strandedNonce}, 'recycled', 'smoke-nonce fault injection', now() - interval '1 hour')
    `;
    await sql`
      insert into server_wallet_transactions
        (id, wallet_address, chain_id, nonce, status, tx_hash, context, broadcast_at, updated_at)
      values (${`smoke-nonce-blocked-${blockedNonce}`}, ${wallet}, ${chainId},
        ${blockedNonce}, 'broadcast', ${blockedHash}, 'smoke-nonce fault injection',
        now() - interval '1 hour', now() - interval '1 hour')
    `;
    ok('stranded nonce recorded', strandedNonce);

    // The reconciler polls every 15s; give it several passes plus mining time.
    const deadline = Date.now() + 180_000;
    let healed = false;
    while (Date.now() < deadline) {
      await sleep(5000);
      const pending = await faultPublicClient.getTransactionCount({
        address: serverAccount.address,
        blockTag: 'pending',
      });
      const latest = await faultPublicClient.getTransactionCount({
        address: serverAccount.address,
        blockTag: 'latest',
      });
      if (latest > blockedNonce && pending === latest) {
        healed = true;
        break;
      }
    }
    if (!healed) {
      const rows = await readOutbox(sql, wallet);
      throw new Error(
        `The reconciler did not clear the stranded nonce ${strandedNonce} within 180s. Outbox: ${JSON.stringify(rows)}`
      );
    }
    ok('reconciler cleared the stranded nonce with no restart', strandedNonce);

    const blockedReceipt = await faultPublicClient.getTransactionReceipt({ hash: blockedHash });
    if (blockedReceipt.status !== 'success') {
      throw new Error(
        `The blocked transaction did not mine successfully: ${blockedReceipt.status}`
      );
    }
    ok('the transaction queued behind it mined', blockedHash);
  } else if (deepChecks) {
    log('5b', `Skipping fault injection: ${faultInjection.reason}`);
  }

  // 6. The master invariant: the allocator agrees with the chain and nothing is stranded.
  if (deepChecks && sql && wallet) {
    log('6/6', 'Verifying the allocator agrees with the chain...');
    const outbox = await readOutbox(sql, wallet);
    const issued = outbox.filter((row) => row.status !== 'recycled').map((row) => row.nonce);
    const uniqueIssued = new Set(issued);
    if (uniqueIssued.size !== issued.length) {
      throw new Error(`Two transactions were issued the same nonce: ${issued.join(', ')}`);
    }

    const sorted = [...uniqueIssued].sort((a, b) => a - b);
    const gaps = sorted.filter((nonce, index) => index > 0 && nonce !== sorted[index - 1]! + 1);
    if (gaps.length > 0) {
      throw new Error(`Nonce sequence has gaps before ${gaps.join(', ')} -- issue #54 signature`);
    }
    ok('issued nonces are distinct and contiguous', `${sorted.length} nonces`);

    const stranded = outbox.filter((row) => row.status === 'reserved');
    if (stranded.length > 0) {
      throw new Error(
        `${stranded.length} transaction(s) stuck in 'reserved' -- allocated but never broadcast`
      );
    }
    ok('no transaction stranded mid-flight', true);

    const publicClient = createPublicClient({
      transport: http(process.env.BASE_RPC_URL || 'http://127.0.0.1:8545'),
    });
    const chainNonce = await publicClient.getTransactionCount({
      address: wallet as `0x${string}`,
      blockTag: 'pending',
    });
    const allocator = await readAllocator(sql, wallet);
    if (allocator && allocator.next_nonce < chainNonce) {
      throw new Error(
        `Allocator (${allocator.next_nonce}) is behind the chain (${chainNonce}); it would reissue a spent nonce`
      );
    }
    ok('allocator is level with or ahead of the chain', {
      allocator: allocator?.next_nonce,
      chain: chainNonce,
    });
  } else {
    log('6/6', 'Skipping allocator invariants (no DATABASE_URL)');
  }

  await sql?.end();
  console.log('\n=== Nonce management smoke test passed ===');
}

async function main() {
  // Skips loudly if the floor cannot be lowered -- see requireShortAppealWindow.
  const appealWindow = await requireShortAppealWindow(WANTED_APPEAL_WINDOW_SECS);
  appealWindowSecs = appealWindow.effectiveSecs;
  try {
    await runChecks();
  } finally {
    // Restore in `finally`, not on the happy path: this test deliberately injects faults and
    // strands nonces, so it is more likely than most to throw partway -- and a throw must still
    // put the protocol floor back rather than leave the next run a weakened guard.
    await appealWindow.restore();
  }
}

main().catch(async (err) => {
  console.error('\nFatal:', err);
  process.exit(1);
});

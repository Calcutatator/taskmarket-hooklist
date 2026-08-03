/**
 * Server-wallet relay path smoke test: nonce allocator, outbox, and durable intents.
 *
 * Verifies: ADR-0040
 * Verifies: ADR-0045
 *
 * These are one subsystem, not three. ADR-0040 gave the server wallet a durable nonce
 * allocator, an outbox and a reconciler. ADR-0045 amends it: a paid write is now a durable
 * intent recorded before the chain call, and the reconciler that already kept nonces healthy
 * also finishes the work once the chain has answered. A single script covers the stack because the interesting failures live where the layers
 * meet -- a nonce stranded underneath a transaction somebody has already paid for.
 *
 * Regression coverage for daydreamsai/skills-market#54: a deterministic pre-broadcast
 * failure advanced viem's cached nonce without sending a transaction, so every later
 * relayer transaction queued behind the resulting gap until the backend restarted.
 *
 * Unlike smoke-withdraw.ts, which exercises the incident's user-facing path, this test
 * asserts against the durable tables themselves. It needs both the API and the backend's
 * database, so run it in the sandbox (or any environment where DATABASE_URL points at the
 * same Postgres the backend uses):
 *
 *   make smoke nonce
 *
 * What it covers:
 *   1. Both migrations are applied and re-applying either is a genuine no-op (idempotency).
 *   2. A deterministic preflight failure allocates no nonce and writes no outbox row.
 *   3. The very next transaction succeeds -- no restart, which is the #54 regression.
 *   4. Concurrent relayed writes take distinct, contiguous nonces rather than serializing.
 *   5. A paid write leaves a durable intent carrying its payment reference, and completing
 *      that intent -- not the request handler -- is what produces the task row.
 *   6. An operation spanning two transactions records a second intent that carries no payment
 *      of its own and is broadcast and completed with no request in play.
 *   7. A deliberately stranded nonce is cleared by the reconciler with no operator restart,
 *      the paid intent queued behind it still completes, and no refund is issued for it.
 *      This runs automatically against a loopback RPC (the sandbox and local dev), because it
 *      broadcasts a transaction that is intentionally stuck and strands a nonce on purpose.
 *      Set SMOKE_NONCE_FAULT=1 to force it on elsewhere, or 0 to force it off.
 *   8. The allocator agrees with the chain afterwards, with nothing stranded mid-flight, one
 *      intent per payment, and no successful payment recorded as orphaned.
 *
 * Without DATABASE_URL the durable assertions are skipped and the API-level behavior is
 * still checked, so the test degrades usefully against a remote deployment.
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
  pollUntil,
  post,
  sleep,
  x402Post,
} from './_x402';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATION_FILES = [
  '0041_add_server_wallet_transactions.sql',
  '0042_add_relayed_intents.sql',
].map((name) => join(__dirname, '../../drizzle/migrations', name));
const CONCURRENCY = 3;
const RELAY_TABLES = [
  'server_wallet_nonces',
  'server_wallet_transactions',
  'relayed_intents',
] as const;

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

type IntentRow = {
  completed_at: Date | null;
  created_at: Date;
  id: string;
  last_error: string | null;
  operation: string;
  payer: string | null;
  payment_amount: string | null;
  payment_tx_hash: string | null;
  server_wallet_transaction_id: string | null;
  status: string;
  tx_hash: string | null;
};

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
 * Intents are located by the taskId inside their persisted payload, because the create
 * endpoint's response deliberately carries no intent identifier -- callers are handed a task,
 * not a piece of the mechanism. The payload is the completion handler's only input, so keying
 * off it also confirms the handler would have everything it needs in a fresh process.
 */
async function readIntents(
  sql: postgres.Sql,
  taskId: string,
  operation: string
): Promise<IntentRow[]> {
  return sql<IntentRow[]>`
    select id, operation, status, payer, payment_tx_hash, payment_amount,
           server_wallet_transaction_id, tx_hash,
           last_error, created_at, completed_at
    from relayed_intents
    where operation = ${operation} and payload->>'taskId' = ${taskId}
    order by created_at asc
  `;
}

async function pollIntent(
  sql: postgres.Sql,
  taskId: string,
  operation: string,
  predicate: (row: IntentRow) => boolean,
  label: string,
  timeoutMs = 180_000
): Promise<IntentRow> {
  const deadline = Date.now() + timeoutMs;
  let last: IntentRow | undefined;
  while (Date.now() < deadline) {
    const [row] = await readIntents(sql, taskId, operation);
    last = row;
    if (row && predicate(row)) return row;
    await sleep(3000);
  }
  throw new Error(
    `Timed out waiting for ${label}. Last seen: ${
      last
        ? JSON.stringify({ id: last.id, lastError: last.last_error, status: last.status })
        : '(no intent row)'
    }`
  );
}

/**
 * Orphaned-payment rows for the given payment hashes. Any row here means a refund path ran.
 *
 * Uses an expanded `in` value list rather than `= any(sql.array(...))` for the same reason as the
 * relay-table check in step 1: array parameters need element-type inference the driver cannot
 * always do, and a scalar value list needs none.
 */
async function readOrphanedPayments(
  sql: postgres.Sql,
  paymentHashes: string[]
): Promise<{ context: string; payment_tx_hash: string; refund_status: string }[]> {
  if (paymentHashes.length === 0) return [];
  return sql<{ context: string; payment_tx_hash: string; refund_status: string }[]>`
    select payment_tx_hash, context, refund_status from orphaned_payments
    where payment_tx_hash in ${sql(paymentHashes)}
  `;
}

/**
 * A plain paid create with no evaluator, so it produces exactly one intent.
 *
 * The fault injection deletes and re-creates this task's row, and a create that also triggers
 * an evaluator assignment would drag a second intent through that surgery for no additional
 * coverage.
 */
async function setupPaidTask(
  requester: ReturnType<typeof getAccounts>['requester'],
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
    },
    requester
  )) as { taskId: string };
  return taskId;
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
      evaluator: requester.address,
      disputeResolver: requester.address,
      evaluationWindowHours: 0.00139, // ~5 seconds
      appealWindowHours: 0.00139, // ~5 seconds
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

async function main() {
  const { requester, worker } = getAccounts();
  const wallet = serverWalletAddress();
  const sql = openDatabase();

  console.log('=== Taskmarket Smoke Test — Server Wallet Relay Path (nonces, outbox, intents) ===');
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
  if (!sql) {
    console.log(
      'Note: without DATABASE_URL the intent assertions are skipped entirely. This run then' +
        '\nproves the paid endpoints still respond, not that a paid write is durable.'
    );
  }

  // Every payment this run settles. Two of the final invariants are stated over exactly these:
  // one intent per payment, and no refund for any of them.
  const paymentHashes: string[] = [];

  // 1. Migrations applied, and re-applying either is a no-op.
  if (sql) {
    log('1/9', 'Checking relay tables exist and both migrations are idempotent...');
    // Deliberately one query per table with a single scalar parameter, rather than the obvious
    // `where table_name = any(${sql.array([...RELAY_TABLES])})`. postgres.js has to infer an
    // element OID for an array parameter, and on a connection whose type cache is still cold --
    // which this query always is, being the very first statement the smoke runs -- that inference
    // fails reproducibly and takes every later step down with it. A plain scalar equality needs no
    // inference at all. Do not "simplify" this back into an array parameter.
    const tables: { table_name: string }[] = [];
    for (const table of RELAY_TABLES) {
      const rows = await sql<{ table_name: string }[]>`
        select table_name from information_schema.tables
        where table_name = ${table}
      `;
      // Assert per table rather than on the total count. The same table name can appear in
      // more than one schema on a shared database, and a duplicate row would otherwise make
      // up the count for a table that is genuinely missing.
      if (rows.length === 0) {
        throw new Error(`Relay table is missing: ${table}`);
      }
      tables.push(...rows);
    }
    ok('relay tables present', tables.map((t) => t.table_name).sort());

    // Re-run both migrations verbatim. Every statement is guarded, so this must not throw
    // against a database where it already applied -- the property AGENTS.md requires and
    // that a mis-timed journal entry would otherwise turn into a boot crash loop.
    for (const file of MIGRATION_FILES) {
      const statements = readFileSync(file, 'utf8')
        .split('--> statement-breakpoint')
        .map((statement) => statement.trim())
        .filter(Boolean);
      for (const statement of statements) {
        await sql.unsafe(statement);
      }
      ok(`re-applied as a no-op: ${file.split('/').pop()}`, `${statements.length} statements`);
    }
  } else {
    log('1/9', 'Skipping migration idempotency check (no DATABASE_URL)');
  }

  // 2. Baseline.
  let baselineNextNonce: number | null = null;
  let baselineOutbox = 0;
  if (deepChecks && sql && wallet) {
    log('2/9', 'Reading allocator baseline...');
    const allocator = await readAllocator(sql, wallet);
    const outbox = await readOutbox(sql, wallet);
    baselineNextNonce = allocator?.next_nonce ?? null;
    baselineOutbox = outbox.length;
    ok('allocator next_nonce', baselineNextNonce ?? '(not seeded yet)');
    ok('outbox rows', baselineOutbox);
  } else {
    log('2/9', 'Skipping allocator baseline (no DATABASE_URL)');
  }

  // 3. The #54 trigger: a valid EIP-3009 authorization whose value exceeds the source
  // wallet's balance. It passes every input check and fails only at gas estimation, which
  // is exactly the shape that poisoned the old in-memory nonce cache.
  log('3/9', 'Triggering a deterministic pre-broadcast failure (over-balance withdrawal)...');

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
  log('4/9', 'Setting up tasks and confirming the relayer still works after the failure...');
  const taskIds: string[] = [];
  for (let i = 0; i < CONCURRENCY; i++) {
    taskIds.push(await setupFinalizableTask(requester, worker, String(i)));
  }
  ok('relayer still working after failed preflight', `${taskIds.length} tasks created`);

  // 5. Concurrency: distinct nonces, not one-at-a-time.
  log('5/9', `Waiting for appeal windows, then finalizing ${CONCURRENCY} verdicts concurrently...`);
  await sleep(8000);
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

  // 6. The durable intent behind a paid write (ADR-0045).
  //
  // The row has to exist for the reconciler to have anything to decide about later: it carries
  // the payment reference, so a verdict reached minutes after the request has gone can still be
  // matched to the money. Before this, settlement was decided by whoever happened to still be
  // waiting, which is how a slow chain turned into a refund for work that then landed.
  //
  // Completion, not the request handler, is what writes the task row -- so a completed intent
  // with a task row is also proof that the inline path is gone.
  if (sql) {
    log('6/9', 'Inspecting the durable intent behind a paid task creation...');
    const createRows = await readIntents(sql, taskIds[0]!, 'tasks.create');
    if (createRows.length !== 1) {
      throw new Error(
        `Expected exactly one tasks.create intent for ${taskIds[0]}, found ${createRows.length}`
      );
    }
    const createIntent = createRows[0]!;
    if (!createIntent.payment_tx_hash || !createIntent.payer || !createIntent.payment_amount) {
      throw new Error(
        `Intent ${createIntent.id} is missing payment fields: ${JSON.stringify({
          payer: createIntent.payer,
          paymentAmount: createIntent.payment_amount,
          paymentTxHash: createIntent.payment_tx_hash,
        })}`
      );
    }
    paymentHashes.push(createIntent.payment_tx_hash);
    ok('intent recorded with its payment reference', {
      id: createIntent.id,
      operation: createIntent.operation,
      payer: createIntent.payer,
    });

    const completed = await pollIntent(
      sql,
      taskIds[0]!,
      'tasks.create',
      (row) => row.status === 'completed',
      `tasks.create intent for ${taskIds[0]} to complete`
    );
    if (!completed.completed_at) {
      throw new Error(`Intent ${completed.id} is completed but has no completed_at`);
    }
    if (!completed.tx_hash) {
      throw new Error(`Intent ${completed.id} completed with no transaction hash recorded`);
    }
    const taskRows = await sql<{ id: string }[]>`select id from tasks where id = ${taskIds[0]!}`;
    if (taskRows.length !== 1) {
      throw new Error(`Intent ${completed.id} completed but no task row exists for ${taskIds[0]}`);
    }
    ok('intent completed and the task row it produced exists', {
      completedAt: completed.completed_at,
      txHash: completed.tx_hash,
    });

    // Every remaining paid create in this run must also have left exactly one intent, so the
    // per-payment invariants at the end are stated over the whole run rather than one sample.
    for (const taskId of taskIds.slice(1)) {
      const rows = await readIntents(sql, taskId, 'tasks.create');
      if (rows.length !== 1 || !rows[0]!.payment_tx_hash) {
        throw new Error(`Task ${taskId} has ${rows.length} tasks.create intent(s) with a payment`);
      }
      paymentHashes.push(rows[0]!.payment_tx_hash);
    }
  } else {
    log('6/9', 'Skipping durable intent checks (no DATABASE_URL)');
  }

  // 7. The evaluator assignment. These tasks carry an evaluator, and assigning one is a second
  // contract call, because the contract's createTask cannot take evaluator configuration. It
  // cannot be broadcast bare from inside the create's completion handler: a transaction sent
  // from there would have no durable record of its own, so nothing could settle it. It gets an
  // intent of its own instead -- recorded once the create is confirmed, then broadcast and
  // completed by the dispatch itself, with no request anywhere in the sequence. The dispatcher
  // awaits the receipt, so by the time the broadcast returns the transaction is confirmed and
  // the completion runs there; the reconciler's sweep is the backstop, not the normal route.
  if (sql) {
    log('7/9', 'Following the evaluator assignment...');
    const assignIntent = await pollIntent(
      sql,
      taskIds[0]!,
      'tasks.assignEvaluator',
      () => true,
      `a tasks.assignEvaluator intent for ${taskIds[0]} to be recorded`,
      60_000
    );
    // It carries no payment: nothing was paid for it, so a confirmed failure of it has nothing
    // to refund, and one payment can never be refunded twice.
    if (assignIntent.payment_tx_hash !== null || assignIntent.payment_amount !== null) {
      throw new Error(`Intent ${assignIntent.id} carries a payment reference; it should not`);
    }
    ok('evaluator assignment recorded as its own intent with no payment', assignIntent.id);

    const settledAssign = await pollIntent(
      sql,
      taskIds[0]!,
      'tasks.assignEvaluator',
      (row) => row.status === 'completed',
      `the tasks.assignEvaluator intent for ${taskIds[0]} to complete`
    );
    ok(
      'evaluator assignment broadcast and completed with no request in play',
      settledAssign.tx_hash
    );
  } else {
    log('7/9', 'Skipping evaluator-assignment intent checks (no DATABASE_URL)');
  }

  // The evaluator reaches the task only through that intent's completion handler, so this is
  // the end-to-end form of the same claim: the intent did the work, not just moved rows.
  // It runs with or without a database, which is what the API-only mode is worth.
  const evaluated = await pollUntil(
    () => get(`/api/tasks/${taskIds[0]}`) as Promise<{ evaluator: string | null }>,
    (task) => Boolean(task.evaluator),
    { label: `an evaluator to be recorded on task ${taskIds[0]}`, timeoutMs: 120_000 }
  );
  if (evaluated.evaluator?.toLowerCase() !== requester.address.toLowerCase()) {
    throw new Error(
      `Task ${taskIds[0]} evaluator is ${evaluated.evaluator}, expected ${requester.address}`
    );
  }
  ok('evaluator recorded on the task by its own intent', evaluated.evaluator);

  // 8. Deliberate fault injection: strand a nonce and prove the reconciler heals it without
  // an operator restart. This is the property the incident actually exposed, and the only way
  // to exercise it is to create the failure on purpose.
  //
  // Enabled automatically against a loopback RPC; see faultInjectionEnabled() for why the
  // chain ID cannot be used for this and why the default is on rather than off.
  if (deepChecks && sql && wallet && faultInjection.enabled) {
    log('8/9', 'Injecting a stranded nonce underneath a paid intent...');

    // A real paid create, so the transaction that is about to be stranded is one somebody has
    // already been charged for. That is what makes the three assertions at the end of this
    // step meaningful rather than a nonce-hygiene check with money bolted on.
    const strandedTaskId = await setupPaidTask(requester, 'stranded');
    const paidIntent = await pollIntent(
      sql,
      strandedTaskId,
      'tasks.create',
      (row) => row.status === 'completed',
      `tasks.create intent for ${strandedTaskId} to complete`
    );
    if (!paidIntent.payment_tx_hash) {
      throw new Error(`Intent ${paidIntent.id} has no payment reference to reason about`);
    }
    paymentHashes.push(paidIntent.payment_tx_hash);
    ok('paid intent to strand', { id: paidIntent.id, taskId: strandedTaskId });

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
    // The blocked row keeps a current broadcast_at, unlike the recycled one. It is legitimately
    // in flight, and a row past the stuck threshold gets a replacement -- which is confirmed
    // evidence the original never landed, and would rightly refund the intent about to be
    // attached to it. Manufacturing that would prove nothing about timeouts.
    const blockedTransactionId = `smoke-nonce-blocked-${blockedNonce}`;
    await sql`
      insert into server_wallet_transactions
        (id, wallet_address, chain_id, nonce, status, tx_hash, context, broadcast_at, updated_at)
      values (${blockedTransactionId}, ${wallet}, ${chainId},
        ${blockedNonce}, 'broadcast', ${blockedHash}, 'smoke-nonce fault injection',
        now(), now())
    `;
    ok('stranded nonce recorded', strandedNonce);

    // Put the paid intent back into the state a request that returned early leaves behind, and
    // attach it to the blocked transaction: in flight, no completion done, and stuck behind a
    // hole in the nonce sequence. A marker tag is written into the payload first because the
    // chain-event indexer also inserts a row for this task id from the on-chain TaskCreated
    // event -- without something only the completion handler can produce, a reappearing task
    // row would not say which path wrote it.
    const marker = `smoke-nonce-reconciled-${Date.now()}`;
    await sql`
      update relayed_intents
      set payload = jsonb_set(payload, '{input,tags}', ${sql.json(['smoke-nonce', marker])}::jsonb),
          server_wallet_transaction_id = ${blockedTransactionId},
          tx_hash = ${blockedHash},
          status = 'broadcast',
          completed_at = null,
          last_error = null,
          updated_at = now()
      where id = ${paidIntent.id}
    `;
    await sql`delete from tasks where id = ${strandedTaskId}`;
    ok('paid intent left in flight with its work undone', {
      intentId: paidIntent.id,
      nonce: blockedNonce,
    });

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

    // The three-part assertion this whole script exists to make, and the only place the layers
    // are proven together.
    //
    // The intent spent minutes in flight with no caller waiting on it. Under the old rule that
    // was indistinguishable from failure, and the request's broad catch refunded the payer --
    // after which the reconciler landed the very transaction it had declared dead. The rule
    // now is that a timeout is not evidence: only a reverted receipt or a mined replacement is.
    // So all three of these must hold at once, and any one of them failing is the same defect
    // seen from a different side.
    //
    //   1. the nonce is cleared with no operator restart (asserted above);
    //   2. the work the payment bought actually happens, however late the receipt arrives;
    //   3. the money does not move, because nothing ever confirmed a failure.
    const reconciled = await pollIntent(
      sql,
      strandedTaskId,
      'tasks.create',
      (row) => row.status === 'completed' && row.completed_at !== null,
      `the reconciler to complete paid intent ${paidIntent.id} with no restart`
    );
    const rewritten = await sql<{ tags: string[] }[]>`
      select tags from tasks where id = ${strandedTaskId}
    `;
    if (rewritten.length !== 1) {
      throw new Error(`Intent ${reconciled.id} completed but its task row was never written`);
    }
    if (!rewritten[0]!.tags?.includes(marker)) {
      throw new Error(
        `Task ${strandedTaskId} came back without the completion marker, so the completion ` +
          'handler did not write it and the row cannot be attributed to the reconciler'
      );
    }
    ok('a receipt arriving after the caller had gone still produced the work', {
      completedAt: reconciled.completed_at,
      taskId: strandedTaskId,
    });

    const refunded = await readOrphanedPayments(sql, [paidIntent.payment_tx_hash]);
    if (refunded.length > 0) {
      throw new Error(
        `A stranded-but-successful paid intent was refunded: ${JSON.stringify(refunded)}`
      );
    }
    ok('no refund was issued while the paid intent was stranded', paidIntent.payment_tx_hash);
  } else {
    // Always announce the skip, including when the deep checks themselves are off. A step that
    // vanishes from the output is indistinguishable from a step that passed, and this script's
    // own header argues that a silently skipped fault injection reading as a pass is the worse
    // failure of the two.
    log(
      '8/9',
      `Skipping fault injection: ${faultInjection.reason}${
        deepChecks ? '' : ' (deep checks are off: no DATABASE_URL or wallet)'
      }`
    );
  }

  // 9. The master invariant: the allocator agrees with the chain and nothing is stranded.
  if (deepChecks && sql && wallet) {
    log('9/9', 'Verifying the allocator agrees with the chain and no payment was refunded...');
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
    log('9/9', 'Skipping allocator invariants (no DATABASE_URL or SERVER_PRIVATE_KEY)');
  }

  if (sql && paymentHashes.length > 0) {
    // The payment hash is uniquely indexed precisely so the record is the idempotency key for
    // a paid operation: a retried request reusing a settled x402 payment must reuse its intent
    // rather than making a second chain call and a second escrow for one payment.
    const duplicates = await sql<{ count: string; payment_tx_hash: string }[]>`
      select payment_tx_hash, count(*) as count from relayed_intents
      where payment_tx_hash in ${sql(paymentHashes)}
      group by payment_tx_hash having count(*) > 1
    `;
    if (duplicates.length > 0) {
      throw new Error(`Payments with more than one intent: ${JSON.stringify(duplicates)}`);
    }
    ok('one intent per payment', `${paymentHashes.length} payments`);

    // Stated over every payment this run made, not only the stranded one. A refund for a
    // create that succeeded is the defect ADR-0045 exists to remove, and it is silent: the
    // task exists on chain, funded from the server wallet, and the payer has their money back.
    const orphans = await readOrphanedPayments(sql, paymentHashes);
    if (orphans.length > 0) {
      throw new Error(
        `Successful paid writes were recorded as orphaned payments: ${JSON.stringify(orphans)}`
      );
    }
    ok('no successful payment was refunded', `${paymentHashes.length} payments`);
  } else if (!sql) {
    ok('skipped per-payment intent invariants', 'no DATABASE_URL');
  }

  await sql?.end();
  console.log('\n=== Server wallet relay path smoke test passed ===');
}

main().catch(async (err) => {
  console.error('\nFatal:', err);
  process.exit(1);
});

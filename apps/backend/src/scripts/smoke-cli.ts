/**
 * CLI end-to-end smoke test: drives a full requester+worker workflow entirely
 * through the real built `taskmarket` binary (apps/cli/dist/index.js) run as a
 * subprocess -- no direct API calls anywhere in this script. Every other CLI
 * test mocks apiGet/apiPost, the signer, and the keystore; this one exercises
 * the real keystore load/decrypt path, the real wallet signing path, the
 * CLI's own X402 payment flow (apps/cli/src/lib/x402.ts), and real HTTP round
 * trips against a live backend. See issue #222.
 *
 * Flow (every step below runs `taskmarket ...` as a real subprocess):
 *  1.  wallet import        -- provision throwaway keystores (requester + worker)
 *  2.  address              -- verify the imported address
 *  3.  identity register    -- real X402 payment, mint/confirm ERC-8004 identity
 *  4.  identity status      -- verify registered
 *  5.  stats                -- sanity-check agent stats response shape
 *  6.  wallet balance       -- sanity-check USDC balance response shape
 *  7.  task create          -- real X402 payment, create a bounty task
 *  8.  task get             -- verify the created task
 *  9.  task list            -- verify the task appears in search
 *  10. task submit          -- worker uploads a real file via presigned URL
 *  11. task my-submissions  -- verify the submission is listed
 *  12. task accept          -- real X402 payment, requester accepts
 *  13. inbox                -- verify both requester and worker inbox views
 *  14. encrypt / decrypt    -- round-trip a file through the wallet's ECIES keys
 *  15. idempotency reuse    -- a refused repeat, asserted on the failure envelope itself
 *                             (status, reason, idempotencyKey, pending) -- the only step here
 *                             that exercises what a caller sees when a paid write is refused
 *
 * Requires the CLI to be built first:
 *   pnpm --filter @lucid-agents/taskmarket build
 *
 * Usage:
 *   REQUESTER_PRIVATE_KEY=0x... WORKER_PRIVATE_KEY=0x... \
 *     npx tsx --env-file=../../.env src/scripts/smoke-cli.ts
 */
import { randomUUID } from 'crypto';
import { execFile } from 'child_process';
import { existsSync } from 'fs';
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { promisify } from 'util';
import { fileURLToPath } from 'url';
import { privateKeyToAccount } from 'viem/accounts';

const execFileAsync = promisify(execFile);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI_BIN = path.resolve(__dirname, '../../../cli/dist/index.js');
const API_URL = process.env.TASKMARKET_API_URL || process.env.API_URL || 'http://localhost:3000';

function log(step: string, msg: string) {
  console.log(`\n[${step}] ${msg}`);
}

function ok(label: string, value: unknown) {
  console.log(`  ✓ ${label}:`, value);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface CliResponse {
  ok: boolean;
  data?: unknown;
  error?: string;
}

/**
 * The failure envelope `renderFailure` writes to stderr, as a consumer sees it.
 *
 * Typed loosely on purpose: the fields under test are the ones that may be *absent*, and an
 * interface that made them required would assert their presence rather than check it. `pending`
 * in particular is deliberately omitted rather than defaulted to `false` when the backend sent
 * no envelope -- an unclassified failure is not evidence that nothing is in flight, and
 * `docs/CLI_GUIDE.md` tells script authors to treat a missing `pending` as "do not retry".
 */
interface CliFailure {
  ok: false;
  error?: string;
  status?: number;
  idempotencyKey?: string;
  reason?: string;
  intentId?: string;
  intentStatus?: string;
  pending?: boolean;
}

/** Runs the real built CLI binary as a subprocess, isolated to its own HOME dir. */
async function runCli(
  homeDir: string,
  args: string[],
  extraEnv: Record<string, string> = {}
): Promise<CliResponse> {
  let stdout: string;
  try {
    ({ stdout } = await execFileAsync('node', [CLI_BIN, ...args], {
      env: { ...process.env, HOME: homeDir, TASKMARKET_API_URL: API_URL, ...extraEnv },
      timeout: 90_000,
      maxBuffer: 32 * 1024 * 1024,
    }));
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message: string };
    throw new Error(
      `taskmarket ${args.join(' ')} failed: ${(e.stderr ?? e.message).trim()}` +
        (e.stdout ? `\nstdout: ${e.stdout.trim()}` : '')
    );
  }
  const lastLine = stdout.trim().split('\n').filter(Boolean).pop() ?? '';
  try {
    return JSON.parse(lastLine) as CliResponse;
  } catch {
    throw new Error(`taskmarket ${args.join(' ')} did not print JSON on stdout:\n${stdout}`);
  }
}

/**
 * Runs the CLI expecting it to FAIL, and returns the failure envelope it printed.
 *
 * `runCli` cannot be used for this: a failed command exits non-zero, which makes `execFile`
 * reject, and the envelope this asserts on is written to **stderr** rather than stdout
 * (`apps/cli/src/lib/output.ts`). So the whole point of these scenarios -- what an operator or
 * an agent actually receives when a paid write does not go through -- is invisible to every
 * other step in this file.
 *
 * Throws if the command *succeeds*, because a scenario written to provoke a refusal that gets
 * accepted instead has not tested anything, and silently passing there is how a guard stops
 * working without anyone noticing.
 */
async function runCliExpectingFailure(
  homeDir: string,
  args: string[],
  extraEnv: Record<string, string> = {}
): Promise<CliFailure> {
  let stderr: string;
  try {
    const result = await execFileAsync('node', [CLI_BIN, ...args], {
      env: { ...process.env, HOME: homeDir, TASKMARKET_API_URL: API_URL, ...extraEnv },
      timeout: 90_000,
      maxBuffer: 32 * 1024 * 1024,
    });
    throw new Error(
      `taskmarket ${args.join(' ')} was expected to fail but succeeded: ${result.stdout.trim()}`
    );
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message: string };
    if (e.stderr === undefined) throw err;
    stderr = e.stderr;
  }
  const lastLine = stderr.trim().split('\n').filter(Boolean).pop() ?? '';
  let parsed: CliFailure;
  try {
    parsed = JSON.parse(lastLine) as CliFailure;
  } catch {
    throw new Error(
      `taskmarket ${args.join(' ')} did not print a JSON failure envelope:\n${stderr}`
    );
  }
  if (parsed.ok !== false) {
    throw new Error(`expected ok:false from taskmarket ${args.join(' ')}, got: ${lastLine}`);
  }
  return parsed;
}

/** Runs the CLI and unwraps a successful {ok: true, data} response, or throws. */
async function runCliData(
  homeDir: string,
  args: string[],
  extraEnv: Record<string, string> = {}
): Promise<unknown> {
  const result = await runCli(homeDir, args, extraEnv);
  if (!result.ok) {
    throw new Error(`taskmarket ${args.join(' ')} returned ok:false: ${result.error}`);
  }
  return result.data;
}

function requirePrivateKey(name: string): string {
  const value = process.env[name] ?? process.env.DEV_PRIVATE_KEY;
  if (!value) {
    console.error(`Set ${name} or DEV_PRIVATE_KEY`);
    process.exit(1);
  }
  return value;
}

async function main() {
  if (!existsSync(CLI_BIN)) {
    throw new Error(
      `CLI binary not found at ${CLI_BIN}. Build it first: pnpm --filter @lucid-agents/taskmarket build`
    );
  }

  const requesterKey = requirePrivateKey('REQUESTER_PRIVATE_KEY');
  const workerKey = requirePrivateKey('WORKER_PRIVATE_KEY');
  const requesterAddress = privateKeyToAccount(requesterKey as `0x${string}`).address;
  const workerAddress = privateKeyToAccount(workerKey as `0x${string}`).address;

  console.log('=== Taskmarket Smoke Test — CLI (real binary subprocess, full workflow) ===');
  console.log('requester:', requesterAddress);
  console.log('worker:   ', workerAddress);
  console.log('api:      ', API_URL);
  console.log('cli:      ', CLI_BIN);

  const requesterHome = await mkdtemp(path.join(tmpdir(), 'taskmarket-cli-smoke-requester-'));
  const workerHome = await mkdtemp(path.join(tmpdir(), 'taskmarket-cli-smoke-worker-'));
  const submissionFile = path.join(tmpdir(), `taskmarket-cli-smoke-submission-${Date.now()}.txt`);
  const plainFile = path.join(tmpdir(), `taskmarket-cli-smoke-plain-${Date.now()}.txt`);
  const encFile = `${plainFile}.enc`;
  const decFile = `${plainFile}.dec`;

  try {
    // 1. Provision throwaway keystores, each isolated to its own HOME dir so
    // the developer's real ~/.taskmarket keystore is never touched. The key
    // is passed via TASKMARKET_IMPORT_KEY (not --key) to avoid the CLI's
    // ps-aux warning.
    log('1/15', 'wallet import (requester + worker)...');
    const reqImport = (await runCliData(requesterHome, ['wallet', 'import', '--yes'], {
      TASKMARKET_IMPORT_KEY: requesterKey,
    })) as { address: string };
    if (reqImport.address.toLowerCase() !== requesterAddress.toLowerCase()) {
      throw new Error(`requester keystore address mismatch: got ${reqImport.address}`);
    }
    const workerImport = (await runCliData(workerHome, ['wallet', 'import', '--yes'], {
      TASKMARKET_IMPORT_KEY: workerKey,
    })) as { address: string };
    if (workerImport.address.toLowerCase() !== workerAddress.toLowerCase()) {
      throw new Error(`worker keystore address mismatch: got ${workerImport.address}`);
    }
    ok('requester keystore', reqImport.address);
    ok('worker keystore', workerImport.address);

    // 2. address
    log('2/15', 'address (requester)...');
    const addrResult = (await runCliData(requesterHome, ['address'])) as { address: string };
    if (addrResult.address.toLowerCase() !== requesterAddress.toLowerCase()) {
      throw new Error(`address mismatch: got ${addrResult.address}`);
    }
    ok('address', addrResult.address);

    // 3. identity register -- real X402 payment via the CLI's own x402.ts,
    // minting or confirming an ERC-8004 identity for both wallets.
    log('3/15', 'identity register (requester + worker)...');
    const reqIdentity = (await runCliData(requesterHome, ['identity', 'register'])) as {
      agentId: string;
    };
    const workerIdentity = (await runCliData(workerHome, ['identity', 'register'])) as {
      agentId: string;
    };
    if (!reqIdentity.agentId) throw new Error('requester identity register returned no agentId');
    if (!workerIdentity.agentId) throw new Error('worker identity register returned no agentId');
    ok('requester agentId', reqIdentity.agentId);
    ok('worker agentId', workerIdentity.agentId);

    // 4. identity status
    log('4/15', 'identity status (requester)...');
    const idStatus = (await runCliData(requesterHome, ['identity', 'status'])) as {
      registered: boolean;
      agentId: string | null;
    };
    if (!idStatus.registered || idStatus.agentId !== reqIdentity.agentId) {
      throw new Error(`identity status mismatch: ${JSON.stringify(idStatus)}`);
    }
    ok('identity status registered', idStatus.registered);

    // 5. stats
    log('5/15', 'stats (requester)...');
    const stats = (await runCliData(requesterHome, ['stats'])) as {
      address: string;
      balanceUsdc: string;
    };
    if (stats.address.toLowerCase() !== requesterAddress.toLowerCase()) {
      throw new Error(`stats address mismatch: got ${stats.address}`);
    }
    ok('stats balanceUsdc', stats.balanceUsdc);

    // 6. wallet balance
    log('6/15', 'wallet balance (requester)...');
    const balance = (await runCliData(requesterHome, ['wallet', 'balance'])) as {
      balanceUsdc: string;
    };
    ok('wallet balance', balance.balanceUsdc);

    // 7. task create -- real X402 payment for the reward escrow
    log('7/15', 'task create (requester)...');
    const created = (await runCliData(requesterHome, [
      'task',
      'create',
      '--description',
      'CLI smoke test task',
      '--reward',
      '0.001',
      '--duration',
      '1',
      '--mode',
      'bounty',
      '--tags',
      'smoke-cli',
    ])) as { taskId: string };
    const taskId = created.taskId;
    ok('taskId', taskId);

    // 8. task get
    log('8/15', 'task get (requester)...');
    const gotTask = (await runCliData(requesterHome, ['task', 'get', taskId])) as {
      id: string;
      status: string;
    };
    if (gotTask.id !== taskId) throw new Error(`task get id mismatch: ${gotTask.id}`);
    if (gotTask.status !== 'open') throw new Error(`expected status open, got ${gotTask.status}`);
    ok('task status', gotTask.status);

    // 9. task list
    log('9/15', 'task list (requester)...');
    const listed = (await runCliData(requesterHome, [
      'task',
      'list',
      '--tags',
      'smoke-cli',
      '--status',
      'open',
    ])) as { tasks: { id: string }[] };
    if (!listed.tasks.some((t) => t.id === taskId)) {
      throw new Error(`taskId ${taskId} not found in task list`);
    }
    ok('task in list', true);

    // 10. task submit -- worker uploads a real file via presigned URL
    log('10/15', 'task submit (worker)...');
    await writeFile(submissionFile, 'cli smoke test submission\n', 'utf8');
    const submitted = (await runCliData(workerHome, [
      'task',
      'submit',
      taskId,
      '--file',
      submissionFile,
    ])) as { submissionId: string };
    ok('submissionId', submitted.submissionId);

    // 11. task my-submissions
    log('11/15', 'task my-submissions (worker)...');
    const mySubs = (await runCliData(workerHome, ['task', 'my-submissions'])) as {
      taskId: string;
    }[];
    if (!mySubs.some((s) => s.taskId === taskId)) {
      throw new Error(`taskId ${taskId} not found in worker's my-submissions`);
    }
    ok('submission in my-submissions', true);

    // 12. task accept -- real X402 payment
    log('12/15', 'task accept (requester)...');
    const accepted = (await runCliData(requesterHome, [
      'task',
      'accept',
      taskId,
      '--worker',
      workerAddress,
    ])) as { accepted: boolean };
    if (!accepted.accepted) throw new Error('task accept did not return accepted:true');

    // Wait for the indexer to process the TaskCompleted event -- polled
    // entirely through `task get`, no direct API call.
    let completed = false;
    for (let i = 0; i < 20; i++) {
      const polled = (await runCliData(requesterHome, ['task', 'get', taskId])) as {
        status: string;
      };
      if (polled.status === 'completed') {
        completed = true;
        break;
      }
      await sleep(3000);
    }
    if (!completed) throw new Error(`task ${taskId} did not reach status completed`);
    ok('task accepted and completed', true);

    // 13. inbox for both requester and worker -- exercises the real keystore
    // decrypt path, the real read-auth signature, and two real HTTP calls
    // (/api/agents/inbox and /api/bids/my), reused from one signature.
    log('13/15', 'inbox (requester + worker)...');
    const reqInbox = (await runCliData(requesterHome, ['inbox'])) as {
      asRequester: { id: string }[];
    };
    if (!reqInbox.asRequester.some((t) => t.id === taskId)) {
      throw new Error(`taskId ${taskId} not found in requester's asRequester via CLI inbox`);
    }
    const workerInbox = (await runCliData(workerHome, ['inbox'])) as {
      asRequester: { id: string }[];
      asWorker: { id: string }[];
    };
    const inWorkerInbox =
      workerInbox.asWorker.some((t) => t.id === taskId) ||
      workerInbox.asRequester.some((t) => t.id === taskId);
    if (!inWorkerInbox) {
      throw new Error(`taskId ${taskId} not found in worker's inbox via CLI inbox`);
    }
    ok('task in requester + worker CLI inbox', true);

    // 14. encrypt / decrypt round trip through the wallet's ECIES keys
    log('14/15', 'encrypt + decrypt round trip (requester)...');
    await writeFile(plainFile, 'secret cli smoke payload\n', 'utf8');
    await runCliData(requesterHome, ['encrypt', plainFile, '--output', encFile]);
    await runCliData(requesterHome, ['decrypt', encFile, '--output', decFile]);
    const [plainContent, decContent] = await Promise.all([
      readFile(plainFile, 'utf8'),
      readFile(decFile, 'utf8'),
    ]);
    if (plainContent !== decContent) {
      throw new Error('encrypt/decrypt round trip produced different content');
    }
    ok('encrypt/decrypt roundtrip', true);

    // 15. The failure envelope, on the surface that consumes it.
    //
    // Everything above this point is a happy path, and that was the whole coverage of the CLI:
    // the fields an operator relies on when a paid write does *not* go through -- `status`,
    // `idempotencyKey`, `reason`, `pending` -- were asserted nowhere, on any transport. That
    // gap hid a real defect for two sandbox rounds: an `ApiError` thrown inside a procedure was
    // replaced by a generic 500 with its code and envelope discarded, so `pending` never
    // arrived and a caller obeying `docs/CLI_GUIDE.md` could not tell an in-flight write from a
    // refused one. The unit tests covered `renderFailure` given an envelope, and the smoke
    // covered the binary given success; nothing joined them.
    //
    // Reusing a key is the cheapest refusal to provoke that still exercises the whole chain --
    // the CLI's header, the backend's classification, the envelope, and the rendering -- and it
    // is the one an agent retrying a paid command hits first.
    log('15/15', 'idempotency key reuse is refused, with a machine-readable envelope...');
    const reusedKey = `smoke-cli-${randomUUID()}`;
    const createArgs = [
      'task',
      'create',
      '--description',
      'CLI smoke test idempotency reuse',
      '--reward',
      '0.001',
      '--duration',
      '1',
      '--mode',
      'bounty',
      '--tags',
      'smoke-cli',
    ];

    const firstCreate = (await runCliData(requesterHome, createArgs, {
      TASKMARKET_IDEMPOTENCY_KEY: reusedKey,
    })) as { taskId: string };
    ok('first create under a pinned key', firstCreate.taskId);

    const repeat = await runCliExpectingFailure(requesterHome, createArgs, {
      TASKMARKET_IDEMPOTENCY_KEY: reusedKey,
    });

    // The status is the assertion that would have failed while the envelope was being stripped:
    // a 5xx is what every generic retrying client reads as "send it again", which on a paid
    // write means paying twice.
    if (repeat.status === undefined || repeat.status >= 500) {
      throw new Error(
        `expected a 4xx on a reused idempotency key, got ${String(repeat.status)}: ${JSON.stringify(repeat)}`
      );
    }
    ok('repeat refused with a 4xx', repeat.status);

    // `reason` is the field ADR-0049 required a caller to branch on instead of string-matching
    // the message, so its presence is the point rather than its exact value -- the repeat may
    // land on any of the idempotency reasons depending on how far the first write got.
    if (repeat.reason === undefined) {
      throw new Error(`failure envelope carried no reason: ${JSON.stringify(repeat)}`);
    }
    if (!repeat.reason.startsWith('idempotency_key_')) {
      throw new Error(
        `expected an idempotency_key_* reason on a reused key, got ${repeat.reason}: ${JSON.stringify(repeat)}`
      );
    }
    ok('failure envelope reason', repeat.reason);

    // The key is the handle the operator is left holding: the intent id only ever arrives in a
    // response, and a failure is exactly the case where no response carried one.
    if (repeat.idempotencyKey !== reusedKey) {
      throw new Error(
        `expected the failure to name the key it was sent under (${reusedKey}), got ${String(repeat.idempotencyKey)}`
      );
    }
    ok('failure names its own idempotency key', repeat.idempotencyKey);

    // A refusal on a key already spent is terminal, not in flight. `pending: true` here would
    // tell a script to poll for a write that will never appear.
    if (repeat.pending !== false) {
      throw new Error(
        `expected pending:false on a refused repeat, got ${String(repeat.pending)}: ${JSON.stringify(repeat)}`
      );
    }
    ok('pending', repeat.pending);

    console.log('\n=== CLI smoke test passed ===');
    console.log('taskId:', taskId);
  } finally {
    await Promise.all([
      rm(requesterHome, { recursive: true, force: true }),
      rm(workerHome, { recursive: true, force: true }),
      rm(submissionFile, { force: true }),
      rm(plainFile, { force: true }),
      rm(encFile, { force: true }),
      rm(decFile, { force: true }),
    ]);
  }
}

main().catch((err) => {
  console.error('\nFatal:', err);
  process.exit(1);
});

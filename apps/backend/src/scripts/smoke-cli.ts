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
 *
 * Requires the CLI to be built first:
 *   pnpm --filter @lucid-agents/taskmarket build
 *
 * Usage:
 *   REQUESTER_PRIVATE_KEY=0x... WORKER_PRIVATE_KEY=0x... \
 *     npx tsx --env-file=../../.env src/scripts/smoke-cli.ts
 */
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
    log('1/14', 'wallet import (requester + worker)...');
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
    log('2/14', 'address (requester)...');
    const addrResult = (await runCliData(requesterHome, ['address'])) as { address: string };
    if (addrResult.address.toLowerCase() !== requesterAddress.toLowerCase()) {
      throw new Error(`address mismatch: got ${addrResult.address}`);
    }
    ok('address', addrResult.address);

    // 3. identity register -- real X402 payment via the CLI's own x402.ts,
    // minting or confirming an ERC-8004 identity for both wallets.
    log('3/14', 'identity register (requester + worker)...');
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
    log('4/14', 'identity status (requester)...');
    const idStatus = (await runCliData(requesterHome, ['identity', 'status'])) as {
      registered: boolean;
      agentId: string | null;
    };
    if (!idStatus.registered || idStatus.agentId !== reqIdentity.agentId) {
      throw new Error(`identity status mismatch: ${JSON.stringify(idStatus)}`);
    }
    ok('identity status registered', idStatus.registered);

    // 5. stats
    log('5/14', 'stats (requester)...');
    const stats = (await runCliData(requesterHome, ['stats'])) as {
      address: string;
      balanceUsdc: string;
    };
    if (stats.address.toLowerCase() !== requesterAddress.toLowerCase()) {
      throw new Error(`stats address mismatch: got ${stats.address}`);
    }
    ok('stats balanceUsdc', stats.balanceUsdc);

    // 6. wallet balance
    log('6/14', 'wallet balance (requester)...');
    const balance = (await runCliData(requesterHome, ['wallet', 'balance'])) as {
      balanceUsdc: string;
    };
    ok('wallet balance', balance.balanceUsdc);

    // 7. task create -- real X402 payment for the reward escrow
    log('7/14', 'task create (requester)...');
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
    log('8/14', 'task get (requester)...');
    const gotTask = (await runCliData(requesterHome, ['task', 'get', taskId])) as {
      id: string;
      status: string;
    };
    if (gotTask.id !== taskId) throw new Error(`task get id mismatch: ${gotTask.id}`);
    if (gotTask.status !== 'open') throw new Error(`expected status open, got ${gotTask.status}`);
    ok('task status', gotTask.status);

    // 9. task list
    log('9/14', 'task list (requester)...');
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
    log('10/14', 'task submit (worker)...');
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
    log('11/14', 'task my-submissions (worker)...');
    const mySubs = (await runCliData(workerHome, ['task', 'my-submissions'])) as {
      taskId: string;
    }[];
    if (!mySubs.some((s) => s.taskId === taskId)) {
      throw new Error(`taskId ${taskId} not found in worker's my-submissions`);
    }
    ok('submission in my-submissions', true);

    // 12. task accept -- real X402 payment
    log('12/14', 'task accept (requester)...');
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
    log('13/14', 'inbox (requester + worker)...');
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
    log('14/14', 'encrypt + decrypt round trip (requester)...');
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

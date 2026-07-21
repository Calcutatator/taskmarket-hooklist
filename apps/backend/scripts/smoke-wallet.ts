/**
 * Wallet import smoke test: exercises `taskmarket wallet import` via CLI source directly.
 *
 * Steps:
 *  1. Verify DEV_PRIVATE_KEY is set; derive expected address
 *  2. Backup ~/.taskmarket/keystore.json if it exists; remove it
 *  3. Import via --key flag; verify JSON output and address
 *  4. Remove keystore; import via TASKMARKET_IMPORT_KEY env var; verify same result
 *  5. Run `taskmarket address`; verify address matches expected
 *  6. Run import again (env var path); verify idempotent ok:true response
 *  7. Run with invalid key via --key; verify exits 1 with ok:false error
 *  8. Restore original keystore (finally block)
 *
 * Note: the interactive prompt path is not tested here (requires stdin interaction).
 *
 * Usage:
 *   DEV_PRIVATE_KEY=0x... npx tsx --env-file=../../.env scripts/smoke-wallet.ts
 */
import { execSync } from 'child_process';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { privateKeyToAccount } from 'viem/accounts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const KEYSTORE_PATH = path.join(os.homedir(), '.taskmarket', 'keystore.json');
const CLI_ENTRY = path.resolve(__dirname, '../../../apps/cli/src/index.ts');

function log(step: string, msg: string) {
  console.log(`\n[${step}] ${msg}`);
}

function ok(label: string, value: unknown) {
  console.log(`  ok ${label}:`, value);
}

interface RunResult {
  stdout: string;
  stderr: string;
  code: number;
}

function runCli(args: string, env: Record<string, string> = {}): RunResult {
  try {
    const stdout = execSync(`tsx ${CLI_ENTRY} ${args} 2>/dev/null`, {
      env: { ...process.env, ...env },
      encoding: 'utf8',
    });
    return { stdout, stderr: '', code: 0 };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; status?: number };
    return { stdout: e.stdout ?? '', stderr: e.stderr ?? '', code: e.status ?? 1 };
  }
}

function runCliCaptureStderr(args: string, env: Record<string, string> = {}): RunResult {
  try {
    // Redirect stdout to /dev/null to capture only stderr
    const stderr = execSync(`tsx ${CLI_ENTRY} ${args} 2>&1 1>/dev/null`, {
      env: { ...process.env, ...env },
      encoding: 'utf8',
    });
    return { stdout: '', stderr, code: 0 };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; status?: number };
    return { stdout: e.stdout ?? '', stderr: e.stderr ?? '', code: e.status ?? 1 };
  }
}

async function main() {
  const devKey = process.env['DEV_PRIVATE_KEY'] as `0x${string}`;
  if (!devKey) {
    console.error('Set DEV_PRIVATE_KEY');
    process.exit(1);
  }

  const account = privateKeyToAccount(devKey);
  const expectedAddress = account.address.toLowerCase();

  console.log('=== Taskmarket Smoke Test — Wallet Import ===');
  console.log('expected address:', expectedAddress);

  // Backup existing keystore
  let backup: string | null = null;
  try {
    backup = await fs.readFile(KEYSTORE_PATH, 'utf8');
  } catch {
    // no existing keystore — that is fine
  }

  try {
    // 2. Remove keystore before starting
    log('2', 'Removing keystore...');
    await fs.rm(KEYSTORE_PATH, { force: true });

    // 3. Import via --key flag
    log('3', 'Importing via --key flag...');
    const r3 = runCli(`wallet import --key ${devKey}`);
    if (r3.code !== 0) {
      throw new Error(`wallet import --key exited ${r3.code}:\n${r3.stdout}\n${r3.stderr}`);
    }
    const parsed3 = JSON.parse(r3.stdout.trim()) as {
      ok: boolean;
      data: { address: string; agentId: string | null };
    };
    if (!parsed3.ok) throw new Error(`Expected ok:true, got: ${r3.stdout}`);
    if (parsed3.data.address.toLowerCase() !== expectedAddress) {
      throw new Error(`Address mismatch: got ${parsed3.data.address}, expected ${expectedAddress}`);
    }
    ok('address (--key path)', parsed3.data.address);
    ok('agentId (--key path)', parsed3.data.agentId);

    // 4. Remove keystore; import via env var
    log('4', 'Removing keystore; importing via TASKMARKET_IMPORT_KEY env var...');
    await fs.rm(KEYSTORE_PATH, { force: true });
    const r4 = runCli('wallet import', { TASKMARKET_IMPORT_KEY: devKey });
    if (r4.code !== 0) {
      throw new Error(`wallet import (env var) exited ${r4.code}:\n${r4.stdout}\n${r4.stderr}`);
    }
    const parsed4 = JSON.parse(r4.stdout.trim()) as {
      ok: boolean;
      data: { address: string; agentId: string | null };
    };
    if (!parsed4.ok) throw new Error(`Expected ok:true, got: ${r4.stdout}`);
    if (parsed4.data.address.toLowerCase() !== expectedAddress) {
      throw new Error(`Address mismatch: got ${parsed4.data.address}, expected ${expectedAddress}`);
    }
    ok('address (env var path)', parsed4.data.address);
    ok('agentId (env var path)', parsed4.data.agentId);

    // 5. taskmarket address should match
    log('5', 'Verifying taskmarket address...');
    const r5 = runCli('address');
    if (r5.code !== 0) throw new Error(`address exited ${r5.code}:\n${r5.stdout}\n${r5.stderr}`);
    const parsed5 = JSON.parse(r5.stdout.trim()) as { ok: boolean; data: { address: string } };
    if (parsed5.data.address.toLowerCase() !== expectedAddress) {
      throw new Error(`address mismatch: got ${parsed5.data.address}`);
    }
    ok('address command', parsed5.data.address);

    // 6. Idempotent re-run (keystore already exists)
    log('6', 'Re-running import (keystore exists — should be idempotent)...');
    const r6 = runCli('wallet import', { TASKMARKET_IMPORT_KEY: devKey });
    if (r6.code !== 0) {
      throw new Error(`Idempotent import exited ${r6.code}:\n${r6.stdout}\n${r6.stderr}`);
    }
    const parsed6 = JSON.parse(r6.stdout.trim()) as { ok: boolean; data: { address: string } };
    if (!parsed6.ok) throw new Error(`Expected ok:true on re-run, got: ${r6.stdout}`);
    ok('idempotent re-run address', parsed6.data.address);

    // 7. Invalid key should exit 1 with ok:false
    log('7', 'Testing invalid key (should fail)...');
    const r7 = runCliCaptureStderr('wallet import --key 0x1234');
    if (r7.code === 0) throw new Error('Expected non-zero exit for invalid key');
    const stderrOut = r7.stderr;
    if (!stderrOut.includes('"ok":false') && !stderrOut.includes('"ok": false')) {
      throw new Error(`Expected ok:false error JSON on stderr, got:\n${stderrOut}`);
    }
    ok('invalid key rejected with ok:false', true);

    console.log('\n=== Wallet import smoke test passed ===');
  } finally {
    // 8. Restore original keystore
    if (backup !== null) {
      await fs.mkdir(path.dirname(KEYSTORE_PATH), { recursive: true });
      await fs.writeFile(KEYSTORE_PATH, backup, 'utf8');
      console.log('\nRestored original keystore.');
    } else {
      await fs.rm(KEYSTORE_PATH, { force: true });
      console.log('\nNo original keystore to restore; keystore removed.');
    }
  }
}

main().catch((err) => {
  console.error('\nFatal:', err);
  process.exit(1);
});

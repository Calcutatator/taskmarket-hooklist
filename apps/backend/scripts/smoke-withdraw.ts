/**
 * Withdraw smoke test: exercises `taskmarket wallet set-withdrawal-address` and
 * `taskmarket withdraw` via the CLI source directly.
 *
 * Steps:
 *  1. Verify DEV_PRIVATE_KEY and WITHDRAWAL_ADDRESS are set
 *  2. Ensure keystore exists (run `taskmarket init` or `taskmarket wallet import` first)
 *  3. Call set-withdrawal-address; verify JSON output contains withdrawalAddress
 *  4. Attempt set-withdrawal-address again; verify rejection with "already set" message
 *  5. Call withdraw 0.01; verify JSON output contains txHash, amountBaseUnits, to
 *
 * Prerequisites:
 *  - Agent wallet must have USDC balance >= 0.01 USDC on Base Sepolia
 *  - Run smoke-claim or fund wallet manually before this test
 *
 * Usage:
 *   DEV_PRIVATE_KEY=0x... WITHDRAWAL_ADDRESS=0x... npx tsx --env-file=../../.env scripts/smoke-withdraw.ts
 */
import { execSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
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
  const devKey = process.env['DEV_PRIVATE_KEY'];
  const withdrawalAddress = process.env['WITHDRAWAL_ADDRESS'];

  if (!devKey) {
    console.error('Set DEV_PRIVATE_KEY');
    process.exit(1);
  }
  if (!withdrawalAddress) {
    console.error('Set WITHDRAWAL_ADDRESS (the address to receive withdrawals)');
    process.exit(1);
  }

  console.log('=== Taskmarket Smoke Test — Withdraw ===');
  console.log('withdrawal address:', withdrawalAddress);

  // 3. Set withdrawal address
  log('3', `Setting withdrawal address to ${withdrawalAddress}...`);
  const r3 = runCli(`wallet set-withdrawal-address ${withdrawalAddress}`);
  if (r3.code !== 0) {
    // May already be set from a previous run — check stderr
    const stderrR3 = runCliCaptureStderr(`wallet set-withdrawal-address ${withdrawalAddress}`);
    if (stderrR3.stderr.includes('already set')) {
      ok('set-withdrawal-address (already set — acceptable)', true);
    } else {
      throw new Error(
        `set-withdrawal-address failed (${r3.code}):\n${r3.stdout}\n${stderrR3.stderr}`
      );
    }
  } else {
    const parsed3 = JSON.parse(r3.stdout.trim()) as {
      ok: boolean;
      data: { withdrawalAddress: string };
    };
    if (!parsed3.ok) throw new Error(`Expected ok:true, got: ${r3.stdout}`);
    if (parsed3.data.withdrawalAddress.toLowerCase() !== withdrawalAddress.toLowerCase()) {
      throw new Error(
        `withdrawalAddress mismatch: got ${parsed3.data.withdrawalAddress}, expected ${withdrawalAddress}`
      );
    }
    ok('withdrawalAddress set', parsed3.data.withdrawalAddress);

    // 4. Attempt second set-withdrawal-address — should be rejected
    log('4', 'Setting withdrawal address again (should fail with already set)...');
    const r4 = runCliCaptureStderr(`wallet set-withdrawal-address ${withdrawalAddress}`);
    if (r4.code === 0) {
      throw new Error('Expected non-zero exit for duplicate set-withdrawal-address');
    }
    if (!r4.stderr.includes('already set') && !r4.stderr.includes('CONFLICT')) {
      throw new Error(`Expected "already set" error, got:\n${r4.stderr}`);
    }
    ok('duplicate set rejected', true);
  }

  // 5. Withdraw 0.01 USDC
  log('5', 'Withdrawing 0.01 USDC...');
  const r5 = runCli('withdraw 0.01');
  if (r5.code !== 0) {
    const stderrR5 = runCliCaptureStderr('withdraw 0.01');
    throw new Error(`withdraw failed (${r5.code}):\n${r5.stdout}\n${stderrR5.stderr}`);
  }
  const parsed5 = JSON.parse(r5.stdout.trim()) as {
    ok: boolean;
    data: { txHash: string; amountBaseUnits: string; to: string };
  };
  if (!parsed5.ok) throw new Error(`Expected ok:true, got: ${r5.stdout}`);
  if (!parsed5.data.txHash || !parsed5.data.txHash.startsWith('0x')) {
    throw new Error(`Expected tx hash, got: ${parsed5.data.txHash}`);
  }
  if (parsed5.data.amountBaseUnits !== '10000') {
    throw new Error(`Expected 10000 base units, got: ${parsed5.data.amountBaseUnits}`);
  }
  ok('txHash', parsed5.data.txHash);
  ok('amountBaseUnits', parsed5.data.amountBaseUnits);
  ok('to', parsed5.data.to);

  console.log('\n=== Withdraw smoke test passed ===');
}

main().catch((err) => {
  console.error('\nFatal:', err);
  process.exit(1);
});

/**
 * Withdraw smoke test: exercises `taskmarket wallet set-withdrawal-address` and
 * `taskmarket withdraw` via the CLI source directly.
 *
 * Steps:
 *  1. Verify DEV_PRIVATE_KEY and WITHDRAWAL_ADDRESS are set
 *  2. Ensure keystore exists (run `taskmarket init` or `taskmarket wallet import` first)
 *  3. Call set-withdrawal-address; verify JSON output contains withdrawalAddress
 *  4. Attempt set-withdrawal-address again; verify rejection with "already set" message
 *  5. Attempt an over-balance withdrawal; verify its deterministic preflight revert
 *  6. Call withdraw 0.01; verify the relayer still works and returns a transaction hash
 *
 * Prerequisites:
 *  - Agent wallet must have USDC balance >= 0.01 USDC on Base Sepolia
 *  - Run smoke-claim or fund wallet manually before this test
 *
 * Usage:
 *   DEV_PRIVATE_KEY=0x... WITHDRAWAL_ADDRESS=0x... npx tsx --env-file=../../.env src/scripts/smoke-withdraw.ts
 */
import { execSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { privateKeyToAccount } from 'viem/accounts';
import { API_URL } from './_x402';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI_ENTRY = path.resolve(__dirname, '../../../../apps/cli/src/index.ts');

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
    const stdout = execSync(`tsx ${CLI_ENTRY} ${args}`, {
      env: { ...process.env, ...env },
      encoding: 'utf8',
    });
    return { stdout, stderr: '', code: 0 };
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
  // WITHDRAWAL_ADDRESS is interpolated into shell command strings below (runCli uses
  // execSync); a value containing shell metacharacters would execute as arbitrary
  // commands. Validating it as a plain hex address up front rules that out entirely,
  // regardless of where it's populated from.
  if (!/^0x[a-fA-F0-9]{40}$/.test(withdrawalAddress)) {
    console.error('WITHDRAWAL_ADDRESS must be a 0x-prefixed 20-byte hex address');
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

  // 5. Reproduce issue #54's trigger: a valid EIP-3009 authorization whose value exceeds
  // the source wallet's balance. This must fail during simulation without broadcasting or
  // advancing the server wallet's nonce.
  //
  // The amount is derived from the live balance rather than hardcoded. A fixed figure is
  // not reliably "over balance": the sandbox's mock USDC is re-minted on every
  // cloud-env-setup.sh run and never reset, so the wallet's balance grows without bound
  // across runs and can overtake any constant chosen here.
  log('5', 'Attempting an over-balance withdrawal (should fail before broadcast)...');
  const walletAddress = privateKeyToAccount(devKey as `0x${string}`).address;
  const balanceResponse = await fetch(`${API_URL}/api/wallet/balance?address=${walletAddress}`);
  if (!balanceResponse.ok) {
    throw new Error(`Could not read USDC balance for ${walletAddress}: ${balanceResponse.status}`);
  }
  const { balanceBaseUnits } = (await balanceResponse.json()) as { balanceBaseUnits: string };
  // The CLI takes whole USDC, so round the balance up to the next USDC and add a margin.
  const overBalanceUsdc = (BigInt(balanceBaseUnits) + 999_999n) / 1_000_000n + 1_000n;
  ok('current balance (base units)', balanceBaseUnits);

  const r5 = runCliCaptureStderr(`withdraw ${overBalanceUsdc}`);
  // Assert on the reported outcome, not just the exit code: the CLI surfaces a handled API
  // error as `{"ok":false,...}` on stdout (see the duplicate set-withdrawal-address case in
  // step 4), so an exit-code-only check can read a rejected withdrawal as a success.
  const r5Output = `${r5.stdout}\n${r5.stderr}`;
  const r5Succeeded = r5.code === 0 && !/"ok"\s*:\s*false/.test(r5.stdout);
  if (r5Succeeded) {
    throw new Error(
      `Expected the over-balance withdrawal of ${overBalanceUsdc} USDC to fail against a balance of ${balanceBaseUnits} base units, got:\n${r5Output}`
    );
  }
  // OpenZeppelin v5 reverts with the custom error ERC20InsufficientBalance rather than a
  // string reason, so match the custom-error name as well as the older string forms. If this
  // ever sees a bare selector instead of a name, the token's error ABI is missing from
  // ERC20_ABI in services/contract.ts and real API callers are getting an opaque 500 too.
  if (
    !/ERC20InsufficientBalance|exceeds balance|insufficient.*balance|transfer amount/i.test(
      r5Output
    )
  ) {
    throw new Error(`Expected an insufficient-balance revert, got:\n${r5Output}`);
  }
  ok('over-balance withdrawal rejected before broadcast', `${overBalanceUsdc} USDC`);

  // 6. The next valid transaction must succeed without restarting the backend. Before the
  // dispatcher fix, step 5 advanced viem's cached nonce without sending a transaction and
  // this call stayed pending behind the resulting nonce gap.
  log('6', 'Withdrawing 0.01 USDC after the failed preflight...');
  const r6 = runCli('withdraw 0.01');
  if (r6.code !== 0) {
    const stderrR6 = runCliCaptureStderr('withdraw 0.01');
    throw new Error(`withdraw failed (${r6.code}):\n${r6.stdout}\n${stderrR6.stderr}`);
  }
  const parsed6 = JSON.parse(r6.stdout.trim()) as {
    ok: boolean;
    data: { txHash: string; amountBaseUnits: string; to: string };
  };
  if (!parsed6.ok) throw new Error(`Expected ok:true, got: ${r6.stdout}`);
  if (!parsed6.data.txHash || !parsed6.data.txHash.startsWith('0x')) {
    throw new Error(`Expected tx hash, got: ${parsed6.data.txHash}`);
  }
  if (parsed6.data.amountBaseUnits !== '10000') {
    throw new Error(`Expected 10000 base units, got: ${parsed6.data.amountBaseUnits}`);
  }
  ok('txHash', parsed6.data.txHash);
  ok('amountBaseUnits', parsed6.data.amountBaseUnits);
  ok('to', parsed6.data.to);

  console.log('\n=== Withdraw smoke test passed ===');
}

main().catch((err) => {
  console.error('\nFatal:', err);
  process.exit(1);
});

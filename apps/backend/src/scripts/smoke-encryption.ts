/**
 * Encryption smoke test: exercises `taskmarket encrypt` and `taskmarket decrypt`
 * via CLI source, plus `taskmarket wallet publish-key`.
 *
 * Steps:
 *  1. Verify DEV_PRIVATE_KEY is set; ensure keystore exists (import if not)
 *  2. Self-encrypt a temp file; verify .enc output exists
 *  3. Decrypt .enc back; verify plaintext matches original
 *  4. Wrong extension default output (no .enc) → appends .dec
 *  5. --output flag overrides output path
 *  6. Decrypt with wrong key → exits 1 with ok:false error message
 *  7. wallet publish-key → uploads pubkey, returns ok:true with publicKey
 *  8. Encrypt --recipient (own address, key already published) → full round-trip
 *  9. Encrypt --recipient for unregistered address → exits 1 with helpful error
 * 10. Cleanup temp files; restore keystore if backed up
 *
 * Usage:
 *   DEV_PRIVATE_KEY=0x... npx tsx --env-file=../../.env src/scripts/smoke-encryption.ts
 */
import { execSync } from 'child_process';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';
import { privateKeyToAccount } from 'viem/accounts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const KEYSTORE_PATH = path.join(os.homedir(), '.taskmarket', 'keystore.json');
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

const CLI_API_URL =
  process.env.TASKMARKET_API_URL || process.env.API_URL || 'http://localhost:3000';

function runCli(args: string, env: Record<string, string> = {}): RunResult {
  try {
    const stdout = execSync(`tsx ${CLI_ENTRY} ${args}`, {
      env: { ...process.env, TASKMARKET_API_URL: CLI_API_URL, ...env },
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { stdout, stderr: '', code: 0 };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; status?: number };
    return { stdout: e.stdout ?? '', stderr: e.stderr ?? '', code: e.status ?? 1 };
  }
}

function parseResult(raw: string): { ok: boolean; data?: Record<string, unknown>; error?: string } {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error('Empty output');
  return JSON.parse(trimmed);
}

async function main() {
  const devKey = process.env['DEV_PRIVATE_KEY'] as `0x${string}`;
  if (!devKey) {
    console.error('Set DEV_PRIVATE_KEY');
    process.exit(1);
  }

  const account = privateKeyToAccount(devKey);
  const address = account.address;

  console.log('=== Taskmarket Smoke Test — File Encryption ===');
  console.log('api:     ', CLI_API_URL);
  console.log('address:', address);

  // Temp file paths
  const tmpDir = tmpdir();
  const plainFile = path.join(tmpDir, 'tm-smoke-plain.txt');
  const encFile = path.join(tmpDir, 'tm-smoke-plain.txt.enc');
  const decFile = path.join(tmpDir, 'tm-smoke-plain.txt');
  const altEncFile = path.join(tmpDir, 'tm-smoke-noext');
  const altDecFile = path.join(tmpDir, 'tm-smoke-noext.dec');
  const customOut = path.join(tmpDir, 'tm-smoke-custom.out');
  const recipientEncFile = path.join(tmpDir, 'tm-smoke-recipient.txt.enc');
  const recipientDecFile = path.join(tmpDir, 'tm-smoke-recipient-out.txt');

  const PLAINTEXT = 'hello taskmarket encryption smoke test 🔐';

  // Backup existing keystore
  let backup: string | null = null;
  try {
    backup = await fs.readFile(KEYSTORE_PATH, 'utf8');
  } catch {
    // no existing keystore
  }

  try {
    // 1. Always re-register against localhost (existing keystore may be from production)
    log('1', 'Registering device against localhost...');
    await fs.rm(KEYSTORE_PATH, { force: true });
    const r1 = runCli(`wallet import --key ${devKey}`);
    if (r1.code !== 0) throw new Error(`wallet import failed:\n${r1.stdout}\n${r1.stderr}`);
    ok('keystore registered', address);

    // Write plaintext temp file
    await fs.writeFile(plainFile, PLAINTEXT, 'utf8');

    // 2. Self-encrypt
    log('2', 'Encrypting file (self)...');
    const r2 = runCli(`encrypt ${plainFile}`);
    if (r2.code !== 0) throw new Error(`encrypt failed:\n${r2.stdout}\n${r2.stderr}`);
    const p2 = parseResult(r2.stdout);
    if (!p2.ok) throw new Error(`Expected ok:true: ${r2.stdout}`);
    if (!(p2.data?.output as string)?.endsWith('.enc')) {
      throw new Error(`Expected .enc output, got: ${p2.data?.output}`);
    }
    await fs.access(encFile); // verify file exists
    ok('output path', p2.data?.output);
    ok('bytes', p2.data?.bytes);
    ok('recipient', p2.data?.recipient);

    // 3. Decrypt back → plaintext matches
    log('3', `Decrypting ${encFile}...`);
    await fs.rm(decFile, { force: true }); // remove original so we're sure decrypt wrote it
    const r3 = runCli(`decrypt ${encFile}`);
    if (r3.code !== 0) throw new Error(`decrypt failed:\n${r3.stdout}\n${r3.stderr}`);
    const p3 = parseResult(r3.stdout);
    if (!p3.ok) throw new Error(`Expected ok:true: ${r3.stdout}`);
    const decrypted = await fs.readFile(decFile, 'utf8');
    if (decrypted !== PLAINTEXT) {
      throw new Error(`Plaintext mismatch: got "${decrypted}", expected "${PLAINTEXT}"`);
    }
    ok('decrypted bytes', p3.data?.bytes);
    ok('plaintext matches', true);

    // 4. Default output for file without .enc extension → appends .dec
    log('4', 'Testing default output for non-.enc file...');
    await fs.rm(altDecFile, { force: true });
    // Encrypt to a path with no .enc extension, then decrypt without --output → triggers .dec path
    const r4b = runCli(`encrypt ${plainFile} --output ${altEncFile}`);
    if (r4b.code !== 0)
      throw new Error(`encrypt to alt path failed:\n${r4b.stdout}\n${r4b.stderr}`);
    const r4c = runCli(`decrypt ${altEncFile}`);
    if (r4c.code !== 0) throw new Error(`decrypt alt path failed:\n${r4c.stdout}\n${r4c.stderr}`);
    const p4c = parseResult(r4c.stdout);
    if (!(p4c.data?.output as string)?.endsWith('.dec')) {
      throw new Error(`Expected .dec output for non-.enc file, got: ${p4c.data?.output}`);
    }
    ok('.dec extension appended', p4c.data?.output);

    // 5. --output flag
    log('5', 'Testing --output flag...');
    await fs.rm(customOut, { force: true });
    const r5 = runCli(`decrypt ${encFile} --output ${customOut}`);
    if (r5.code !== 0) throw new Error(`decrypt --output failed:\n${r5.stdout}\n${r5.stderr}`);
    await fs.access(customOut);
    ok('--output respected', customOut);

    // 6. Wrong key → graceful error
    log('6', 'Testing decryption with wrong key (corrupt enc file)...');
    // Corrupt the file by flipping a byte in the ciphertext area
    const encBuf = await fs.readFile(encFile);
    const corrupted = Buffer.from(encBuf);
    corrupted[corrupted.length - 1] ^= 0xff;
    const corruptedFile = path.join(tmpDir, 'tm-smoke-corrupted.enc');
    await fs.writeFile(corruptedFile, corrupted);
    const r6 = runCli(`decrypt ${corruptedFile}`);
    if (r6.code === 0) throw new Error('Expected non-zero exit for corrupted file');
    const errOutput = r6.stderr.trim();
    if (!errOutput.includes('Decryption failed')) {
      throw new Error(`Expected "Decryption failed" in stderr, got:\n${errOutput}`);
    }
    ok('corrupted file rejected with ok:false', true);

    // 7. wallet publish-key
    log('7', 'Publishing public key...');
    const r7 = runCli('wallet publish-key');
    if (r7.code !== 0) throw new Error(`publish-key failed:\n${r7.stdout}\n${r7.stderr}`);
    const p7 = parseResult(r7.stdout);
    if (!p7.ok) throw new Error(`Expected ok:true: ${r7.stdout}`);
    if (typeof p7.data?.publicKey !== 'string' || p7.data.publicKey.length < 60) {
      throw new Error(`Invalid publicKey in output: ${JSON.stringify(p7.data)}`);
    }
    ok('publicKey published', p7.data.publicKey);
    ok('publish-key idempotent (can re-run)', true);

    // 7b. publish-key again (idempotent)
    const r7b = runCli('wallet publish-key');
    if (r7b.code !== 0) throw new Error(`publish-key re-run failed:\n${r7b.stdout}\n${r7b.stderr}`);
    ok('re-run ok', true);

    // 8. Encrypt --recipient own address (key just published) → round-trip
    log('8', `Encrypting with --recipient ${address}...`);
    const r8 = runCli(`encrypt ${plainFile} --recipient ${address} --output ${recipientEncFile}`);
    if (r8.code !== 0) throw new Error(`encrypt --recipient failed:\n${r8.stdout}\n${r8.stderr}`);
    const p8 = parseResult(r8.stdout);
    if (!p8.ok) throw new Error(`Expected ok:true: ${r8.stdout}`);
    ok('recipient encrypt output', p8.data?.output);

    const r8d = runCli(`decrypt ${recipientEncFile} --output ${recipientDecFile}`);
    if (r8d.code !== 0)
      throw new Error(`decrypt (recipient) failed:\n${r8d.stdout}\n${r8d.stderr}`);
    const recipientDecrypted = await fs.readFile(recipientDecFile, 'utf8');
    if (recipientDecrypted !== PLAINTEXT) {
      throw new Error(`Recipient round-trip mismatch: "${recipientDecrypted}"`);
    }
    ok('recipient round-trip', true);

    // 9. Encrypt --recipient unregistered address → helpful error
    log('9', 'Encrypting for unregistered address (should fail with helpful message)...');
    const r9 = runCli('encrypt /dev/null --recipient 0x000000000000000000000000000000000000dEaD');
    if (r9.code === 0) throw new Error('Expected non-zero exit for unregistered recipient');
    const errOut9 = (r9.stderr + r9.stdout).trim();
    if (!errOut9.includes('public key')) {
      throw new Error(`Expected 'public key' hint in output, got:\n${errOut9}`);
    }
    ok('unregistered recipient error', true);

    console.log('\n=== Encryption smoke test passed ✓ ===');
  } finally {
    // Cleanup temp files
    for (const f of [
      plainFile,
      encFile,
      altEncFile,
      altDecFile,
      customOut,
      recipientEncFile,
      recipientDecFile,
      path.join(tmpDir, 'tm-smoke-corrupted.enc'),
      path.join(tmpDir, 'tm-smoke-noext.dec'),
    ]) {
      await fs.rm(f, { force: true });
    }

    // Restore keystore
    if (backup !== null) {
      await fs.mkdir(path.dirname(KEYSTORE_PATH), { recursive: true });
      await fs.writeFile(KEYSTORE_PATH, backup, 'utf8');
      console.log('Restored original keystore.');
    } else if (!backup) {
      await fs.rm(KEYSTORE_PATH, { force: true });
      console.log('No original keystore to restore; keystore removed.');
    }
  }
}

main().catch((err) => {
  console.error('\nFatal:', err);
  process.exit(1);
});

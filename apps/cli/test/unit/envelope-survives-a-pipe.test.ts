// Verifies: ADR-0058
//
// The failure envelope is the CLI's machine-readable output, and `2>&1 | jq` is how an agent
// consumes it -- so the envelope has to survive a pipe. Node writes to a pipe asynchronously
// (synchronously only to files and TTYs), and `process.exit` does not wait for that write to
// drain, so ending `renderFailure` with it could truncate or lose the envelope entirely. The field
// most worth not losing is `pending`: it is what tells a script whether re-running a failed write
// is a retry or a second payment.
//
// This test exists so that reinstating `process.exit` fails the build rather than silently
// reintroducing the loss. It spawns a real child process with stderr piped, because an in-process
// test cannot observe the difference.
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const CHILD = join(process.cwd(), 'test/unit/fixtures/render-failure-child.ts');
const TSX = join(process.cwd(), 'node_modules/.bin/tsx');

function runChild(): Promise<{ code: number | null; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(TSX, [CHILD], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stderr }));
  });
}

describe('the failure envelope written to a pipe', () => {
  it('arrives whole, and the process still exits 1', async () => {
    const { code, stderr } = await runChild();

    // Parsing at all is the assertion: a truncated write leaves invalid JSON.
    const envelope = JSON.parse(stderr.trim()) as Record<string, unknown>;

    expect(envelope).toMatchObject({
      ok: false,
      status: 409,
      reason: 'intent_in_flight',
      intentId: 'intent_123',
      idempotencyKey: 'key-abc',
      pending: true,
    });
    // The tail of a half-megabyte message, so this fails on a partial write rather than only on a
    // write that never started.
    expect(envelope.error).toMatch(/x{100}$/);
    expect(code).toBe(1);
  }, 30_000);
});

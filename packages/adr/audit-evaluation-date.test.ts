import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const PACKAGE_DIR = dirname(fileURLToPath(import.meta.url));
const AUDIT = join(PACKAGE_DIR, 'adr-audit.ts');

type Result = { driftCount: number; graceCount: number };

function auditAsOf(date: string): Result {
  const stdout = execFileSync('npx', ['tsx', AUDIT, `--as-of=${date}`], {
    cwd: PACKAGE_DIR,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  return JSON.parse(stdout) as Result;
}

describe('adr-audit --as-of', () => {
  // The corpus carries realized-by hash mismatches inside their grace window, so the same tree
  // reports them as tolerated now and as drift once the window has passed. Without a fixed
  // evaluation date that difference arrives on its own, and a commit that passed at merge fails
  // on re-run with nothing changed.
  it('gives one verdict per tree, decided by the supplied date', () => {
    const withinGrace = auditAsOf('2026-08-19');
    const afterGrace = auditAsOf('2026-12-01');

    expect(withinGrace.graceCount).toBeGreaterThan(0);
    expect(withinGrace.driftCount).toBe(0);
    expect(afterGrace.graceCount).toBe(0);
    expect(afterGrace.driftCount).toBe(withinGrace.graceCount);
  }, 120_000);

  it('rejects an unparseable date rather than falling back to the clock', () => {
    expect(() =>
      execFileSync('npx', ['tsx', AUDIT, '--as-of=yesterday'], { cwd: PACKAGE_DIR, stdio: 'ignore' })
    ).toThrow();
  }, 60_000);
});

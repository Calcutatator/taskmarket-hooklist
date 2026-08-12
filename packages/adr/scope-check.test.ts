import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

// CLI-level tests for scope-check.ts. checkScopeMismatch itself is a pure function tested in
// lib.test.ts; what is tested here is the thing that pure test cannot reach — whether the JSON on
// stdout lets a reader tell "I compared a diff and found nothing" apart from "I had no diff to
// compare". Both used to report status 'ok', which makes a clean result and a run that never
// happened indistinguishable on the machine-readable channel.

const PACKAGE_DIR = dirname(fileURLToPath(import.meta.url));

function runScopeCheck(env: Record<string, string>, args: string[] = []) {
  const stdout = execFileSync('npx', ['tsx', join(PACKAGE_DIR, 'scope-check.ts'), ...args], {
    cwd: PACKAGE_DIR,
    encoding: 'utf-8',
    // stderr is the human channel and carries the warning lines; only stdout is asserted here.
    stdio: ['ignore', 'pipe', 'ignore'],
    env: { ...process.env, ...env },
  });
  return JSON.parse(stdout) as {
    status: string;
    warnCount: number;
    filesExamined: number;
    scope: { source: string; base: string | null };
    issues: unknown[];
  };
}

describe('scope-check CLI: a clean run is distinguishable from a run that did not happen', () => {
  test('no base to compare against reports not-run, not ok', () => {
    const result = runScopeCheck({ SCOPE_CHECK_BASE: '' });
    expect(result.status).toBe('not-run');
    expect(result.filesExamined).toBe(0);
    expect(result.scope).toEqual({ source: 'none', base: null });
  });

  test('an explicit file list that is clean reports ok, and says what it examined', () => {
    const result = runScopeCheck({ SCOPE_CHECK_BASE: '' }, ['docs/adr/0001-fixture.md']);
    expect(result.status).toBe('ok');
    expect(result.filesExamined).toBe(1);
    expect(result.scope.source).toBe('argv');
    expect(result.issues).toEqual([]);
  });

  // The non-vacuity case: a check that has only ever been observed passing proves nothing about
  // its ability to fail. This plants the exact shape it exists to catch — a governance-path file
  // and an application-source file in one change.
  test('a governance path mixed with application source warns', () => {
    const result = runScopeCheck({ SCOPE_CHECK_BASE: '' }, [
      'docs/adr/0001-fixture.md',
      'apps/backend/src/server.ts',
    ]);
    expect(result.status).toBe('warn');
    expect(result.warnCount).toBeGreaterThan(0);
    expect(result.filesExamined).toBe(2);
  });
});

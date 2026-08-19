/**
 * Repository-history lookups behind a testable seam.
 *
 * Kept out of lib.ts, which is the pure, unit-testable core, and out of adr-audit.ts, which runs a
 * CLI on import. Taking the repository root as an argument is what lets this be exercised against a
 * purpose-built repository rather than only against the corpus it ships in — a test that can run
 * only against the shipped records cannot pin the dates it asserts.
 */

import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

// Implements: ADR-0094
/**
 * The date a record's stated Embodiment last changed value.
 *
 * `-G`, not `-S`: `-S` counts occurrences of the string, and editing a field's value leaves that
 * count unchanged, so `-S` skips the very commits this exists to find and returns the one that
 * introduced the field — the record's creation date presented as the age of its current claim.
 */
export function statedEmbodimentLastChanged(
  repoRoot: string,
  adrDir: string,
  number: string
): string | null {
  let matches: string[];
  try {
    matches = readdirSync(adrDir).filter((f) => f.startsWith(`${number}-`) && f.endsWith('.md'));
  } catch {
    return null;
  }
  if (matches.length !== 1) return null;
  try {
    const out = execFileSync(
      'git',
      [
        'log',
        '-1',
        '--format=%ad',
        '--date=short',
        '-G',
        '^\\s*-\\s+\\*\\*Embodiment:\\*\\*',
        '--',
        relative(repoRoot, join(adrDir, matches[0])),
      ],
      { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
    ).trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(out) ? out : null;
  } catch {
    return null;
  }
}

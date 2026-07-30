#!/usr/bin/env node
// CLI wrapper for the ADR linter. Checking logic lives in lib.ts (unit
// tested in lib.test.ts); this file just reads docs/adr/, prints, and exits.
//
// Blocking (exit 1): filename format, valid Status, Date present, all four
// required sections, no duplicate numbers, Y-statement structural keywords,
// at least one rejected alternative in Considered options, supersession-link
// symmetry/direction for Accepted-lineage ADRs, no dangling ADR-NNNN
// cross-references, and an Accepted ADR must have a real (non-blank,
// non-placeholder) Deciders value.
//
// Warn-only: README index completeness, relevant source changes without a
// corresponding ADR change (pass changed paths as argv, or set ADR_LINT_BASE
// to have this script compute them via `git diff` itself — argv wins if both
// are given), gaps in ADR numbering, an Accepted ADR with a blank/placeholder
// Reviewers value, an Author/Deciders or Author/Reviewers "self-ack smell",
// and a still-Proposed ADR's provisional supersession claim missing its
// Pending Supersedes / Superseded-by reciprocation on the peer side.

import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lintAdrDir, formatIssueLine, formatGithubAnnotation, normalizeIssueFilePath } from './lib.js';

// Repo root is two levels up from packages/adr/.
const PACKAGE_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(PACKAGE_DIR, '..', '..');
const ADR_DIR = join(PACKAGE_DIR, '..', '..', 'docs', 'adr');

function getChangedFiles(): string[] {
  const argvFiles = process.argv.slice(2);
  if (argvFiles.length > 0) return argvFiles;

  const base = process.env.ADR_LINT_BASE;
  if (!base) return [];

  try {
    // execFileSync with an argument array — not the shell — so ADR_LINT_BASE can never be
    // interpreted as shell syntax, no matter what it contains.
    const diff = execFileSync('git', ['diff', '--name-only', `${base}...HEAD`], {
      cwd: REPO_ROOT,
      encoding: 'utf-8',
    });
    return diff.split('\n').filter((f) => f.trim().length > 0);
  } catch (e) {
    // ADR_LINT_BASE was explicitly requested (CI sets it on every PR run) — a failed
    // diff here means a misconfiguration (bad ref, shallow clone), not "nothing changed".
    // Fail loudly rather than silently downgrading to an integrity-only run.
    console.error(`  ERROR  ADR_LINT_BASE="${base}" git diff failed: ${(e as Error).message}`);
    process.exit(1);
  }
}

function runCli(adrDir: string, changedFiles: string[]): void {
  const { issues, adrFiles } = lintAdrDir(adrDir, changedFiles, REPO_ROOT);

  for (const issue of issues) {
    console.log(formatIssueLine(issue));
    // Surface as PR annotations when running in GitHub Actions; warnings stay non-blocking.
    if (process.env.GITHUB_ACTIONS) {
      console.log(formatGithubAnnotation(issue, normalizeIssueFilePath(issue.file, 'docs/adr')));
    }
  }

  const errorCount = issues.filter((i) => i.type === 'ERROR').length;
  const warnCount = issues.filter((i) => i.type === 'WARN').length;
  if (adrFiles.length > 0) {
    if (errorCount === 0 && warnCount === 0) {
      console.log(`  ${adrFiles.length} ADR(s) OK`);
    } else if (errorCount === 0) {
      console.log(`  ${adrFiles.length} ADR(s) OK (${warnCount} warning(s))`);
    } else {
      console.log(`\n  ${errorCount} error(s), ${warnCount} warning(s)`);
    }
  } else {
    console.log('ADR lint passed (0 ADRs checked).');
  }

  process.exit(errorCount > 0 ? 1 : 0);
}

runCli(ADR_DIR, getChangedFiles());

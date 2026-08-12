#!/usr/bin/env node
// CLI wrapper for checkScopeMismatch (lib.ts). Checking logic lives in lib.ts (unit tested in
// lib.test.ts); this file just computes the diff and prints.
//
// Warn-only, never blocking: flags when a diff touches a governance path (docs/adr/, docs/rfc/,
// docs/specs/, or this package's own tooling under packages/adr/) alongside non-test application
// source in the same diff -- the "a docs-scoped branch quietly also carried a production
// behavior change" case (the incident that motivated PR #370: a branch titled and scoped as an
// ADR-governance pass also carried a real, live-trading-affecting code change, undetected by any
// tooling until a human reviewer noticed the diff by eye). This does not decide whether the
// bundled change is actually a problem -- a governance pass legitimately does sometimes need a
// real, small code fix -- it surfaces "this needs elevated review beyond docs review" so that
// call gets made deliberately, not by omission.
//
// Usage:
//   SCOPE_CHECK_BASE=origin/main pnpm --filter @taskmarket/adr run scope-check
//   pnpm --filter @taskmarket/adr run scope-check -- file1.ts file2.ts   (explicit file list, argv wins)

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkScopeMismatch, resolveGitDiffChangedFiles, formatIssueLine } from './lib.js';

const PACKAGE_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(PACKAGE_DIR, '..', '..');

// What the run actually compared, so a clean result can be told apart from a run that had
// nothing to compare. Both currently report status 'ok' on stdout, which is the agent-facing
// channel -- a "0 findings" that isn't evidence the check ran is the failure mode this repo's
// own spec singles out, and it applies to a check's machine-readable output as much as to its
// prose. `source` names where the file list came from; `base` is the ref diffed against.
type Scope = { source: 'argv' | 'git-diff' | 'none'; base: string | null };
let scope: Scope = { source: 'none', base: null };

function getChangedFiles(): string[] {
  const argvFiles = process.argv.slice(2);
  if (argvFiles.length > 0) {
    scope = { source: 'argv', base: null };
    return argvFiles;
  }

  const base = process.env.SCOPE_CHECK_BASE;
  if (!base) {
    // Expected on a push event, where there is no PR base to compare against. Not a failure --
    // but not a clean bill of health either, and the output must say which it is.
    scope = { source: 'none', base: null };
    return [];
  }
  scope = { source: 'git-diff', base };

  try {
    return resolveGitDiffChangedFiles(REPO_ROOT, base);
  } catch (e) {
    // Requested via SCOPE_CHECK_BASE -- a failed diff means a misconfiguration (bad ref, shallow
    // clone), not "nothing changed". Fail loudly rather than silently downgrading to a no-op run.
    console.error(`  ERROR  SCOPE_CHECK_BASE="${base}" git diff failed: ${(e as Error).message}`);
    console.log(JSON.stringify({ status: 'error', reason: 'scope_check_base_diff_failed', message: (e as Error).message }, null, 2));
    process.exit(1);
  }
}

function runCli(changedFiles: string[]): void {
  const issues = checkScopeMismatch(changedFiles);

  for (const issue of issues) {
    console.error(formatIssueLine(issue));
    if (process.env.GITHUB_ACTIONS) {
      console.error(`::warning file=${issue.file}::${issue.message}`);
    }
  }

  if (issues.length === 0) {
    console.error(
      changedFiles.length > 0
        ? `No governance/application-source scope mismatch (${changedFiles.length} changed file(s) examined against ${scope.base ?? 'the given file list'}).`
        : 'No changed files to check — SCOPE_CHECK_BASE is unset, so nothing was compared. This is not the same as a clean diff.'
    );
  }

  // Warn-only by design (see file header) -- never exits 1. stdout carries the same pure-data
  // JSON convention as adr-lint.ts/adr-audit.ts for an agent/script consumer.
  console.log(
    JSON.stringify(
      {
        // 'not-run' rather than 'ok' when nothing was compared: an agent reading this must not
        // treat "I had no base" as "I checked and it was fine".
        status: issues.length > 0 ? 'warn' : scope.source === 'none' ? 'not-run' : 'ok',
        warnCount: issues.length,
        filesExamined: changedFiles.length,
        scope,
        issues,
      },
      null,
      2
    )
  );
}

runCli(getChangedFiles());

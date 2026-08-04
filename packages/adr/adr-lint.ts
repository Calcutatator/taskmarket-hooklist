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

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  lintAdrDir,
  lintRfcDir,
  formatIssueLine,
  formatGithubAnnotation,
  normalizeIssueFilePath,
  resolveGitDiffChangedFiles,
  resolveTrackedSourceFiles,
  coerceScope,
  type LintScope,
} from './lib.js';

// Repo root is two levels up from packages/adr/.
const PACKAGE_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(PACKAGE_DIR, '..', '..');
const ADR_DIR = join(PACKAGE_DIR, '..', '..', 'docs', 'adr');
const RFC_DIR = join(PACKAGE_DIR, '..', '..', 'docs', 'rfc');
const SCOPE_CONFIG = join(PACKAGE_DIR, 'adr-lint.config.json');

// Which files the Implements gate scans: only this push's diff, or every tracked
// source file. Precedence: ADR_LINT_SCOPE env > adr-lint.config.json > built-in
// default ('whole-corpus'), so a missing/malformed config never narrows coverage.
function resolveScope(): LintScope {
  const fromEnv = coerceScope(process.env.ADR_LINT_SCOPE);
  if (fromEnv) return fromEnv;
  try {
    const fromFile = coerceScope((JSON.parse(readFileSync(SCOPE_CONFIG, 'utf8')) as { scope?: string }).scope);
    if (fromFile) return fromFile;
  } catch {
    // missing or malformed config -> fall through to the safe default
  }
  return 'whole-corpus';
}

function getChangedFiles(): string[] {
  const argvFiles = process.argv.slice(2);
  if (argvFiles.length > 0) return argvFiles;

  const base = process.env.ADR_LINT_BASE;
  if (!base) return [];

  try {
    return resolveGitDiffChangedFiles(REPO_ROOT, base);
  } catch (e) {
    // ADR_LINT_BASE was explicitly requested (CI sets it on every PR run) — a failed
    // diff here means a misconfiguration (bad ref, shallow clone), not "nothing changed".
    // Fail loudly rather than silently downgrading to an integrity-only run.
    console.error(`  ERROR  ADR_LINT_BASE="${base}" git diff failed: ${(e as Error).message}`);
    console.log(JSON.stringify({ status: 'error', reason: 'adr_lint_base_diff_failed', message: (e as Error).message }, null, 2));
    process.exit(1);
  }
}

// stdout is a pure data channel: exactly one JSON object, always carrying a `status` field,
// meant for the agent/script that's actually the primary consumer of this tool. Everything a
// human would scan while iterating locally -- the per-issue WARN/ERROR lines, GitHub Actions
// annotations, the summary line -- goes to stderr instead, so `pnpm lint:check` piped through
// `| jq` (or read by an agent) gets clean JSON with no prose mixed in, while a human running it
// directly in a terminal still sees everything (stdout and stderr both render there).
function runCli(adrDir: string, changedFiles: string[], gateFiles: string[]): void {
  const { issues: adrIssues, adrFiles } = lintAdrDir(adrDir, changedFiles, REPO_ROOT, gateFiles);
  // RFCs are not structurally linted (see lintRfcDir's own doc comment) -- only index
  // freshness is checked here, the same mechanical property enforced for ADRs.
  const { issues: rfcIssues, rfcFiles } = lintRfcDir(RFC_DIR, REPO_ROOT);
  const issues = [...adrIssues, ...rfcIssues];

  for (const issue of issues) {
    console.error(formatIssueLine(issue));
    // Surface as PR annotations when running in GitHub Actions; warnings stay non-blocking.
    if (process.env.GITHUB_ACTIONS) {
      console.error(formatGithubAnnotation(issue, normalizeIssueFilePath(issue.file, 'docs/adr')));
    }
  }

  const errorCount = issues.filter((i) => i.type === 'ERROR').length;
  const warnCount = issues.filter((i) => i.type === 'WARN').length;
  if (adrFiles.length > 0) {
    if (errorCount === 0 && warnCount === 0) {
      console.error(`  ${adrFiles.length} ADR(s) OK`);
    } else if (errorCount === 0) {
      console.error(`  ${adrFiles.length} ADR(s) OK (${warnCount} warning(s))`);
    } else {
      console.error(`\n  ${errorCount} error(s), ${warnCount} warning(s)`);
    }
  } else {
    console.error('ADR lint passed (0 ADRs checked).');
  }
  console.error(`  ${rfcFiles.length} RFC(s) checked (index freshness only)`);

  const status = errorCount > 0 ? 'error' : warnCount > 0 ? 'warn' : 'ok';
  console.log(JSON.stringify({ status, errorCount, warnCount, adrCount: adrFiles.length, rfcCount: rfcFiles.length, issues }, null, 2));

  process.exit(errorCount > 0 ? 1 : 0);
}

const scope = resolveScope();
const changedFiles = getChangedFiles();
// In whole-corpus mode the gate scans every tracked source file, independent of
// this push's diff; in diff mode it scans only the changed files. The coverage
// warning always keys off the actual changed files, so it is unaffected.
const gateFiles = scope === 'whole-corpus' ? resolveTrackedSourceFiles(REPO_ROOT) : changedFiles;
runCli(ADR_DIR, changedFiles, gateFiles);

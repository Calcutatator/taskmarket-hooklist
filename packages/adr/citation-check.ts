#!/usr/bin/env node
// CLI wrapper for citation-existence checking introduced by PR #370. Checking logic lives in lib.ts
// (unit tested in lib.test.ts); this file discovers documents, computes existence, and prints.
//
// Built after a real false-positive finding earlier in this harness's own development: a
// generated document cited a real spec file, a naive existence check reported it as missing (the
// file was real, sitting in an open, not-yet-merged PR, invisible to the current checkout), and
// that was wrongly asserted as a fabricated reference and "fixed" by deleting a true citation.
//
// Two scopes checked, each honestly labeled rather than collapsed into one boolean:
//   - File paths: checked against the current working tree (existsSync). A WARN here means
//     exactly "not found in the working tree", not "does not exist anywhere" -- see the message
//     text itself.
//   - Issue/PR numbers: checked against the real repo via `gh api`'s issues endpoint (which
//     GitHub returns for both plain issues and pull requests -- a PR is a special kind of issue
//     in its own data model), so it resolves regardless of merge state -- an open, unmerged PR
//     still resolves as real, and so does a plain issue reference. A first live run against this
//     repo's real corpus checked only the pulls endpoint and misreported several real, closed
//     *issue* citations as fake PRs -- fixed by checking the issues endpoint instead, which
//     covers both.
//
// Warn-only, never blocking -- matches this repo's own blocking-vs-warn calibration for a
// content-accuracy issue rather than a governance-accountability gap.
//
// Usage:
//   pnpm --filter @taskmarket/adr run citation-check                    # docs/adr + docs/rfc + docs/specs
//   pnpm --filter @taskmarket/adr run citation-check -- path/to/file.md # explicit files

import { existsSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  type Issue,
  extractReferencesSection,
  extractCitedFilePaths,
  extractCitedGithubNumbers,
  checkFilePathCitations,
  checkGithubNumberCitations,
  formatIssueLine,
  isDocDirMemberFile,
  pathIsInsideRootReal,
} from './lib.js';

const PACKAGE_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(PACKAGE_DIR, '..', '..');
const DOC_DIRS = ['docs/adr', 'docs/rfc', 'docs/specs'];

function discoverDocFiles(): string[] {
  const files: string[] = [];
  for (const dir of DOC_DIRS) {
    const abs = join(REPO_ROOT, dir);
    if (!existsSync(abs)) continue;
    for (const name of readdirSync(abs)) {
      if (isDocDirMemberFile(name)) files.push(join(dir, name));
    }
  }
  return files;
}

// gh's own resolution is scoped to whatever repo the token/CLI session is authenticated against,
// but this script only ever runs inside this repo's own CI/local checkout, so hardcoding the
// owner/repo here (rather than parsing it from `git remote`) keeps this simple.
const GH_REPO = 'daydreamsai/taskmarket';

// The issues endpoint, not pulls -- GitHub returns both plain issues and pull requests through
// it (a PR is a special kind of issue in GitHub's own data model), so this correctly resolves
// either kind of "#NNN" citation. See the file header for the real false positive this fixed.
const githubNumberExistenceCache = new Map<string, boolean>();
function githubNumberExists(n: string): boolean {
  const cached = githubNumberExistenceCache.get(n);
  if (cached !== undefined) return cached;
  let exists: boolean;
  try {
    execFileSync('gh', ['api', `repos/${GH_REPO}/issues/${n}`], { stdio: ['ignore', 'ignore', 'pipe'] });
    exists = true;
  } catch (e) {
    // `gh api` exits non-zero for ANY HTTP error, so rate-limit, network, and
    // auth failures are indistinguishable from a real 404 at the exit-code level.
    // Only a genuine 404 means the number doesn't exist; for anything else we
    // can't tell, so treat the citation as resolved rather than emit a false
    // "not found" WARN on a transient failure. The 404 signal is in stderr.
    const stderr = (e as { stderr?: Buffer | string })?.stderr?.toString() ?? '';
    exists = !/\b404\b|not found/i.test(stderr);
  }
  githubNumberExistenceCache.set(n, exists);
  return exists;
}

function ghAvailable(): boolean {
  try {
    execFileSync('gh', ['auth', 'status'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function main(): void {
  const argvFiles = process.argv.slice(2);
  const targets = argvFiles.length > 0 ? argvFiles : discoverDocFiles();
  const checkGithubNumbers = ghAvailable();
  if (!checkGithubNumbers) {
    console.error('gh CLI not authenticated/available — skipping issue/PR-citation checks (file-path checks still run).');
  }

  const issues: Issue[] = [];
  for (const relPath of targets) {
    const absPath = join(REPO_ROOT, relPath);
    if (!existsSync(absPath)) continue;
    const content = readFileSync(absPath, 'utf-8');
    const refs = extractReferencesSection(content);
    if (!refs) continue;

    const paths = extractCitedFilePaths(refs);
    // Confine the existence probe to the repo: a cited path like `../../../etc/x`
    // must never let the check stat files outside REPO_ROOT (a file-existence
    // oracle driven by `## References` content). Symlink-aware — a path lexically
    // inside the repo but symlinked out still resolves to false — and doubles as
    // the existence check (realpath throws for a missing path).
    issues.push(
      ...checkFilePathCitations(
        paths,
        relPath,
        (p) => pathIsInsideRootReal(REPO_ROOT, p, realpathSync),
        'the current working tree',
      ),
    );

    if (checkGithubNumbers) {
      const numbers = extractCitedGithubNumbers(refs);
      issues.push(...checkGithubNumberCitations(numbers, relPath, githubNumberExists));
    }
  }

  for (const issue of issues) {
    console.error(formatIssueLine(issue));
    if (process.env.GITHUB_ACTIONS) {
      console.error(`::warning file=${issue.file}::${issue.message}`);
    }
  }
  if (issues.length === 0) {
    console.error(`${targets.length} document(s) checked, no citation issues.`);
  }

  // Warn-only by design (see file header) -- never exits 1. stdout carries the same pure-data
  // JSON convention as adr-lint.ts/adr-audit.ts/scope-check.ts for an agent/script consumer.
  console.log(JSON.stringify({ status: issues.length > 0 ? 'warn' : 'ok', warnCount: issues.length, issues }, null, 2));
}

main();

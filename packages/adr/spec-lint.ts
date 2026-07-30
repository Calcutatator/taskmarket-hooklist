#!/usr/bin/env node
// CLI wrapper for the Spec-lite structural linter. Checking logic lives in
// lib.ts (unit tested in lib.test.ts); this file just reads docs/specs/,
// prints, and exits.
//
// Blocking (exit 1): all required sections present (by content, checked
// against an alias list per section); Status is one of Draft/Ready/
// Superseded (only checked when a Status field is present at all); Date is a
// valid YYYY-MM-DD (same conditional-presence rule).
//
// Warn-only: a stated "**Implements ADRs:** ADR-NNNN" reference that doesn't
// resolve to a real ADR file (dangling reference).
//
// Deliberately not checked: filename/numbering convention, and section
// ordering — sections in this repo's specs are unnumbered by design.

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  lintSpecs,
  formatIssueLine,
  formatGithubAnnotation,
  normalizeIssueFilePath,
  resolveGitTrackedOrStagedFiles,
  type SpecFile,
} from './lib.js';

const PACKAGE_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(PACKAGE_DIR, '..', '..');
const SPEC_DIR = join(REPO_ROOT, 'docs', 'specs');
const ADR_DIR = join(REPO_ROOT, 'docs', 'adr');

// `repoRoot` scopes discovery to git-tracked-or-staged files (see
// resolveGitTrackedOrStagedFiles in lib.ts) so an untracked scratch .md file
// doesn't get swept into corpus-wide checks; defaults to `specDir` itself,
// since git discovers the actual repository root by walking upward. Falls
// back to the raw, unfiltered directory listing when `specDir` isn't inside
// a git repo at all (e.g. a bare tmpdir fixture).
function discoverSpecs(specDir: string, repoRoot: string = specDir): SpecFile[] {
  let entries: string[];
  try {
    entries = readdirSync(specDir);
  } catch {
    return [];
  }
  const trackedFiles = resolveGitTrackedOrStagedFiles(specDir, repoRoot);
  return entries
    .filter((f) => f.endsWith('.md') && f !== 'README.md' && !f.startsWith('_'))
    .filter((f) => trackedFiles === null || trackedFiles.has(join(specDir, f)))
    .sort()
    .map((f) => ({
      path: join('docs', 'specs', f),
      text: readFileSync(join(specDir, f), 'utf-8'),
    }));
}

// Same git-scoping as discoverSpecs above.
function discoverAdrNumbers(adrDir: string, repoRoot: string = adrDir): Set<string> {
  let entries: string[];
  try {
    entries = readdirSync(adrDir);
  } catch {
    return new Set();
  }
  const trackedFiles = resolveGitTrackedOrStagedFiles(adrDir, repoRoot);
  const numbers = new Set<string>();
  for (const f of entries) {
    if (trackedFiles !== null && !trackedFiles.has(join(adrDir, f))) continue;
    const m = /^(\d{4})-/.exec(f);
    if (m) numbers.add(m[1]);
  }
  return numbers;
}

function runCli(specDir: string, adrDir: string): void {
  const specs = discoverSpecs(specDir, REPO_ROOT);
  const adrNumbers = discoverAdrNumbers(adrDir, REPO_ROOT);
  const { issues, specFiles } = lintSpecs(specs, adrNumbers);

  for (const issue of issues) {
    console.log(formatIssueLine(issue));
    if (process.env.GITHUB_ACTIONS) {
      console.log(formatGithubAnnotation(issue, normalizeIssueFilePath(issue.file, 'docs/specs')));
    }
  }

  const errorCount = issues.filter((i) => i.type === 'ERROR').length;
  const warnCount = issues.filter((i) => i.type === 'WARN').length;
  if (specFiles.length > 0) {
    if (errorCount === 0 && warnCount === 0) {
      console.log(`  ${specFiles.length} spec(s) OK`);
    } else if (errorCount === 0) {
      console.log(`  ${specFiles.length} spec(s) OK (${warnCount} warning(s))`);
    } else {
      console.log(`\n  ${errorCount} error(s), ${warnCount} warning(s)`);
    }
  } else {
    console.log('Spec lint passed (0 specs checked).');
  }

  process.exit(errorCount > 0 ? 1 : 0);
}

runCli(SPEC_DIR, ADR_DIR);

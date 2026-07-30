#!/usr/bin/env node
// Implements: ADR-0032
/**
 * ADR embodiment audit — reconciles each ADR's stated Embodiment against grep
 * evidence in specs, code, and tests. See docs/adr/README.md's "Embodiment
 * (realization tracking)" section for the full rationale.
 *
 * Scans:
 *   - docs/adr/*.md              for each ADR's Status + stated Embodiment
 *   - docs/specs/*.md            for "**Implements ADRs:** ADR-NNNN" back-pointers
 *   - apps/**\/*.ts, apps/**\/*.tsx, packages/**\/*.ts, packages/**\/*.tsx — for
 *     "Implements: ADR-NNNN" / "Verifies: ADR-NNNN" (this repo's own tooling
 *     under packages/ is part of the system's architecture too, not excluded)
 *
 * A .test.ts/.spec.ts file's back-pointers count as test refs; every other
 * scanned code file's count as code refs.
 *
 * docs/rfc/ is deliberately NOT scanned — an RFC is a pre-decision proposal; it
 * never itself "implements" a decision, only specs/code/tests that come after a
 * decision do.
 *
 * Usage:
 *   pnpm --filter @taskmarket/adr run adr-audit
 *
 * Output (always exit 0 — informational, never blocking):
 *   docs/adr-audit/report.md    human-readable full report
 *   docs/adr-audit/summary.json structured data, consumed by the PR-comment
 *                               posting step in CI
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import {
  type AdrAuditEntry,
  CODE_IMPLEMENTS_RE,
  CODE_VERIFIES_RE,
  SPEC_IMPLEMENTS_ADRS_RE,
  buildAuditSummary,
  computeDrift,
  computeEmbodiment,
  parseAdrFilenameNumber,
  parseAdrHeaderFields,
  resolveGitTrackedOrStagedFiles,
} from './lib.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.join(__dirname, '..', '..');
const ADR_DIR = path.join(REPO_ROOT, 'docs', 'adr');
const SPECS_DIR = path.join(REPO_ROOT, 'docs', 'specs');
// The whole `packages/` tree, not just product-facing packages — this repo's
// own tooling (this audit script included) is still part of the system's
// architecture and can carry real Implements:/Verifies: back-pointers too.
const CODE_ROOTS = [path.join(REPO_ROOT, 'apps'), path.join(REPO_ROOT, 'packages')];
const SKIP_DIR_NAMES = new Set(['node_modules', 'dist', 'build', '.turbo', '.next', 'coverage', '.git']);
const SOURCE_EXT = new Set(['.ts', '.tsx']);
const TEST_FILE_RE = /\.(test|spec)\.tsx?$/;

// `trackedFiles` scopes the walk to what git tracks or has staged under the
// root this call started at (see resolveGitTrackedOrStagedFiles in lib.ts);
// null (git unavailable) falls back to the raw filesystem walk unchanged.
// Passed through the recursion rather than recomputed per-directory since
// it's already scoped to the whole root subtree.
function walkFiles(root: string, trackedFiles: Set<string> | null): string[] {
  const out: string[] = [];
  if (!fs.existsSync(root)) return out;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIR_NAMES.has(entry.name)) continue;
      out.push(...walkFiles(full, trackedFiles));
    } else if (SOURCE_EXT.has(path.extname(entry.name))) {
      if (trackedFiles === null || trackedFiles.has(full)) out.push(full);
    }
  }
  return out;
}

function discoverAdrs(): Map<string, { status: string; statedEmbodiment: string }> {
  const adrs = new Map<string, { status: string; statedEmbodiment: string }>();
  const trackedFiles = resolveGitTrackedOrStagedFiles(ADR_DIR, REPO_ROOT);
  for (const name of fs.readdirSync(ADR_DIR)) {
    const number = parseAdrFilenameNumber(name);
    if (number === null) continue;
    if (trackedFiles !== null && !trackedFiles.has(path.join(ADR_DIR, name))) continue;
    const content = fs.readFileSync(path.join(ADR_DIR, name), 'utf-8');
    adrs.set(number, parseAdrHeaderFields(content));
  }
  return adrs;
}

function scanSpecs(entries: Map<string, AdrAuditEntry>): void {
  if (!fs.existsSync(SPECS_DIR)) return;
  const trackedFiles = resolveGitTrackedOrStagedFiles(SPECS_DIR, REPO_ROOT);
  for (const name of fs.readdirSync(SPECS_DIR)) {
    if (!name.endsWith('.md')) continue;
    if (trackedFiles !== null && !trackedFiles.has(path.join(SPECS_DIR, name))) continue;
    const content = fs.readFileSync(path.join(SPECS_DIR, name), 'utf-8');
    const m = SPEC_IMPLEMENTS_ADRS_RE.exec(content);
    if (!m) continue;
    const nums = [...m[1].matchAll(/ADR-(\d{4})/g)].map((mm) => mm[1]);
    for (const num of nums) {
      entries.get(num)?.specRefs.push(`docs/specs/${name}`);
    }
  }
}

function scanCode(entries: Map<string, AdrAuditEntry>): void {
  for (const root of CODE_ROOTS) {
    const trackedFiles = resolveGitTrackedOrStagedFiles(root, REPO_ROOT);
    for (const file of walkFiles(root, trackedFiles)) {
      const content = fs.readFileSync(file, 'utf-8');
      const rel = path.relative(REPO_ROOT, file);
      const isTest = TEST_FILE_RE.test(file);

      // Dedupe per (adrNumber, category): a file with two "Implements: ADR-0078" comments
      // for the same ADR would otherwise push the same rel twice, inflating the reported
      // Code/Tests counts and producing duplicate-looking "Code: a.ts, a.ts" detail lines.
      const seen = new Set<string>();

      CODE_IMPLEMENTS_RE.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = CODE_IMPLEMENTS_RE.exec(content)) !== null) {
        const key = `impl:${m[1]}`;
        if (seen.has(key)) continue;
        seen.add(key);
        entries.get(m[1])?.codeRefs.push(rel);
      }

      CODE_VERIFIES_RE.lastIndex = 0;
      while ((m = CODE_VERIFIES_RE.exec(content)) !== null) {
        const key = `${isTest ? 'test' : 'verify-code'}:${m[1]}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const target = isTest ? entries.get(m[1])?.testRefs : entries.get(m[1])?.codeRefs;
        target?.push(rel);
      }
    }
  }
}

function renderReport(entries: AdrAuditEntry[]): string {
  const today = new Date().toISOString().slice(0, 10);
  const sorted = [...entries].sort((a, b) => a.number.localeCompare(b.number));
  const lines: string[] = [
    `# ADR Audit Report — ${today}`,
    '',
    'Generated by `packages/adr/adr-audit.ts`.',
    "Reconciles each ADR's stated `Embodiment` against grep evidence in specs, code, and tests.",
    '',
    '## Summary',
    '',
    '| ADR | Status | Stated | Computed | Drift? | Specs | Code | Tests |',
    '|---|---|---|---|---|---|---|---|',
  ];
  for (const e of sorted) {
    const computed = computeEmbodiment(e);
    const drift = computeDrift(e);
    lines.push(
      `| ADR-${e.number} | ${e.status} | ${e.statedEmbodiment} | ${computed} | ${drift ? '⚠️' : '✓'} | ${e.specRefs.length} | ${e.codeRefs.length} | ${e.testRefs.length} |`
    );
  }
  lines.push('');

  const drifts = sorted.filter((e) => computeDrift(e));
  if (drifts.length > 0) {
    lines.push('## Drift alerts', '');
    for (const e of drifts) {
      lines.push(`### ADR-${e.number}`, `- **Drift**: ${computeDrift(e)}`);
      if (e.specRefs.length) lines.push(`- Specs: ${e.specRefs.join(', ')}`);
      if (e.codeRefs.length) lines.push(`- Code: ${e.codeRefs.join(', ')}`);
      if (e.testRefs.length) lines.push(`- Tests: ${e.testRefs.join(', ')}`);
      lines.push('');
    }
  }

  return lines.join('\n');
}

function main(): void {
  const statusByNum = discoverAdrs();
  console.error(`Found ${statusByNum.size} ADRs. Scanning specs and code...`);

  const entries = new Map<string, AdrAuditEntry>();
  for (const [number, { status, statedEmbodiment }] of statusByNum) {
    entries.set(number, { number, status, statedEmbodiment, specRefs: [], codeRefs: [], testRefs: [] });
  }

  scanSpecs(entries);
  scanCode(entries);

  const entryList = [...entries.values()];
  const report = renderReport(entryList);
  const today = new Date().toISOString().slice(0, 10);
  const summary = buildAuditSummary(entryList, today);

  const outDir = path.join(REPO_ROOT, 'docs', 'adr-audit');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'report.md'), report, 'utf-8');
  fs.writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify(summary, null, 2) + '\n', 'utf-8');
  console.error(`Wrote ${path.join(outDir, 'report.md')}`);
  console.error(`Wrote ${path.join(outDir, 'summary.json')}`);

  const driftCount = entryList.filter((e) => computeDrift(e)).length;
  console.error(`Drift alerts: ${driftCount}`);
}

main();

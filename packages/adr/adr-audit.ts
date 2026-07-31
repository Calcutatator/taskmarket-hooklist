#!/usr/bin/env node
// Implements: ADR-0032
/**
 * ADR embodiment audit — reconciles each ADR's stated Embodiment against grep
 * evidence in specs, code, and tests. See docs/adr/README.md's "Embodiment
 * (realization tracking)" section for the full rationale.
 *
 * Scans:
 *   - docs/adr/*.md              for each ADR's Status + stated Embodiment, and an optional
 *                                 "**Realized by:** <path>@<hash>[, ...]" record-side pointer
 *   - docs/specs/*.md            for "**Implements ADRs:** ADR-NNNN" back-pointers
 *   - the whole repo (codeScanRoots defaults to '.', configurable in .adrrc.json) — for
 *     .ts/.tsx files' "Implements: ADR-NNNN" / "Verifies: ADR-NNNN" comments, plus every
 *     file under .adrrc.json's commentForbiddenPaths regardless of extension (see below)
 *
 * A .test.ts/.spec.ts file's back-pointers count as test refs; every other
 * scanned code file's count as code refs.
 *
 * docs/rfc/ is deliberately NOT scanned for evidence — an RFC is a pre-decision proposal; it
 * never itself "implements" a decision, only specs/code/tests that come after a decision do.
 * But a decision whose own realization is something a comment can't (or shouldn't) live in —
 * a GitHub Actions YAML workflow, or a Solidity contract under packages/contracts where this
 * repo's own convention forbids the Implements: comment style in favor of revNNN versioning,
 * since that package is mirrored publicly and an internal governance reference has no
 * business in the published source — has one self-referential way out: "**Realized by:**"
 * names its own realization path(s) directly, checked for existence AND (when a hash is
 * recorded) content match, independent of the normal comment-scanning entirely.
 *
 * .adrrc.json's commentForbiddenPaths (glob patterns) names exactly which paths that
 * convention applies to. A comment found there never counts as embodiment evidence, but is
 * flagged in its own right as a convention violation (see the "Comment-convention
 * violations" report section) — so an agent or developer editing packages/contracts or a
 * .yml workflow gets a clear signal to use Realized-by instead of a comment, rather than the
 * comment just silently doing nothing.
 *
 * The optional "@<hash>" suffix is a git-native content hash (`git hash-object`)
 * — this is what catches the case a plain existence check can't: someone edits
 * the realizing file without touching the ADR at all — the path still exists,
 * but what it says may no longer match the decision. A hash mismatch doesn't
 * fail the audit immediately (a real change isn't automatically a broken
 * decision); it's tolerated for REALIZED_BY_STALE_GRACE_DAYS (see lib.ts) as a
 * "go re-verify soon" signal in the report, then counts as real drift once that
 * grace period elapses without the ADR being re-confirmed. See --refresh
 * below for the re-confirm step.
 *
 * Comma-separated paths are AND-required — all must be fresh, or none count as
 * evidence, so a genuinely multi-part decision can't get credit for a claim
 * about its weakest missing/stale part.
 *
 * Run with --refresh to detect drifted Realized-by locators — read-only, prints a JSON report
 * to stdout (one entry per drifted locator, with an id/status/hash pair) and writes nothing.
 * Review each entry, then re-run with --refresh --ids "<id,id,...>" --by "<name>" to apply only
 * the reviewed IDs, or --refresh --force --by "<name>" to apply every currently-drifted locator
 * without per-ID review. Applying rewrites the matching locator's recorded hash to match the
 * file's current content and bumps that ADR's Last audited to today, annotated with who
 * attested to it. --by is resolved automatically (gh api user, then git config user.name) when
 * omitted, and required by default when neither resolves (an anonymous, unaccountable refresh
 * defeats the point); pass --no-attestation to explicitly opt out. Applying never touches a
 * locator outside the selected set.
 *
 * Usage:
 *   pnpm --filter @taskmarket/adr run adr-audit
 *
 * Output (exit 0, informational, unless --fail-on-drift is passed):
 *   docs/adr-audit/report.md    human-readable full report
 *   docs/adr-audit/summary.json structured data, consumed by the PR-comment
 *                               posting step in CI
 *
 * Pass --fail-on-drift to exit 1 when any ADR's stated Embodiment disagrees with what
 * Implements:/Verifies: back-pointers actually compute -- opt-in strictness for CI/pre-commit,
 * default behavior unchanged for local/interactive use. See .claude/hooks/check-adr-embodiment.mjs
 * for the editor-level equivalent of this same check, applied before a single edit lands rather
 * than at commit/push time.
 */

import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import {
  type AdrAuditEntry,
  type RealizedByLocator,
  CODE_IMPLEMENTS_RE,
  CODE_VERIFIES_RE,
  LAST_AUDITED_RE,
  REALIZED_BY_RE,
  REALIZED_BY_STALE_GRACE_DAYS,
  SPEC_IMPLEMENTS_ADRS_RE,
  TEST_FILE_RE,
  buildAuditSummary,
  checkRealizedByLocator,
  computeDrift,
  computeEmbodiment,
  fieldValue,
  findCommentAdrRefs,
  formatRealizedByLocators,
  matchesAnyGlob,
  parseAdrFilenameNumber,
  parseAdrHeaderFields,
  parseDocIndexEntry,
  renderDocIndexList,
  renderDocIndexYaml,
  ADR_INDEX_MARKER_RE,
  ADR_INDEX_FRESHNESS_OPTIONS,
  RFC_INDEX_MARKER_RE,
  RFC_INDEX_FRESHNESS_OPTIONS,
  resolveGitTrackedOrStagedFiles,
  resolveRealizedByRefs,
  stripIgnoredLines,
} from './lib.js';

// Git-native content hash: `git hash-object` computes the exact blob SHA git itself would
// assign this file's current working-tree content (uncommitted edits included) — directly
// comparable to `git cat-file`/`git log` output, rather than a bespoke hash algorithm this
// tool would need to maintain on its own. git is already a hard dependency of this tool
// (resolveGitTrackedOrStagedFiles), so there's no fallback/abstraction here — if git isn't
// available, that's a real environment problem, not a case to degrade gracefully around.
function currentFileHash(absPath: string): string | null {
  if (!fs.existsSync(absPath)) return null;
  return execFileSync('git', ['hash-object', '--', absPath], { encoding: 'utf-8' }).trim();
}

// Last audited can carry a trailing attestation annotation after the date (see
// applyRealizedByRefresh) — only the leading YYYY-MM-DD token is ever meaningful for staleness math.
const LEADING_ISO_DATE_RE = /(\d{4}-\d{2}-\d{2})/;

function daysBetween(fromRaw: string, toISODate: string): number {
  const fromDateOnly = LEADING_ISO_DATE_RE.exec(fromRaw)?.[1];
  const from = fromDateOnly ? Date.parse(fromDateOnly) : NaN;
  const to = Date.parse(toISODate);
  if (Number.isNaN(from) || Number.isNaN(to)) return Number.POSITIVE_INFINITY; // unparsable date -> never in grace
  return Math.floor((to - from) / (1000 * 60 * 60 * 24));
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.join(__dirname, '..', '..');
const ADR_DIR = path.join(REPO_ROOT, 'docs', 'adr');
const RFC_DIR = path.join(REPO_ROOT, 'docs', 'rfc');
const SPECS_DIR = path.join(REPO_ROOT, 'docs', 'specs');
const SKIP_DIR_NAMES = new Set(['node_modules', 'dist', 'build', '.turbo', '.next', 'coverage', '.git']);
const SOURCE_EXT = new Set(['.ts', '.tsx']);

interface AdrToolConfig {
  // Days a Realized-by hash mismatch is tolerated before it counts as real drift.
  realizedByStaleGraceDays?: number;
  // Scan roots (relative to repo root) for Implements:/Verifies: back-pointer evidence.
  // Defaults to the whole repo ('.') — narrow this only if a repo genuinely wants to scope
  // scanning down (e.g. for noise or performance), since the default already covers
  // everything and there's nothing meaningful to "add" on top of it.
  codeScanRoots?: string[];
  // Whether applying a --refresh requires an attestor identity by default. true unless a repo
  // explicitly opts out here — --no-attestation on the CLI is still always available
  // per-invocation regardless of this setting.
  requireAttestationForRefresh?: boolean;
  // Glob patterns (relative to repo root, matched against the file's full relative path)
  // naming where this repo's own convention forbids an Implements:/Verifies: comment —
  // e.g. a public-mirror package where internal governance references shouldn't leak into
  // the published source, or a file format this repo doesn't want ADR comments in at all.
  // Checked in the same scan pass as normal evidence collection: a comment found under one
  // of these paths never counts as embodiment evidence, but is flagged as its own
  // convention violation — see scanCode below.
  commentForbiddenPaths?: string[];
}

// Checked-in tool config (`.adrrc.json` at repo root) — a reviewable, versioned override for
// tolerance/scan policy that would otherwise only be visible by reading this file's source.
// Absent file, or an absent/invalid key within it, falls back to the hardcoded defaults below;
// a malformed file is a real config error and is allowed to throw, not silently ignored.
function loadConfig(): AdrToolConfig {
  const configPath = path.join(REPO_ROOT, '.adrrc.json');
  if (!fs.existsSync(configPath)) return {};
  return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
}

const CONFIG = loadConfig();
const REALIZED_BY_GRACE_DAYS = CONFIG.realizedByStaleGraceDays ?? REALIZED_BY_STALE_GRACE_DAYS;
const REQUIRE_ATTESTATION_FOR_REFRESH = CONFIG.requireAttestationForRefresh ?? true;
// Whole-repo by default — a decision can be realized (or wrongly commented-on) anywhere,
// and a curated allowlist of directories is exactly the kind of fixed scan-root gap this
// tool's own Realized-by mechanism exists to work around (see the module doc comment).
const CODE_ROOTS = (CONFIG.codeScanRoots ?? ['.']).map((r) => path.join(REPO_ROOT, r));
const COMMENT_FORBIDDEN_PATHS = CONFIG.commentForbiddenPaths ?? [];

// `trackedFiles` scopes the walk to what git tracks or has staged under the
// root this call started at (see resolveGitTrackedOrStagedFiles in lib.ts);
// null (git unavailable) falls back to the raw filesystem walk unchanged.
// Passed through the recursion rather than recomputed per-directory since
// it's already scoped to the whole root subtree. A file matching
// COMMENT_FORBIDDEN_PATHS is walked regardless of extension — it needs to be inspected for
// a stray comment even when its language (e.g. .sol, .yml) isn't one this repo's normal
// back-pointer convention scans.
function walkFiles(root: string, trackedFiles: Set<string> | null): string[] {
  const out: string[] = [];
  if (!fs.existsSync(root)) return out;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (SKIP_DIR_NAMES.has(entry.name)) continue;
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkFiles(full, trackedFiles));
    } else if (SOURCE_EXT.has(path.extname(entry.name)) || matchesAnyGlob(path.relative(REPO_ROOT, full), COMMENT_FORBIDDEN_PATHS)) {
      if (trackedFiles === null || trackedFiles.has(full)) out.push(full);
    }
  }
  return out;
}

interface DiscoveredAdr {
  status: string;
  statedEmbodiment: string;
  realizedByLocators: RealizedByLocator[];
  lastAudited: string | null;
  filePath: string;
}

function discoverAdrs(): Map<string, DiscoveredAdr> {
  const adrs = new Map<string, DiscoveredAdr>();
  const trackedFiles = resolveGitTrackedOrStagedFiles(ADR_DIR, REPO_ROOT);
  for (const name of fs.readdirSync(ADR_DIR)) {
    const number = parseAdrFilenameNumber(name);
    if (number === null) continue;
    const filePath = path.join(ADR_DIR, name);
    if (trackedFiles !== null && !trackedFiles.has(filePath)) continue;
    const content = fs.readFileSync(filePath, 'utf-8');
    const { status, statedEmbodiment, realizedByLocators, lastAudited } = parseAdrHeaderFields(content);
    adrs.set(number, { status, statedEmbodiment, realizedByLocators, lastAudited, filePath });
  }
  return adrs;
}

// Implements: ADR-0033
// Regenerates <dir>/index.yaml and splices the rendered list into <dir>/README.md's marker
// block — the structured source of truth plus its rendered view, generalized across doc kinds
// rather than duplicated per kind. checkDocIndexFreshness (via lintAdrDir/lintRfcDir in lib.ts)
// is what actually blocks a push/CI run if someone forgot to re-run this.
function regenerateDocIndex(dir: string, files: string[], markerRe: RegExp, yamlOptions: Parameters<typeof renderDocIndexYaml>[1]): void {
  const entries = files.map((file) => parseDocIndexEntry(file, fs.readFileSync(path.join(dir, file), 'utf-8')));
  fs.writeFileSync(path.join(dir, 'index.yaml'), renderDocIndexYaml(entries, yamlOptions), 'utf-8');

  const readmePath = path.join(dir, 'README.md');
  if (!fs.existsSync(readmePath)) return;
  const readme = fs.readFileSync(readmePath, 'utf-8');
  const m = markerRe.exec(readme);
  if (!m) return;
  const updated = readme.slice(0, m.index) + m[1] + '\n' + renderDocIndexList(entries) + '\n' + m[3] + readme.slice(m.index + m[0].length);
  if (updated !== readme) fs.writeFileSync(readmePath, updated, 'utf-8');
}

function regenerateAdrIndex(discovered: Map<string, DiscoveredAdr>): void {
  const files = [...discovered.values()].map((adr) => path.basename(adr.filePath));
  regenerateDocIndex(ADR_DIR, files, ADR_INDEX_MARKER_RE, ADR_INDEX_FRESHNESS_OPTIONS.yamlOptions);
}

// RFCs aren't otherwise scanned/discovered by this audit (docs/rfc/ is deliberately excluded
// from evidence-scanning — see the module doc comment) — this is the one place RFC files get
// walked at all, purely to regenerate the index, independent of everything else this tool does.
function regenerateRfcIndex(): void {
  if (!fs.existsSync(RFC_DIR)) return;
  const tracked = resolveGitTrackedOrStagedFiles(RFC_DIR, REPO_ROOT);
  const files = fs
    .readdirSync(RFC_DIR)
    .filter((f) => f.endsWith('.md') && f !== 'README.md' && !f.startsWith('_'))
    .filter((f) => tracked === null || tracked.has(path.join(RFC_DIR, f)));
  regenerateDocIndex(RFC_DIR, files, RFC_INDEX_MARKER_RE, RFC_INDEX_FRESHNESS_OPTIONS.yamlOptions);
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

// Returns forbidden-path violations found: file -> ADR numbers referenced by a comment that
// shouldn't be there per commentForbiddenPaths. Mutates `entries` in place for normal
// evidence, matching scanSpecs()'s existing convention.
function scanCode(entries: Map<string, AdrAuditEntry>): Map<string, string[]> {
  const violations = new Map<string, string[]>();
  for (const root of CODE_ROOTS) {
    const trackedFiles = resolveGitTrackedOrStagedFiles(root, REPO_ROOT);
    for (const file of walkFiles(root, trackedFiles)) {
      const rel = path.relative(REPO_ROOT, file);
      // Blank any line carrying ADR_SCAN_IGNORE_MARKER before matching — a fixture/example
      // string that merely looks like a back-pointer comment (this package's own tests for
      // CODE_IMPLEMENTS_RE/findCommentAdrRefs, for instance) shouldn't count as real
      // evidence just because the file happens to fall under a whole-repo scan.
      const content = stripIgnoredLines(fs.readFileSync(file, 'utf-8'));

      // A comment under a forbidden path never counts as embodiment evidence — flag it as
      // its own convention violation instead of feeding it into codeRefs/testRefs below.
      if (matchesAnyGlob(rel, COMMENT_FORBIDDEN_PATHS)) {
        const nums = findCommentAdrRefs(content);
        if (nums.length > 0) violations.set(rel, nums);
        continue;
      }

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
  return violations;
}

// Checks each ADR's own "**Realized by:**" locators for existence + (when a hash is recorded)
// content freshness, independent of CODE_ROOTS entirely — closes the .yml/.sol blind spot:
// adr-audit.ts's scanCode() only ever walks .ts/.tsx files, and one repo convention here
// additionally forbids the Implements: comment style inside packages/contracts (a public
// mirror using revNNN versioning instead), so a decision realized in either can never
// register no matter how it's annotated. AND semantics: every listed locator must be fresh,
// or none of them count as evidence, so a genuinely multi-part claim can't get credit for
// its weakest missing/stale part. Returns which ADRs have a still-in-grace hash mismatch,
// for the report and for --refresh to detect.
function scanRealizedBy(entries: Map<string, AdrAuditEntry>, discovered: Map<string, DiscoveredAdr>): Map<string, string[]> {
  const staleByNum = new Map<string, string[]>();
  const today = new Date().toISOString().slice(0, 10);
  for (const [num, adr] of discovered) {
    if (adr.realizedByLocators.length === 0) continue;
    const daysSinceAudited = adr.lastAudited ? daysBetween(adr.lastAudited, today) : Number.POSITIVE_INFINITY;
    const { refs, staleWarnings } = resolveRealizedByRefs(
      adr.realizedByLocators,
      (l) => currentFileHash(path.join(REPO_ROOT, l)),
      daysSinceAudited,
      REALIZED_BY_GRACE_DAYS
    );
    for (const ref of refs) {
      entries.get(num)?.codeRefs.push(ref);
    }
    if (staleWarnings.length > 0) staleByNum.set(num, staleWarnings);
  }
  return staleByNum;
}

interface DriftEntry {
  id: string;
  record: string;
  locator: string;
  recordedHash: string;
  currentHash: string;
  daysSinceLastAudited: number;
  status: 'in_grace' | 'past_grace';
}

interface DriftReport {
  generated: string;
  driftCount: number;
  pastGraceCount: number;
  entries: DriftEntry[];
}

// Read-only: walks every ADR's Realized-by locators and reports which ones have drifted (current
// file hash no longer matches the recorded one), whether still in grace or already past it.
// Writes nothing — this is the "detect" half of the detect/apply split. Same shape convention as
// buildAuditSummary's AuditSummary (a top-level `generated` timestamp + status-bearing entries,
// not pre-rendered prose): meant to be consumed by a reviewer (human or agent) deciding which IDs
// to apply, not read as a report on its own.
function detectRealizedByDrift(discovered: Map<string, DiscoveredAdr>): DriftReport {
  const today = new Date().toISOString().slice(0, 10);
  const entries: DriftEntry[] = [];
  for (const [num, adr] of discovered) {
    const daysSinceLastAudited = adr.lastAudited ? daysBetween(adr.lastAudited, today) : Number.POSITIVE_INFINITY;
    adr.realizedByLocators.forEach((l, i) => {
      if (l.hash === null) return; // no hash tracked for this locator -> nothing to detect
      const current = currentFileHash(path.join(REPO_ROOT, l.path));
      const result = checkRealizedByLocator(l, current, daysSinceLastAudited, REALIZED_BY_GRACE_DAYS);
      if (!result.hashChanged || current === null) return;
      entries.push({
        id: `adr-${num}/realized_by/${i}`,
        record: `ADR-${num}`,
        locator: l.path,
        recordedHash: l.hash,
        currentHash: current,
        daysSinceLastAudited,
        status: result.fresh ? 'in_grace' : 'past_grace',
      });
    });
  }
  return {
    generated: today,
    driftCount: entries.length,
    pastGraceCount: entries.filter((e) => e.status === 'past_grace').length,
    entries,
  };
}

// Mutating: for every drifted locator selected by `filter`, rewrite the owning ADR's own
// "**Realized by:**" field with the current hash and bump "**Last audited:**" to today,
// annotated with who attested to it. This is the "apply" half — the explicit, reviewed (or
// explicitly forced) "I looked at this change, it's fine, re-baseline it" step. Never touches a
// locator that isn't selected by `filter`, and never touches a locator whose hash still matches.
function applyRealizedByRefresh(discovered: Map<string, DiscoveredAdr>, filter: (entry: DriftEntry) => boolean, attestedBy: string): number {
  const drift = detectRealizedByDrift(discovered);
  const selected = drift.entries.filter(filter);
  const today = new Date().toISOString().slice(0, 10);
  const byRecord = new Map<string, DriftEntry[]>();
  for (const entry of selected) {
    if (!byRecord.has(entry.record)) byRecord.set(entry.record, []);
    byRecord.get(entry.record)!.push(entry);
  }

  let refreshedCount = 0;
  for (const [record, entries] of byRecord) {
    const num = record.replace(/^ADR-/, '');
    const adr = discovered.get(num);
    if (!adr) continue;
    const byIndex = new Map(entries.map((e) => [Number(e.id.split('/').pop()), e]));
    const updated: RealizedByLocator[] = adr.realizedByLocators.map((l, i) => {
      const entry = byIndex.get(i);
      return entry ? { path: l.path, hash: entry.currentHash } : l;
    });

    let content = fs.readFileSync(adr.filePath, 'utf-8');
    // fieldRegex's capture group runs up to the next "- **"/"##" boundary, so it can include
    // trailing whitespace (e.g. the blank line before "## Context" when this is the last
    // header field) — replacing the whole match with a bare new value silently eats that
    // whitespace. Preserve it explicitly rather than reconstructing the match from scratch.
    content = content.replace(REALIZED_BY_RE, (...args: string[]) => {
      const trailingWs = args[1].match(/\s*$/)?.[0] ?? '';
      return `**Realized by:** ${formatRealizedByLocators(updated)}${trailingWs}`;
    });
    // Fail loudly rather than silently proceeding: String.replace() on a non-matching regex is
    // a no-op, which would apply the Realized-by hash update above while quietly dropping the
    // Last-audited attestation this whole refresh is supposed to record. Every ADR carries this
    // field already (required by adr-lint.ts), so a miss here means something is genuinely
    // malformed, not a normal case to paper over with a guessed insertion point.
    if (!LAST_AUDITED_RE.test(content)) {
      throw new Error(`${adr.filePath}: no "Last audited" field found -- cannot record this refresh's attestation`);
    }
    content = content.replace(LAST_AUDITED_RE, (...args: string[]) => {
      const trailingWs = args[1].match(/\s*$/)?.[0] ?? '';
      return `**Last audited:** ${today} (Realized-by hash refresh attested by ${attestedBy})${trailingWs}`;
    });
    fs.writeFileSync(adr.filePath, content, 'utf-8');
    refreshedCount++;
  }
  return refreshedCount;
}

// Resolves who to credit an apply's attestation to. Tries, in order: the explicit --by override
// (when given, always wins), then the authenticated `gh` CLI login (can't be locally spoofed the
// way a string literal can — it's tied to whatever credential the invoking session actually
// holds), then `git config user.name` (still self-reported, but sourced from the operator's own
// configured identity rather than typed fresh per invocation). Returns null only when none of the
// three produced anything.
function resolveAttestorIdentity(explicitBy: string | undefined): string | null {
  if (explicitBy) return explicitBy;
  try {
    const login = execFileSync('gh', ['api', 'user', '--jq', '.login'], { encoding: 'utf-8' }).trim();
    if (login) return `${login} (via gh)`;
  } catch {
    // gh not installed, not authenticated, or offline -- fall through
  }
  try {
    const name = execFileSync('git', ['config', 'user.name'], { encoding: 'utf-8' }).trim();
    if (name) return `${name} (via git config)`;
  } catch {
    // no git config user.name set -- fall through
  }
  return null;
}

function renderReport(
  entries: AdrAuditEntry[],
  staleByNum: Map<string, string[]> = new Map(),
  commentViolations: Map<string, string[]> = new Map()
): string {
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

  if (staleByNum.size > 0) {
    lines.push(
      `## Realized-by hash mismatches (still within the ${REALIZED_BY_GRACE_DAYS}-day grace period)`,
      '',
      "Not counted as drift yet — these locators' recorded hash no longer matches the file's current",
      'content. Go confirm the change is fine, then run `--refresh` to see it, and `--refresh --ids ...`',
      'or `--refresh --force` to re-baseline it.',
      ''
    );
    for (const [num, paths] of staleByNum) {
      lines.push(`- ADR-${num}: ${paths.join(', ')}`);
    }
    lines.push('');
  }

  if (commentViolations.size > 0) {
    lines.push(
      '## Comment-convention violations',
      '',
      "An Implements:/Verifies: comment was found under a path this repo's `.adrrc.json` marks",
      '`commentForbiddenPaths` — it never counted as embodiment evidence, but should be replaced',
      "with the ADR's own `**Realized by:**` field instead.",
      ''
    );
    for (const [file, nums] of commentViolations) {
      lines.push(`- ${file}: ${nums.map((n) => `ADR-${n}`).join(', ')}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

// `--refresh` alone is detect-only (read-only, JSON on stdout, safe to run anytime).
// `--refresh --ids <id,id,...>` applies only the listed, previously
// detected IDs — a reviewer's own confirmation that each one still holds. `--refresh --force`
// applies every currently-drifted locator without per-ID review, the explicit bypass. Both
// apply forms require an attestor identity, resolved via resolveAttestorIdentity() (gh api user
// -> git config user.name -> explicit --by), unless --no-attestation opts out.
function runRefresh(): void {
  const discovered = discoverAdrs();
  const idsIdx = process.argv.indexOf('--ids');
  const requestedIds = idsIdx !== -1 ? process.argv[idsIdx + 1]?.split(',').map((s) => s.trim()) : undefined;
  const force = process.argv.includes('--force');

  if (!requestedIds && !force) {
    // Detect-only: read-only, structured output for a reviewer (human or agent) to act on.
    const drift = detectRealizedByDrift(discovered);
    console.log(JSON.stringify(drift, null, 2));
    console.error(`${drift.driftCount} locator(s) drifted (${drift.pastGraceCount} past grace).`);
    if (drift.driftCount > 0) {
      console.error('Review each entry, then run --refresh --ids "<id,id,...>" --by "<name>" to apply, or --refresh --force to apply all without per-ID review.');
    }
    return;
  }

  const byIdx = process.argv.indexOf('--by');
  const explicitBy = byIdx !== -1 ? process.argv[byIdx + 1] : undefined;
  const skipAttestation = process.argv.includes('--no-attestation');
  const attestedBy = resolveAttestorIdentity(explicitBy);
  if (!attestedBy && REQUIRE_ATTESTATION_FOR_REFRESH && !skipAttestation) {
    console.error(
      'Applying a refresh requires an attestor identity — someone accountable must confirm they ' +
        'actually reviewed each changed file before its hash is re-baselined. None of gh api user, ' +
        'git config user.name, or --by "<name>" resolved to anything. Pass --no-attestation to ' +
        'explicitly opt out (e.g. a fully automated pipeline), or set "requireAttestationForRefresh": ' +
        'false in .adrrc.json to change the repo-wide default.'
    );
    console.log(JSON.stringify({ status: 'error', reason: 'attestation_required', applied: 0 }, null, 2));
    process.exitCode = 1;
    return;
  }

  if (requestedIds) {
    const drift = detectRealizedByDrift(discovered);
    const driftIds = new Set(drift.entries.map((d) => d.id));
    const unknown = requestedIds.filter((id) => !driftIds.has(id));
    if (unknown.length > 0) {
      console.error(
        `--ids named ${unknown.length} ID(s) that a fresh detect run doesn't currently show as drifted ` +
          `(stale, or never a real detect ID): ${unknown.join(', ')}. Re-run --refresh with no flags to get ` +
          'current IDs, then retry.'
      );
      console.log(JSON.stringify({ status: 'error', reason: 'unknown_ids', unknownIds: unknown, applied: 0 }, null, 2));
      process.exitCode = 1;
      return;
    }
    const requestedIdSet = new Set(requestedIds);
    const count = applyRealizedByRefresh(discovered, (entry) => requestedIdSet.has(entry.id), attestedBy ?? 'unattested');
    console.error(`Refreshed ${count} ADR(s) (${requestedIds.length} reviewed locator(s)).`);
    console.log(JSON.stringify({ status: 'ok', applied: count, reviewedIds: requestedIds, attestedBy }, null, 2));
    return;
  }

  // --force: apply every currently-drifted locator without per-ID review.
  const count = applyRealizedByRefresh(discovered, () => true, attestedBy ?? 'unattested');
  console.error(`Refreshed ${count} ADR(s) with a changed Realized-by hash (forced, no per-ID review).`);
  console.log(JSON.stringify({ status: 'ok', applied: count, forced: true, attestedBy }, null, 2));
}

function main(): void {
  if (process.argv.includes('--refresh')) {
    runRefresh();
    return;
  }

  const discovered = discoverAdrs();
  console.error(`Found ${discovered.size} ADRs. Scanning specs and code...`);
  regenerateAdrIndex(discovered);
  regenerateRfcIndex();

  const entries = new Map<string, AdrAuditEntry>();
  for (const [number, { status, statedEmbodiment }] of discovered) {
    entries.set(number, { number, status, statedEmbodiment, specRefs: [], codeRefs: [], testRefs: [] });
  }

  scanSpecs(entries);
  const commentViolations = scanCode(entries);
  const staleByNum = scanRealizedBy(entries, discovered);

  const entryList = [...entries.values()];
  const report = renderReport(entryList, staleByNum, commentViolations);
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
  if (staleByNum.size > 0) {
    console.error(`Realized-by hash mismatches still in grace: ${staleByNum.size} (run --refresh once confirmed fine)`);
  }
  if (commentViolations.size > 0) {
    console.error(`Comment-convention violations: ${commentViolations.size} (see docs/adr-audit/report.md)`);
  }

  // --fail-on-drift is opt-in, not the default: the plain run stays exit-0/informational for
  // local/interactive use (a developer regenerating the index shouldn't get blocked by drift
  // they're not currently trying to fix), matching this repo's own warn-vs-block calibration
  // elsewhere (README.md's "is this a governance gap with no one answerable, or useful-but-not-
  // worth-blocking" framing). CI and pre-commit opt into strictness explicitly by passing the
  // flag, rather than this script's default behavior silently changing for every caller.
  const failOnDrift = process.argv.includes('--fail-on-drift');
  if (failOnDrift && driftCount > 0) {
    console.error(`--fail-on-drift set: failing (${driftCount} ADR(s) with a stated/computed Embodiment mismatch).`);
    process.exitCode = 1;
  }

  // stdout is a pure data channel: the on-disk summary.json plus a status field, for the
  // agent/script that's actually the primary consumer -- everything above is stderr.
  console.log(
    JSON.stringify(
      {
        status: driftCount > 0 ? 'drift' : 'clean',
        driftCount,
        graceCount: staleByNum.size,
        commentViolationCount: commentViolations.size,
        failOnDrift,
        summary,
      },
      null,
      2
    )
  );
}

main();

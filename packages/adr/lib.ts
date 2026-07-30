// Core of the ADR linter for docs/adr/ (see docs/adr/README.md for the
// enforced structure). No process.argv/exit/console here — see adr-lint.ts.
//
// Every individual check (checkFilenameFormat, checkStatusField, etc.) is a
// pure function — string/data in, Issue[] out, no fs access — so each is
// directly unit-testable with zero I/O. lintAdrDir itself is the one
// exception: it's the directory-walking orchestrator (readdirSync/
// readFileSync) that calls each pure check and aggregates results. It stays
// here rather than in adr-lint.ts specifically so it can still be imported
// and called directly from tests against real tempdir fixtures, without the
// subprocess overhead a CLI-file-with-top-level-side-effects would require.
//
// Supersession symmetry/direction is blocking for Accepted-lineage ADRs and
// warn-only (checked against Pending Supersedes / Superseded-by) for
// still-Proposed ones.

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

export const FILENAME_RE = /^\d{4}-[a-z0-9-]+\.md$/;
export const VALID_STATUSES = new Set([
  'Proposed',
  'Accepted',
  'Superseded',
  'Deprecated',
  'Rejected',
  'Withdrawn',
]);
export const STATUS_RE = /\*\*Status:\*\*\s+(\S+)/;
export const DATE_RE = /\*\*Date:\*\*\s+\d{4}-\d{2}-\d{2}/;
export const Y_STATEMENT_RE = /\*\*Decision \(Y-statement\):\*\*/;
export const Y_STATEMENT_KEYWORDS = [
  'In the context of',
  'facing',
  'we decided',
  'to achieve',
  'accepting',
];
export const ADR_NUM_RE = /ADR-(\d{4})/g;
export const REQUIRED_SECTIONS: string[][] = [
  ['Context'],
  ['Considered options', 'Options considered'],
  ['Decision'],
  ['Consequences'],
];
// Same aliases as REQUIRED_SECTIONS' "Considered options" entry — a table under either heading
// must be checked, not just the primary spelling. Found by content, not position, so this stays
// correct if REQUIRED_SECTIONS is ever reordered.
export const CONSIDERED_OPTIONS_ALIASES = REQUIRED_SECTIONS.find((aliases) =>
  aliases.includes('Considered options')
) as string[];

// Source paths that should usually come with an ADR — warn-only, not blocking.
export const COVERAGE_PATHS = ['packages/contracts/src/', 'apps/backend/src/', 'docs/specs/'];

export type Issue = { type: 'ERROR' | 'WARN'; file: string; message: string };
// direction is widened to `string` (rather than the narrower supersession-only
// literal union) so this same entry shape serves both the Supersedes/Superseded-by
// relation ('supersedes' | 'superseded-by') and the independent Amends/Amended-by
// relation ('amends' | 'amended-by') without a parallel type.
export type SupersessionEntry = { refNum: string; direction: string };
export type LintResult = { issues: Issue[]; adrFiles: string[] };

// Pulled out of the CLI wrapper so the exact output format is directly
// testable — the CLI file itself runs at import time and calls
// process.exit(), which makes it unsafe to import from a test.
export function formatIssueLine(issue: Issue): string {
  const prefix = issue.type === 'ERROR' ? 'ERROR' : 'WARN ';
  return `  ${prefix}  ${issue.file}: ${issue.message}`;
}

// Per GitHub's workflow-command escaping rules:
// https://docs.github.com/en/actions/using-workflows/workflow-commands-for-github-actions#escaping-properties
export function escapeAnnotationProperty(value: string): string {
  return value.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A').replace(/:/g, '%3A').replace(/,/g, '%2C');
}

export function escapeAnnotationData(value: string): string {
  return value.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
}

// issue.file is a bare ADR/spec filename ("0032-x.md"), an already repo-relative path (e.g.
// a changed-file path threaded through from the coverage warning), or a non-file sentinel like
// "(numbering)" — only the first two name a real file GitHub can anchor an annotation to.
export function normalizeIssueFilePath(file: string, dirPrefix: string): string {
  if (file.startsWith('(')) return '';
  if (file.includes('/')) return file;
  return `${dirPrefix}/${file}`;
}

export function formatGithubAnnotation(issue: Issue, normalizedFile: string): string {
  const cmd = issue.type === 'ERROR' ? 'error' : 'warning';
  if (!normalizedFile) {
    return `::${cmd}::${escapeAnnotationData(issue.message)}`;
  }
  return `::${cmd} file=${escapeAnnotationProperty(normalizedFile)}::${escapeAnnotationData(issue.message)}`;
}

// Reads a field value up to the next "- **" item or "##" heading, so a
// wrapped multi-line value (e.g. Supersedes / Superseded-by) is captured
// in full instead of truncating at the first newline.
function fieldRegex(label: string): RegExp {
  return new RegExp(`\\*\\*${label}:\\*\\*([\\s\\S]*?)(?=\\n- \\*\\*|\\n##)`, 'i');
}

export const AUTHOR_RE = fieldRegex('Author');
export const REVIEWERS_RE = fieldRegex('Reviewers');
export const DECIDERS_RE = fieldRegex('Deciders');
export const SUPERSEDES_RE = fieldRegex('Supersedes \\/ Superseded-by');
export const PENDING_SUPERSEDES_RE = fieldRegex('Pending Supersedes \\/ Superseded-by');
// Amends/Amended-by is a distinct relationship from Supersedes/Superseded-by — an ADR that
// amends a peer refines or extends it without replacing it. Checked independently via the
// same checkSupersessionReciprocity machinery (parameterized by relation label below); a
// claim in one field is never satisfied by an entry in the other.
export const AMENDS_RE = fieldRegex('Amends \\/ Amended-by');
export const PENDING_AMENDS_RE = fieldRegex('Pending Amends \\/ Amended-by');

// A not-yet-Accepted ADR's supersession claim isn't binding yet, so its
// reciprocity is checked against the peer's Pending field instead (warn,
// not error). See isBindingStatus / checkSupersessionReciprocity below.
const NOT_YET_BINDING_STATUSES = new Set(['Proposed']);

export function fieldValue(content: string, re: RegExp): string | null {
  const m = re.exec(content);
  return m ? m[1].trim() : null;
}

// Strips leading wrapper punctuation, then checks whether what's left
// starts with a pending phrase — catches "(pending)" and "— (awaiting ack)"
// without misreading "Alice; later amendment: awaiting ack" as blank.
const PENDING_PHRASES = ['pending', 'tbd', 'awaiting', 'none', 'unknown', 'n/a', 'na'];
const LEADING_WRAPPER_RE = /^[\s\-–—("'`[\]_*)]+/;

export function stripLeadingWrapper(value: string | null | undefined): string {
  return (value ?? '').replace(LEADING_WRAPPER_RE, '');
}

export function isPlaceholder(value: string | null | undefined): boolean {
  const normalized = (value ?? '').replace(/\s+/g, ' ').trim();
  if (!normalized) return true;
  const stripped = stripLeadingWrapper(normalized).toLowerCase();
  if (!stripped) return true;
  return PENDING_PHRASES.some((phrase) => stripped.startsWith(phrase));
}

// Name portion before a self-attestation annotation, e.g. "Beau — self-attested; ...".
export function primaryName(value: string | null | undefined): string {
  return (value ?? '').split(/[—–]/)[0].trim();
}

export function normalizeName(value: string | null | undefined): string {
  return primaryName(value)
    .toLowerCase()
    .replace(/[^a-z]/g, '');
}

export function checkFilenameFormat(file: string): Issue[] {
  if (!FILENAME_RE.test(file)) {
    return [{ type: 'ERROR', file, message: 'filename must match \\d{4}-[a-z0-9-]+.md' }];
  }
  return [];
}

// Flags every file beyond the first to introduce a given leading 4-digit number — matches the
// original inline loop's behavior exactly: the file that first claims a number is never itself
// flagged, only subsequent files sharing it.
export function findDuplicateNumbers(files: string[]): Issue[] {
  const issues: Issue[] = [];
  const seen = new Set<string>();
  for (const file of files) {
    const num = file.slice(0, 4);
    if (seen.has(num)) {
      issues.push({ type: 'ERROR', file, message: `duplicate ADR number ${num}` });
    }
    seen.add(num);
  }
  return issues;
}

export function checkStatusField(content: string, file: string): { issues: Issue[]; status: string | null } {
  const issues: Issue[] = [];
  const statusMatch = STATUS_RE.exec(content);
  const status = statusMatch ? statusMatch[1] : null;
  if (!statusMatch) {
    issues.push({ type: 'ERROR', file, message: 'missing **Status:** field' });
  } else if (!VALID_STATUSES.has(status!)) {
    issues.push({
      type: 'ERROR',
      file,
      message: `invalid status "${status}" — must be one of: ${[...VALID_STATUSES].join(', ')}`,
    });
  }
  return { issues, status };
}

export function checkDateField(content: string, file: string): Issue[] {
  if (!DATE_RE.test(content)) {
    return [{ type: 'ERROR', file, message: 'missing or malformed **Date:** YYYY-MM-DD' }];
  }
  return [];
}

export function hasSection(content: string, aliases: string[]): boolean {
  return aliases.some((name) => new RegExp(`^##\\s+${name}\\b`, 'im').test(content));
}

// "superseded ... by" → superseded-by; otherwise → supersedes.
export function detectDirection(segment: string): 'supersedes' | 'superseded-by' {
  return /supersed(?:ed|es)\b[\s\S]*?\bby\b/i.test(segment) ? 'superseded-by' : 'supersedes';
}

// "amend(s|ed) ... by" (e.g. "amended by") → amended-by; anything else
// referencing an ADR (including plain "amends") → amends. Mirrors
// detectDirection's supersedes/superseded-by logic exactly, for the
// independent Amends/Amended-by relation.
export function detectAmendDirection(segment: string): 'amends' | 'amended-by' {
  return /amend(?:ed|s)\b[\s\S]*?\bby\b/i.test(segment) ? 'amended-by' : 'amends';
}

// A caveat/qualifier clause names an ADR only as context, not as a claimed
// target, e.g. "...for the scope not already superseded by ADR-0020...".
// Stripped before extraction so it isn't swept up as a false-positive claim.
// Recognizes both the supersede and amend verbs, since this schema has both
// relations as independent fields.
const CAVEAT_CLAUSE_RE =
  /(?:not\s+)?already\s+(?:supersed(?:ed|es)|amend(?:ed|s))\s+by\s+ADR-\d{4}(?:\s*(?:,|and|or)\s*ADR-\d{4})*/gi;

export function stripCaveatClauses(segment: string): string {
  return segment.replace(CAVEAT_CLAUSE_RE, '');
}

// Distinct ADR-NNNN numbers appearing in text, in first-seen order.
export function extractAdrNumbers(text: string): string[] {
  const re = /ADR-(\d{4})/g;
  const seen = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    seen.add(match[1]);
  }
  return [...seen];
}

// A Supersedes / Superseded-by (or Pending Supersedes / Superseded-by)
// value can carry more than one relationship, semicolon-separated, and a
// single segment can itself name more than one target in prose (e.g.
// "Supersedes ADR-0002, ADR-0004, ADR-0006").
export function extractSupersessionEntries(fieldText: string): SupersessionEntry[] {
  const entries: SupersessionEntry[] = [];
  for (const rawSegment of fieldText.split(';')) {
    const segment = stripCaveatClauses(rawSegment);
    const targets = extractAdrNumbers(segment);
    if (targets.length === 0) continue;
    const direction = detectDirection(segment);
    for (const refNum of targets) {
      entries.push({ refNum, direction });
    }
  }
  return entries;
}

// Mirrors extractSupersessionEntries exactly, for the independent
// Amends/Amended-by relation.
export function extractAmendmentEntries(fieldText: string): SupersessionEntry[] {
  const entries: SupersessionEntry[] = [];
  for (const rawSegment of fieldText.split(';')) {
    const segment = stripCaveatClauses(rawSegment);
    const targets = extractAdrNumbers(segment);
    if (targets.length === 0) continue;
    const direction = detectAmendDirection(segment);
    for (const refNum of targets) {
      entries.push({ refNum, direction });
    }
  }
  return entries;
}

// Whether an ADR's Supersedes / Superseded-by claim is binding. Only
// Proposed is provisional; Superseded/Deprecated/Rejected/Withdrawn are all
// post-decision terminal states, so they stay binding. A missing status is
// already reported separately, so it's treated as binding here to avoid
// double-penalizing.
export function isBindingStatus(status: string | null): boolean {
  if (!status) return true;
  return !NOT_YET_BINDING_STATUSES.has(status);
}

type ReciprocityInput = {
  supersessionMap: Map<string, SupersessionEntry[]>;
  pendingSupersessionMap: Map<string, SupersessionEntry[]>;
  statusByFile: Map<string, string | null>;
  findFile: (num: string) => string | undefined;
  // Message wording only — lets the same reciprocity logic serve both the
  // Supersedes/Superseded-by relation and the independent Amends/Amended-by
  // one without duplicating the function. Defaults preserve the exact
  // pre-existing Supersedes wording so existing call sites need no changes.
  relationLabel?: string;
  directionWords?: readonly [string, string];
  pendingFieldName?: string;
};

// Accepted-lineage claimants are checked against the peer's binding field
// (blocking error on missing/mismatched reciprocation). Still-Proposed
// claimants are checked against the peer's Pending field instead, and a gap
// is a warning, not a blocking error.
export function checkSupersessionReciprocity({
  supersessionMap,
  pendingSupersessionMap,
  statusByFile,
  findFile,
  relationLabel = 'supersession',
  directionWords = ['Supersedes', 'Superseded by'],
  pendingFieldName = 'Pending Supersedes / Superseded-by',
}: ReciprocityInput): Issue[] {
  const results: Issue[] = [];
  const [forwardWord, backwardWord] = directionWords;
  for (const [num, entries] of supersessionMap) {
    const srcFile = findFile(num);
    const binding = isBindingStatus(statusByFile.get(num) ?? null);

    for (const { refNum, direction } of entries) {
      const refFile = findFile(refNum);
      if (!refFile) continue; // dangling ref — reported by the caller's separate pass

      if (binding) {
        const peerEntries = supersessionMap.get(refNum) ?? [];
        const reciprocal = peerEntries.find((e) => e.refNum === num);
        if (!reciprocal) {
          results.push({
            type: 'ERROR',
            file: srcFile!,
            message: `${relationLabel} link to ADR-${refNum} is not symmetric — ADR-${refNum} must also reference ADR-${num}`,
          });
        } else if (direction === reciprocal.direction) {
          results.push({
            type: 'ERROR',
            file: srcFile!,
            message: `${relationLabel} direction mismatch with ADR-${refNum} — one must say "${forwardWord}" and the other "${backwardWord}"`,
          });
        }
      } else {
        const peerPending = pendingSupersessionMap.get(refNum) ?? [];
        const reciprocal = peerPending.find((e) => e.refNum === num);
        if (!reciprocal) {
          results.push({
            type: 'WARN',
            file: srcFile!,
            message: `provisional ${relationLabel} link to ADR-${refNum} (ADR-${num} is not yet Accepted) — ADR-${refNum} should acknowledge it in its **${pendingFieldName}:** field until ADR-${num} is Accepted`,
          });
        } else if (direction === reciprocal.direction) {
          results.push({
            type: 'WARN',
            file: srcFile!,
            message: `provisional ${relationLabel} direction mismatch with ADR-${refNum} — one must say "${forwardWord}" and the other "${backwardWord}"`,
          });
        }
      }
    }
  }
  return results;
}

export function checkRequiredSections(content: string, file: string): Issue[] {
  const issues: Issue[] = [];
  for (const aliases of REQUIRED_SECTIONS) {
    if (!hasSection(content, aliases)) {
      issues.push({ type: 'ERROR', file, message: `missing required section: ## ${aliases[0]}` });
    }
  }
  return issues;
}

export function checkYStatement(content: string, file: string): Issue[] {
  if (!Y_STATEMENT_RE.test(content)) {
    return [{ type: 'ERROR', file, message: 'missing **Decision (Y-statement):** TL;DR block' }];
  }

  const yMatch = content.match(/\*\*Decision \(Y-statement\):\*\*([\s\S]*?)(?=\n- \*\*|\n##)/);
  if (!yMatch) {
    // Marker found but not followed by a recognizable block boundary (a `- **`
    // metadata bullet or `##` heading) — report the extraction failure directly rather
    // than falling back to scanning the whole document. Scanning the whole document
    // would let required phrases appearing anywhere else in the ADR mask a malformed
    // or unterminated Y-statement block.
    return [
      {
        type: 'ERROR',
        file,
        message:
          'could not extract **Decision (Y-statement):** TL;DR block — marker found but not followed by a recognizable block boundary (a `- **` metadata bullet or `##` heading)',
      },
    ];
  }

  const issues: Issue[] = [];
  const yBlock = yMatch[1].replace(/\n>\s*/g, ' ');
  for (const kw of Y_STATEMENT_KEYWORDS) {
    // Word-boundary match, not a plain substring search (still case-sensitive, matching
    // the original .includes() behavior) — a bare .includes() would let e.g. "interfacing"
    // or "surfacing" satisfy the "facing" keyword.
    const kwRe = new RegExp(`\\b${kw.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}\\b`);
    if (!kwRe.test(yBlock)) {
      issues.push({
        type: 'ERROR',
        file,
        message: `Y-statement missing expected phrase "${kw}" — ensure the TL;DR follows the "In the context of..., facing..., we decided..., to achieve..., accepting..." structure`,
      });
    }
  }
  return issues;
}

export function checkConsideredOptionsMinimum(content: string, file: string): Issue[] {
  let sectionMatch: RegExpMatchArray | null = null;
  for (const alias of CONSIDERED_OPTIONS_ALIASES) {
    // Anchored via a start-of-line lookbehind, not just the substring "## <alias>" (which
    // would also match inside a nested "### <alias>" subsection heading, e.g. a Decision-
    // section recap). The lookbehind is used instead of the "m" flag deliberately — "m" would
    // also redefine "$" in the closing lookahead to mean end-of-line rather than end-of-string,
    // breaking the "run to end of file when no next section follows" case.
    sectionMatch = content.match(new RegExp(`(?<=^|\\n)## ${alias}[\\s\\S]*?(?=\\n## |\\n---|\\s*$)`, 'i'));
    if (sectionMatch) break;
  }
  if (!sectionMatch) return [];

  const tableRows = sectionMatch[0]
    .split('\n')
    .filter((l) => l.trim().startsWith('|'))
    .filter((l) => !/^\|\s*-+\s*\|/.test(l.trim()))
    // Row 0 after separator-row removal is always the table header, whatever its first
    // cell is spelled ("Option", "Alternative", ...) -- drop it positionally rather than
    // pattern-matching the literal word "option", which let a table headed
    // "| Alternative | Pros | Cons |" keep its header row counted as a real alternative.
    .filter((_, i) => i !== 0);
  if (tableRows.length < 2) {
    return [
      { type: 'ERROR', file, message: 'Considered options has fewer than 2 alternatives — document at least one rejected option' },
    ];
  }
  return [];
}

// See docs/adr/README.md "Three roles" for the Author/Reviewers/Deciders policy this enforces.
export function checkAuthorReviewersDeciders(content: string, file: string, status: string | null): Issue[] {
  const issues: Issue[] = [];
  const author = fieldValue(content, AUTHOR_RE);
  const reviewers = fieldValue(content, REVIEWERS_RE);
  const deciders = fieldValue(content, DECIDERS_RE);

  if (status === 'Accepted' && isPlaceholder(deciders)) {
    issues.push({
      type: 'ERROR',
      file,
      message: 'Status is Accepted but Deciders is blank or a placeholder — an Accepted ADR must record who held binding approval authority',
    });
  }
  if (status === 'Accepted' && isPlaceholder(reviewers)) {
    issues.push({
      type: 'WARN',
      file,
      message: 'Status is Accepted but Reviewers is blank or a placeholder — consider recording a lightweight technical ack',
    });
  }
  if (!isPlaceholder(author)) {
    const authorName = normalizeName(author);
    if (!isPlaceholder(deciders) && authorName && authorName === normalizeName(deciders)) {
      issues.push({
        type: 'WARN',
        file,
        message: `Author and Deciders name the same person (${primaryName(author)}) — self-ack smell, not blocking`,
      });
    }
    if (!isPlaceholder(reviewers) && authorName && authorName === normalizeName(reviewers)) {
      issues.push({
        type: 'WARN',
        file,
        message: `Author and Reviewers name the same person (${primaryName(author)}) — self-ack smell, not blocking`,
      });
    }
  }
  return issues;
}

export function checkDanglingReferences(content: string, file: string, seenNumbers: Set<string>): Issue[] {
  const issues: Issue[] = [];
  const refRe = /ADR-(\d{4})/g;
  let match: RegExpExecArray | null;
  while ((match = refRe.exec(content)) !== null) {
    if (!seenNumbers.has(match[1])) {
      issues.push({ type: 'ERROR', file, message: `dangling reference to ADR-${match[1]} (not found in docs/adr/)` });
    }
  }
  return issues;
}

// Warn-only: concurrent branches can legitimately merge out of order, so a gap isn't
// necessarily a mistake — see the message text.
export function checkNumberingGaps(seenNumbers: Set<string>): Issue[] {
  const numericNumbers = [...seenNumbers].map(Number).sort((a, b) => a - b);
  if (numericNumbers.length === 0) return [];

  const issues: Issue[] = [];
  const min = numericNumbers[0];
  const max = numericNumbers[numericNumbers.length - 1];
  const present = new Set(numericNumbers);
  for (let n = min; n <= max; n++) {
    if (!present.has(n)) {
      const gapNum = String(n).padStart(4, '0');
      issues.push({
        type: 'WARN',
        file: '(numbering)',
        message: `ADR ${gapNum} is missing between existing ADRs ${String(min).padStart(4, '0')} and ${String(max).padStart(4, '0')} -- fine if a PR reserving it just hasn't merged yet, otherwise confirm it wasn't silently skipped`,
      });
    }
  }
  return issues;
}

// readmeContent is null when docs/adr/README.md doesn't exist at all (e.g. a synthetic fixture
// dir in a test) — that's not itself an error this check reports; it just has nothing to check.
export function checkReadmeIndex(adrFiles: string[], readmeContent: string | null): Issue[] {
  if (readmeContent === null) return [];
  const issues: Issue[] = [];
  for (const file of adrFiles) {
    const num = file.slice(0, 4);
    if (!readmeContent.includes(num)) {
      issues.push({ type: 'WARN', file, message: `ADR ${num} is not listed in docs/adr/README.md` });
    }
  }
  return issues;
}

export function checkCoverage(changedFiles: string[]): Issue[] {
  if (changedFiles.length === 0) return [];
  const hasAdrChange = changedFiles.some((f) => f.startsWith('docs/adr/'));
  if (hasAdrChange) return [];
  const triggered = changedFiles.filter((f) => COVERAGE_PATHS.some((p) => f.startsWith(p)));
  if (triggered.length === 0) return [];
  return [
    { type: 'WARN', file: triggered[0], message: 'source changed without any docs/adr/** change — consider whether a new ADR is needed' },
  ];
}

// Resolves the set of files under `dir` that git considers tracked or
// currently staged, as absolute paths. Used to scope raw-filesystem
// directory walks (readdirSync-based discovery below and in adr-audit.ts /
// spec-lint.ts) to what git actually knows about, so an untracked scratch
// .md file dropped in docs/adr/ or docs/specs/ doesn't get swept into
// corpus-wide checks (duplicate-number detection, dangling-reference checks,
// README-index sync, the embodiment audit).
//
// `cwd` is the directory the `git` subprocess runs in (typically the repo
// root, or any directory inside the repo — git discovers the repository
// root by walking upward from there); `dir` is the pathspec limiting the
// listing to that subtree. Returns `null` — rather than throwing — on any
// failure (not a git repository, git binary not found, etc.) so callers can
// fall back to the existing unfiltered behavior; whole-corpus semantics are
// preserved that way (every *tracked* file is still linted regardless of
// whether the current push touches it) while genuinely-untracked scratch
// files are excluded.
//
// Uses execFileSync (argument array, not a shell string) so `dir`/`cwd`
// can never be interpreted as shell syntax.
export function resolveGitTrackedOrStagedFiles(dir: string, cwd: string): Set<string> | null {
  try {
    const runGit = (args: string[]): string[] =>
      execFileSync('git', args, { cwd, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] })
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);

    const tracked = runGit(['ls-files', '--', dir]);
    const staged = runGit(['diff', '--cached', '--name-only', '--', dir]);

    const files = new Set<string>();
    for (const rel of [...tracked, ...staged]) {
      files.add(resolve(cwd, rel));
    }
    return files;
  } catch {
    return null;
  }
}

// Filters a list of bare filenames (as returned by readdirSync(parentDir))
// down to those git tracks or has staged, when `trackedFiles` is non-null.
// When `trackedFiles` is null (git unavailable), returns the list unchanged
// — the raw-filesystem fallback.
function filterToTracked(files: string[], parentDir: string, trackedFiles: Set<string> | null): string[] {
  if (trackedFiles === null) return files;
  return files.filter((f) => trackedFiles.has(resolve(parentDir, f)));
}

// Lints every ADR file in `adrDir`. Never calls process.exit or writes to
// stdout — that's the CLI wrapper's job (see adr-lint.ts). Directory-walking
// orchestrator only: every actual check above is a pure function, called
// here and aggregated.
//
// `repoRoot` scopes discovery to git-tracked-or-staged files (see
// resolveGitTrackedOrStagedFiles above) and defaults to `adrDir` itself —
// git discovers the actual repository root by walking upward from any
// directory inside it, so this works whether `adrDir` is the real
// docs/adr/ or a test fixture. When `adrDir` isn't inside a git repo at
// all (e.g. a bare tmpdir fixture), discovery falls back to the raw
// filesystem listing unchanged.
export function lintAdrDir(adrDir: string, changedFiles: string[] = [], repoRoot: string = adrDir): LintResult {
  const issues: Issue[] = [];

  let adrFiles: string[];
  try {
    const trackedFiles = resolveGitTrackedOrStagedFiles(adrDir, repoRoot);
    adrFiles = filterToTracked(
      readdirSync(adrDir).filter((f) => f.endsWith('.md') && f !== 'README.md' && !f.startsWith('_')),
      adrDir,
      trackedFiles
    ).sort();
  } catch {
    return {
      issues: [
        { type: 'ERROR', file: '(adr-dir)', message: `docs/adr directory not found at ${adrDir}` },
      ],
      adrFiles: [],
    };
  }

  issues.push(...findDuplicateNumbers(adrFiles));

  const seenNumbers = new Set<string>();
  const contentsByFile = new Map<string, string>();
  const statusByFile = new Map<string, string | null>();

  for (const file of adrFiles) {
    const content = readFileSync(join(adrDir, file), 'utf8');
    contentsByFile.set(file, content);
    seenNumbers.add(file.slice(0, 4));

    issues.push(...checkFilenameFormat(file));

    const { issues: statusIssues, status } = checkStatusField(content, file);
    issues.push(...statusIssues);
    statusByFile.set(file.slice(0, 4), status);

    issues.push(...checkDateField(content, file));
    issues.push(...checkRequiredSections(content, file));
    issues.push(...checkYStatement(content, file));
    issues.push(...checkConsideredOptionsMinimum(content, file));
    issues.push(...checkAuthorReviewersDeciders(content, file, status));
  }

  // Supersession symmetry + direction, binding for Accepted-lineage ADRs
  // and warn-only (checked against the Pending field) for still-Proposed
  // ones — see checkSupersessionReciprocity above.
  const supersessionMap = new Map<string, SupersessionEntry[]>();
  const pendingSupersessionMap = new Map<string, SupersessionEntry[]>();
  for (const file of adrFiles) {
    const content = contentsByFile.get(file)!;
    const num = file.slice(0, 4);

    const entries = extractSupersessionEntries(fieldValue(content, SUPERSEDES_RE) ?? '');
    if (entries.length > 0) supersessionMap.set(num, entries);

    const pendingEntries = extractSupersessionEntries(
      fieldValue(content, PENDING_SUPERSEDES_RE) ?? ''
    );
    if (pendingEntries.length > 0) pendingSupersessionMap.set(num, pendingEntries);
  }

  const findFile = (num: string) => adrFiles.find((f) => f.startsWith(num));
  issues.push(
    ...checkSupersessionReciprocity({ supersessionMap, pendingSupersessionMap, statusByFile, findFile })
  );

  // Amends/Amended-by — a distinct relationship from Supersedes/Superseded-by,
  // checked entirely independently via the same reciprocity machinery. A claim
  // in one field is never satisfied by an entry in the other.
  const amendmentMap = new Map<string, SupersessionEntry[]>();
  const pendingAmendmentMap = new Map<string, SupersessionEntry[]>();
  for (const file of adrFiles) {
    const content = contentsByFile.get(file)!;
    const num = file.slice(0, 4);

    const entries = extractAmendmentEntries(fieldValue(content, AMENDS_RE) ?? '');
    if (entries.length > 0) amendmentMap.set(num, entries);

    const pendingEntries = extractAmendmentEntries(fieldValue(content, PENDING_AMENDS_RE) ?? '');
    if (pendingEntries.length > 0) pendingAmendmentMap.set(num, pendingEntries);
  }

  issues.push(
    ...checkSupersessionReciprocity({
      supersessionMap: amendmentMap,
      pendingSupersessionMap: pendingAmendmentMap,
      statusByFile,
      findFile,
      relationLabel: 'amendment',
      directionWords: ['Amends', 'Amended by'],
      pendingFieldName: 'Pending Amends / Amended-by',
    })
  );

  for (const file of adrFiles) {
    issues.push(...checkDanglingReferences(contentsByFile.get(file)!, file, seenNumbers));
  }

  issues.push(...checkNumberingGaps(seenNumbers));

  const readmePath = join(adrDir, 'README.md');
  const readmeContent = existsSync(readmePath) ? readFileSync(readmePath, 'utf8') : null;
  issues.push(...checkReadmeIndex(adrFiles, readmeContent));

  issues.push(...checkCoverage(changedFiles));

  return { issues, adrFiles };
}

// ── Embodiment (realization) audit ──────────────────────────────────────────
//
// Pure functions only — see docs/adr/README.md's "Embodiment (realization tracking)"
// section for the full rationale. adr-audit.ts owns the filesystem walk (docs/adr/,
// docs/specs/, apps/, packages/shared/) and CLI/report-writing; this section only
// computes state from already-extracted text/back-pointer counts, so it's directly
// unit-testable without touching disk.

export type EmbodimentState = 'Not started' | 'Specified' | 'Implemented' | 'Verified' | 'Inactive';

// Matches a spec file header's back-pointer to one or more ADRs, e.g.
// "**Implements ADRs:** ADR-0042, ADR-0043" — table-row or blockquote/plain forms
// both match since only the bold-marker + label + colon are anchored.
export const SPEC_IMPLEMENTS_ADRS_RE = /\*\*Implements ADRs:?\*\*:?\s*[:|]?\s*([^\n|]+)/i;

// Matches a code/test file's back-pointer comment, e.g. "// Implements: ADR-0042".
export const CODE_IMPLEMENTS_RE = /\bImplements:\s*ADR-(\d{4})/g;
export const CODE_VERIFIES_RE = /\bVerifies:\s*ADR-(\d{4})/g;

// Matches an ADR header's own stated Embodiment field, e.g. "**Embodiment:** Implemented".
// Used by adr-audit.ts's discoverAdrs() to read what an ADR claims, before comparing
// against what computeEmbodiment derives from the back-pointers above.
export const EMBODIMENT_RE = /\*\*Embodiment:\*\*\s+(.+)/;

// Pure ADR-number extraction from a bare filename ("0032-x.md" -> "0032"), null when the
// name doesn't match FILENAME_RE at all. Fixed-width slice, not a regex capture group —
// matches the convention lintAdrDir already uses internally (file.slice(0, 4)), so
// adr-audit.ts's discoverAdrs() doesn't need its own filename-parsing regex.
export function parseAdrFilenameNumber(name: string): string | null {
  if (!FILENAME_RE.test(name)) return null;
  return name.slice(0, 4);
}

// Pure Status + stated-Embodiment extraction from an ADR file's raw content. Used by
// adr-audit.ts's discoverAdrs() to build each AdrAuditEntry before the spec/code/test
// back-pointer scan fills in specRefs/codeRefs/testRefs.
export function parseAdrHeaderFields(content: string): { status: string; statedEmbodiment: string } {
  const status = STATUS_RE.exec(content)?.[1] ?? 'unknown';
  const statedEmbodiment = EMBODIMENT_RE.exec(content)?.[1]?.trim() ?? 'unknown';
  return { status, statedEmbodiment };
}

export interface AdrAuditEntry {
  number: string;
  status: string;
  statedEmbodiment: string;
  specRefs: string[];
  codeRefs: string[];
  testRefs: string[];
}

// Strips the optional "or `[unaudited]`" annotation some ADRs carry on their
// Last audited field's sibling Embodiment value, and any stray backticks.
export function statedEmbodimentClean(raw: string): string {
  return raw.replace(/`[^`]*`/g, '').trim();
}

export function computeEmbodiment(
  entry: Pick<AdrAuditEntry, 'statedEmbodiment' | 'specRefs' | 'codeRefs' | 'testRefs'>
): EmbodimentState {
  if (statedEmbodimentClean(entry.statedEmbodiment).includes('Inactive')) return 'Inactive';
  if (entry.testRefs.length > 0) return 'Verified';
  if (entry.codeRefs.length > 0) return 'Implemented';
  if (entry.specRefs.length > 0) return 'Specified';
  return 'Not started';
}

export function computeDrift(
  entry: Pick<AdrAuditEntry, 'statedEmbodiment' | 'specRefs' | 'codeRefs' | 'testRefs'>
): string | null {
  const stated = statedEmbodimentClean(entry.statedEmbodiment);
  const computed = computeEmbodiment(entry);
  if (stated === computed) return null;
  return `stated='${stated}' but computed='${computed}'`;
}

export interface AuditSummaryAdr {
  number: string;
  status: string;
  stated: string;
  computed: EmbodimentState;
  drift: string | null;
  specRefs: number;
  codeRefs: number;
  testRefs: number;
}

export interface AuditSummary {
  generated: string;
  adrs: AuditSummaryAdr[];
}

// Structured data, not pre-rendered markdown, so the PR-comment posting step in CI
// isn't scraping generated markdown to get the data back out.
export function buildAuditSummary(entries: AdrAuditEntry[], generated: string): AuditSummary {
  const sorted = [...entries].sort((a, b) => a.number.localeCompare(b.number));
  return {
    generated,
    adrs: sorted.map((entry) => ({
      number: entry.number,
      status: entry.status,
      stated: statedEmbodimentClean(entry.statedEmbodiment),
      computed: computeEmbodiment(entry),
      drift: computeDrift(entry),
      specRefs: entry.specRefs.length,
      codeRefs: entry.codeRefs.length,
      testRefs: entry.testRefs.length,
    })),
  };
}

// ---------------------------------------------------------------------------
// Spec-lite structural linter (docs/specs/) — mirrors this file's ADR-linting
// section above (required sections via alias list, blocking Status/Date
// checks, warn-only dangling-reference check), kept separate rather than
// parameterizing lintAdrDir since specs and ADRs have genuinely different
// required-field shapes (no filename convention, no Y-statement, a different
// Status vocabulary). spec-lint.ts owns argv/exit/console.

export const SPEC_VALID_STATUSES = new Set(['Draft', 'Ready', 'Superseded']);
export const SPEC_STATUS_RE = /Status:\s*(\S+)/;
export const SPEC_DATE_RE = /Date:\s*(\d{4}-\d{2}-\d{2}|\S+)/;
export const SPEC_ADR_REF_RE = /\bADR-(\d{4})\b/g;

// First entry per group is the canonical Spec-lite name, used in messages; any
// entry in the group satisfies the check.
export const SPEC_REQUIRED_SECTIONS: string[][] = [
  ['Purpose', 'Objective', 'Executive Summary', 'Summary'],
  ['Design / Architecture', 'Design', 'Architecture'],
  ['Interfaces / Contracts', 'Interface Contract', 'Interfaces', 'API'],
  ['Testing & Verification', 'Testing', 'Verification'],
  ['Non-goals', 'Out of Scope', 'Out of scope'],
  ['References', 'Reference'],
];

export interface SpecFile {
  path: string;
  text: string;
}

export function checkSpec(spec: SpecFile, adrNumbers: Set<string>): Issue[] {
  const issues: Issue[] = [];

  for (const aliases of SPEC_REQUIRED_SECTIONS) {
    if (!hasSection(spec.text, aliases)) {
      const rest = aliases.slice(1).join(', ');
      issues.push({
        type: 'ERROR',
        file: spec.path,
        message: `Missing required section: '## ${aliases[0]}'${rest ? ` (or an accepted alias: ${rest})` : ''}.`,
      });
    }
  }

  const statusMatch = SPEC_STATUS_RE.exec(spec.text);
  if (statusMatch && !SPEC_VALID_STATUSES.has(statusMatch[1])) {
    issues.push({
      type: 'ERROR',
      file: spec.path,
      message: `Invalid Status '${statusMatch[1]}' — must be one of: ${[...SPEC_VALID_STATUSES].sort().join(', ')}.`,
    });
  }

  const dateMatch = SPEC_DATE_RE.exec(spec.text);
  if (dateMatch && !/^\d{4}-\d{2}-\d{2}$/.test(dateMatch[1])) {
    issues.push({
      type: 'ERROR',
      file: spec.path,
      message: `Date '${dateMatch[1]}' is not a valid YYYY-MM-DD.`,
    });
  }

  const implementsMatch = SPEC_IMPLEMENTS_ADRS_RE.exec(spec.text);
  if (implementsMatch) {
    const refs = implementsMatch[1].matchAll(SPEC_ADR_REF_RE);
    for (const ref of refs) {
      if (!adrNumbers.has(ref[1])) {
        issues.push({
          type: 'WARN',
          file: spec.path,
          message: `'Implements ADRs' references ADR-${ref[1]}, which does not exist in docs/adr/.`,
        });
      }
    }
  }

  return issues;
}

export interface SpecLintResult {
  issues: Issue[];
  specFiles: string[];
}

export function lintSpecs(specs: SpecFile[], adrNumbers: Set<string>): SpecLintResult {
  const issues: Issue[] = [];
  for (const spec of specs) {
    issues.push(...checkSpec(spec, adrNumbers));
  }
  return { issues, specFiles: specs.map((s) => s.path) };
}

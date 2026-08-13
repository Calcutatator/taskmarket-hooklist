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
import { join, resolve, sep } from 'node:path';
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

// A diff touching only these paths is a governance-only change (ADR/RFC/spec content, this
// package's own tooling, or Claude Code process configuration/commands/hooks — none of which
// ship to users or run in production) — see checkScopeMismatch below. `.claude/` was added after
// running this check against this repo's own harness-prototype branch and finding it flagged
// `.claude/commands/*.md` as "application source" alongside a real docs/rfc/ change — a false
// positive: process tooling, not product behavior, same category as packages/adr/. A test file
// anywhere counts as lower-risk regardless of path (a test doesn't itself change production
// behavior), so it's checked separately via TEST_FILE_RE, not folded into this list.
export const GOVERNANCE_PATHS = ['docs/adr/', 'docs/rfc/', 'docs/specs/', 'packages/adr/', '.claude/'];

// Single source of truth for "is this a test file" -- was independently declared in adr-audit.ts
// before being centralized here; kept in one place per this package's own duplicated-logic lesson
// (see docs/rfc back-pointer commentary in adr-audit.ts near its former declaration).
export const TEST_FILE_RE = /\.(test|spec)\.tsx?$/;

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

// Reads a field value up to the next "- **" item, "##" heading, or end of input, so a
// wrapped multi-line value (e.g. Supersedes / Superseded-by) is captured in full instead
// of truncating at the first newline. End-of-input terminates a field so these regexes
// work against a header block in isolation (see headerText) and not only against a whole
// document that happens to have a section heading after the header.
function fieldRegex(label: string): RegExp {
  // The lookahead must accept the same whitespace HEADER_FIELD_LINE_RE does — "-" followed by a
  // space *or a tab* — otherwise a tab-indented field is not recognized as the next field and gets
  // swallowed into the previous field's value.
  return new RegExp(`\\*\\*${label}:\\*\\*([\\s\\S]*?)(?=\\n-[ \\t]+\\*\\*|\\n##|$)`, 'i');
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
// Optional record-side realization pointer: "**Realized by:** <path>@<hash>[, ...]".
// adr-audit.ts checks that the path exists AND (when a hash is given) that the file's
// current content hash still matches the snapshot taken when the field was last set —
// rather than requiring a code-side back-pointer comment or requiring the path fall under
// one of CODE_ROOTS — for a decision whose realization is something adr-audit.ts doesn't
// otherwise scan (a GitHub Actions YAML workflow, or a Solidity contract in the public
// contracts mirror where this repo's own convention forbids this exact comment style in
// favor of revNNN versioning — see the real ADR-0002/0011/0025/0028 cases this closes). The
// hash exists to catch what a plain existence check can't: another developer or agent edits
// the realizing file without touching the ADR at all — the path still exists, but what it
// says may no longer match the decision. See REALIZED_BY_STALE_GRACE_DAYS.
export const REALIZED_BY_RE = fieldRegex('Realized by');
export const LAST_AUDITED_RE = fieldRegex('Last audited');

// Implements: ADR-0082
// "**Accepted:** YYYY-MM-DD" — when this ADR's Status became Accepted, which is a different
// fact from "**Date:**" (when the ADR was last meaningfully written). An ADR accepted later
// than it was drafted is the normal case, not the edge case, and before this field the
// acceptance date existed only in git history. Anchored to the list-item form so the word
// "Accepted:" appearing in prose or a table can't be misread as the field.
export const ACCEPTED_RE = /^-[ \t]+\*\*Accepted:\*\*[ \t]*(.*)$/m;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Implements: ADR-0083
// ── The header as a structure, not a slice ──────────────────────────────────
//
// Two positional heuristics for "where is the header" are known to fail, and both failures are
// silent:
//
//   1. Search the whole document. A "- **Status:** ..." bullet in the body — a status-tracking
//      list, a migration note, a documentation example — satisfies the field. This corpus
//      contains body bullets in exactly the header's shape (Precedent:, Location:, Cost:).
//   2. Slice at the first "## " heading. A record with any heading above its metadata (a dated
//      supplement on top, say) gets a near-empty header slice, and every check scoped to it
//      quietly finds nothing. That is worse than (1): it produces zero findings on a record
//      nothing validated.
//
// So the region is not defined positionally at all. The header is the maximal contiguous run of
// metadata-shaped lines, anchored at the first one: field lines, plus indented continuation
// lines belonging to the field above them (6 records here wrap a value onto a second line).
// Anything else — a blank line, a heading, unindented prose — ends the region. A document with
// no such run has NO header, which is a reportable finding rather than an empty string.
const HEADER_FIELD_LINE_RE = /^-[ \t]+\*\*([^*]+?):\*\*[ \t]*(.*)$/;
const HEADER_CONTINUATION_RE = /^[ \t]+\S/;

export type HeaderField = { key: string; value: string; line: number };
export type ParsedHeader = { found: boolean; fields: HeaderField[]; raw: string };

// A run of metadata-shaped lines is not automatically the header — a bullet list in a preamble,
// or a body list that happens to use the same shape, produces a run too. The header is the first
// run that carries the signature key every record must have; anchoring on "first run" alone lets
// a stray "- **Note:** ..." above the metadata be selected instead, which reads as a record with
// no Status at all and silently skips every check keyed off it.
const HEADER_SIGNATURE_KEY = 'Status';

export function parseHeader(content: string): ParsedHeader {
  const lines = content.split('\n');

  // Anchor on the signature key, not on position and not on "the first metadata-shaped run": a
  // run is not automatically the header (a preamble bullet forms one too), and a positional slice
  // truncates a header that sits below a heading.
  const signature = lines.findIndex(
    (l) => HEADER_FIELD_LINE_RE.exec(l)?.[1]?.trim() === HEADER_SIGNATURE_KEY
  );
  if (signature === -1) {
    // No signature key anywhere: fall back to the first metadata-shaped line so a malformed
    // document still reports against something real rather than claiming it has no header.
    const first = lines.findIndex((l) => HEADER_FIELD_LINE_RE.test(l));
    if (first === -1) return { found: false, fields: [], raw: '' };
    return collectHeader(lines, first, headerBoundary(lines, first));
  }

  // Walk back over the contiguous metadata lines above the signature, so a header whose first
  // field is not Status still starts where it actually starts.
  let start = signature;
  while (
    start > 0 &&
    (HEADER_FIELD_LINE_RE.test(lines[start - 1]) || HEADER_CONTINUATION_RE.test(lines[start - 1]))
  ) {
    start -= 1;
  }

  return collectHeader(lines, start, headerBoundary(lines, signature));
}

// Implements: ADR-0085
// The header ends at the first section heading below the signature key. A blank line or a
// blockquote inside it does NOT end it: a record may carry a dated correction block in the middle
// of its header, with roles and relationship fields below the gap, and a rule that stopped at the
// first blank line would drop them — reporting, for instance, that an Accepted record recorded no
// Decider, which is a true-looking error about a record that is fine.
function headerBoundary(lines: string[], from: number): number {
  const offset = lines.slice(from).findIndex((l) => /^##\s/.test(l));
  return offset === -1 ? lines.length : from + offset;
}

function collectHeader(lines: string[], start: number, end: number): ParsedHeader {
  const fields: HeaderField[] = [];
  let last = start;
  let inField = false;

  for (let i = start; i < end; i += 1) {
    const match = HEADER_FIELD_LINE_RE.exec(lines[i]);
    if (match) {
      fields.push({ key: match[1].trim(), value: match[2].trim(), line: i + 1 });
      last = i;
      inField = true;
      continue;
    }
    // A continuation attaches while we are still inside a field's value, which a wrapped value
    // may extend over several lines. Anything else — a blank line, a blockquote, prose — closes
    // the current field without ending the header, so an indented line after such a gap does not
    // get swallowed into the field above it.
    if (inField && HEADER_CONTINUATION_RE.test(lines[i])) {
      const previous = fields[fields.length - 1];
      previous.value = `${previous.value} ${lines[i].trim()}`.trim();
      last = i;
      continue;
    }
    inField = false;
  }

  return { found: fields.length > 0, fields, raw: lines.slice(start, last + 1).join('\n') };
}

// The header block as text, for the field regexes that parse structured values (supersession
// entries, realized-by locators) out of a raw string. Scoping them here rather than to the whole
// document is what stops a body bullet from satisfying them; fieldRegex terminates on
// end-of-input so the last field in the block still matches.
export function headerText(content: string): string {
  return parseHeader(content).raw;
}

// Keys this corpus's header is allowed to contain. The set is closed on purpose: an unrecognized
// key is the failure mode where someone adds a sensible-looking field that no tool reads and
// every reader trusts. An "x-" prefix is the declared escape hatch for a deliberate local
// extension, so the closure can be widened explicitly rather than by accident.
export const KNOWN_HEADER_KEYS = new Set([
  'Status',
  'Date',
  'Accepted',
  'Embodiment',
  'Last audited',
  'Author',
  'Reviewers',
  'Deciders',
  'Supersedes / Superseded-by',
  'Pending Supersedes / Superseded-by',
  'Amends / Amended-by',
  'Pending Amends / Amended-by',
  'Realized by',
]);

// Closure checks: the questions a per-field presence check cannot ask, because each is about the
// header as a whole rather than about any one field.
export function checkHeaderStructure(content: string, file: string): Issue[] {
  const issues: Issue[] = [];
  const header = parseHeader(content);

  if (!header.found) {
    return [
      {
        type: 'ERROR',
        file,
        message:
          'no header field block found — every ADR must open with a run of "- **Key:** value" metadata lines',
      },
    ];
  }

  const seen = new Map<string, number>();
  for (const field of header.fields) {
    seen.set(field.key, (seen.get(field.key) ?? 0) + 1);
    if (!KNOWN_HEADER_KEYS.has(field.key) && !field.key.startsWith('x-')) {
      issues.push({
        type: 'ERROR',
        file,
        message: `unknown header field "${field.key}" (line ${field.line}) — not part of the ADR schema. Add it to KNOWN_HEADER_KEYS with an ADR, or prefix it "x-" if it is a deliberate local extension`,
      });
    }
  }

  for (const [key, count] of seen) {
    if (count > 1) {
      issues.push({
        type: 'ERROR',
        file,
        message: `header field "${key}" appears ${count} times — exactly one occurrence of each key`,
      });
    }
  }

  return issues;
}

// ISO_DATE_RE checks shape only, so "2026-02-30" and "2026-13-01" pass it. Round-tripping
// through Date catches a value that looks like a date but names a day that never existed —
// worth checking for this field specifically because its historical values were machine-derived
// in bulk, where an arithmetic slip yields impossible dates rather than merely wrong ones.
function isRealCalendarDate(iso: string): boolean {
  const [year, month, day] = iso.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
}

// Statuses meaning this ADR was accepted at some point, and therefore must carry an
// acceptance date. Superseded and Deprecated are included deliberately: an ADR reaches
// either only by having been Accepted first, so dropping the requirement when it leaves
// Accepted would discard history at exactly the moment the record becomes historical.
// Proposed/Rejected/Withdrawn never were accepted, so for them the field is not merely
// optional but wrong — see checkAcceptedField.
export const ACCEPTANCE_BEARING_STATUSES = new Set(['Accepted', 'Superseded', 'Deprecated']);

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
  // Header-scoped: a "Status:" label in body prose (a status-tracking bullet list, a worked
  // example) must never be mistaken for the field. This is the decoy-text failure that a
  // whole-document search invites.
  const statusMatch = STATUS_RE.exec(headerText(content));
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
  if (!DATE_RE.test(headerText(content))) {
    return [{ type: 'ERROR', file, message: 'missing or malformed **Date:** YYYY-MM-DD' }];
  }
  return [];
}

// The acceptance date is required exactly when the status says the ADR was accepted, and
// forbidden when it says it wasn't. Both directions block: a missing date on an Accepted ADR
// loses the fact permanently (it is only otherwise recoverable by git archaeology, which
// dates the commit rather than the decision — see ADR-0082), and an acceptance date on a
// still-Proposed ADR is an agent or author asserting an approval that never happened, which
// is the same self-approval this repo's ADR command already forbids by instruction.
//
// Ordering against **Date:** is warn-only on purpose. Date means last-meaningfully-updated,
// not created, so an ADR whose Date was legitimately bumped after acceptance has
// Accepted < Date without anything being wrong. It is still worth surfacing, because the
// common cause of a large gap is a mistyped year.
export function checkAcceptedField(content: string, file: string, status: string | null): Issue[] {
  const issues: Issue[] = [];
  // Duplicate and unknown keys are checkHeaderStructure's job — closure is asked once, centrally,
  // rather than re-implemented by every field check.
  const field = parseHeader(content).fields.find((f) => f.key === 'Accepted');
  const raw = field ? field.value : null;
  const shouldHave = status !== null && ACCEPTANCE_BEARING_STATUSES.has(status);

  if (!shouldHave) {
    if (raw !== null && !isPlaceholder(raw)) {
      issues.push({
        type: 'ERROR',
        file,
        message: `Status is "${status}" but **Accepted:** records an acceptance date (${raw}) — only ${[...ACCEPTANCE_BEARING_STATUSES].join('/')} ADRs have been accepted`,
      });
    }
    return issues;
  }

  if (raw === null || isPlaceholder(raw)) {
    issues.push({
      type: 'ERROR',
      file,
      message: `Status is "${status}" but **Accepted:** is missing or blank — record the date this ADR was accepted (YYYY-MM-DD), which is a different fact from **Date:**`,
    });
    return issues;
  }

  if (!ISO_DATE_RE.test(raw) || !isRealCalendarDate(raw)) {
    issues.push({
      type: 'ERROR',
      file,
      message: `malformed **Accepted:** "${raw}" — must be a real calendar date in YYYY-MM-DD form`,
    });
    return issues;
  }

  const dateMatch = /\*\*Date:\*\*\s+(\d{4}-\d{2}-\d{2})/.exec(headerText(content));
  if (dateMatch && raw < dateMatch[1]) {
    issues.push({
      type: 'WARN',
      file,
      message: `**Accepted:** ${raw} precedes **Date:** ${dateMatch[1]} — legitimate if Date was bumped by a later revision, but check for a typo`,
    });
  }

  return issues;
}

// Status and Embodiment are orthogonal axes — one is the decision lifecycle, the other is whether
// the decision was built — but not every combination is coherent. A record that has not been
// approved cannot legitimately claim its decision is already realized: that combination means code
// shipped for a decision nobody accepted, which is the one pairing worth blocking on. It is cheap
// to check, needs no evidence beyond the two fields the record already carries, and no single-field
// check can express it.
const REALIZED_EMBODIMENTS = new Set(['Implemented', 'Verified']);

export function checkStatusEmbodimentConsistency(
  content: string,
  file: string,
  status: string | null
): Issue[] {
  if (status === null || ACCEPTANCE_BEARING_STATUSES.has(status)) return [];

  const field = parseHeader(content).fields.find((f) => f.key === 'Embodiment');
  if (!field) return [];
  // The value can carry a trailing annotation (e.g. "Verified (see ...)"), so compare the leading
  // token rather than the whole string.
  const embodiment = field.value.split(/[\s(]/)[0];
  if (!REALIZED_EMBODIMENTS.has(embodiment)) return [];

  return [
    {
      type: 'ERROR',
      file,
      message: `Status is "${status}" but Embodiment is "${embodiment}" — a decision that has not been accepted cannot already be realized. Either the decision was accepted and Status is stale, or code shipped ahead of the decision`,
    },
  ];
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
// When allowAuthorSelfReview is true, the self-ack-smell nudge is suppressed (an author may
// stand as their own reviewer/decider); a blank Deciders on an Accepted ADR still blocks.
export function checkAuthorReviewersDeciders(
  content: string,
  file: string,
  status: string | null,
  allowAuthorSelfReview = false,
): Issue[] {
  const issues: Issue[] = [];
  const author = fieldValue(headerText(content), AUTHOR_RE);
  const reviewers = fieldValue(headerText(content), REVIEWERS_RE);
  const deciders = fieldValue(headerText(content), DECIDERS_RE);

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
  if (!allowAuthorSelfReview && !isPlaceholder(author)) {
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

// Implements: ADR-0033
// ---------------------------------------------------------------------------
// Structured document index tracking (docs/adr/index.yaml, docs/rfc/index.yaml, and any future
// numbered-doc directory with the same shape) — see ADR-0033. A README's own hand-maintained
// index table/list is a second copy of number/title/status/date that already lives
// structurally in each document's own header — the exact class of drift a code-review tool
// caught for real in this repo's ADR index (stale statuses weeks after the ADRs themselves
// changed, missed because the old presence-only check never verified the details next to a
// number were still accurate). Generalized here rather than duplicated per doc kind: one set of
// pure functions, parameterized by where the generated files live and what marker/YAML-header
// text each doc kind uses; a generated index.yaml is the real source of truth, the README's
// rendered view is spliced between marker comments so it can never independently drift.

export interface DocIndexEntry {
  number: string;
  file: string;
  title: string;
  status: string;
  date: string;
}

const DOC_TITLE_RE = /^#\s*\d{4}\s*—\s*(.+?)\s*$/m;
const DOC_DATE_VALUE_RE = /\*\*Date:\*\*\s+(\d{4}-\d{2}-\d{2})/;

export function parseDocIndexEntry(file: string, content: string): DocIndexEntry {
  const number = file.slice(0, 4);
  // Header fields come from the header, not the document: a body bullet or a quoted example in
  // the same shape would otherwise decide what the generated index says this record's status is.
  const header = headerText(content);
  const title = DOC_TITLE_RE.exec(content)?.[1] ?? 'unknown';
  const status = STATUS_RE.exec(header)?.[1] ?? 'unknown';
  const date = DOC_DATE_VALUE_RE.exec(header)?.[1] ?? 'unknown';
  return { number, file, title, status, date };
}

function yamlScalar(s: string): string {
  if (s === '' || /^\s|\s$/.test(s) || /[:#\-[\]{}&*!|>'"%@`,]/.test(s)) {
    return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  }
  return s;
}

export interface DocIndexYamlOptions {
  // Lines placed after the yaml-language-server pragma, before the root key -- doc-kind-specific
  // provenance text (which script generates it, which ADR governs it, where the rendered view lives).
  headerComment: string[];
  // YAML root key, e.g. "adrs" or "rfcs".
  rootKey: string;
}

// Deliberately hand-rolled, not a general YAML library: the shape is a fixed flat list of flat
// objects, small enough that a real emitter would be more surface area than the format itself.
// Parsing arbitrary YAML back in would be a different story -- this file only ever writes it.
export function renderDocIndexYaml(entries: DocIndexEntry[], opts: DocIndexYamlOptions): string {
  const sorted = [...entries].sort((a, b) => a.number.localeCompare(b.number));
  const lines = ['# yaml-language-server: $schema=./index.schema.json', ...opts.headerComment, `${opts.rootKey}:`];
  for (const e of sorted) {
    lines.push(`  - number: "${e.number}"`);
    lines.push(`    file: ${yamlScalar(e.file)}`);
    lines.push(`    title: ${yamlScalar(e.title)}`);
    lines.push(`    status: ${yamlScalar(e.status)}`);
    lines.push(`    date: ${yamlScalar(e.date)}`);
  }
  return lines.join('\n') + '\n';
}

// Matches this repo's existing "- [NNNN — Title](file.md)" bullet-list index style -- the one
// rendered view both ADRs and RFCs use here (a markdown table is an equally valid rendering of
// the same underlying data; this repo standardizes on the bullet-list style across doc kinds).
export function renderDocIndexList(entries: DocIndexEntry[]): string {
  const sorted = [...entries].sort((a, b) => a.number.localeCompare(b.number));
  return sorted.map((e) => `- [${e.number} — ${e.title}](${e.file})`).join('\n');
}

// Group 2 deliberately does not require a specific newline count around it (checked only via
// .trim() below, and reconstructed with an explicit newline on each side by the caller) --
// when the content between markers is genuinely empty (a freshly-added stub with nothing
// generated into it yet), there's exactly one newline separating START and END, not two.
export function buildIndexMarkerRe(label: string): RegExp {
  return new RegExp(`(<!-- ${label}:START.*?-->)([\\s\\S]*?)(<!-- ${label}:END -->)`);
}

export const ADR_INDEX_MARKER_RE = buildIndexMarkerRe('ADR-INDEX');
export const RFC_INDEX_MARKER_RE = buildIndexMarkerRe('RFC-INDEX');

export interface DocIndexFreshnessOptions {
  yamlFilePath: string; // e.g. "docs/adr/index.yaml" -- used only in Issue.file/messages
  readmeFilePath: string; // e.g. "docs/adr/README.md"
  markerRe: RegExp;
  markerLabel: string; // e.g. "ADR-INDEX" -- used only in messages
  yamlOptions: DocIndexYamlOptions;
}

// Blocking: <kind>/index.yaml and README's generated list block must both match what the
// current document corpus actually says. Either argument being null means the artifact is
// entirely missing (a real error, not "nothing to check" -- staleness is exactly the failure
// mode this exists to catch).
export function checkDocIndexFreshness(
  entries: DocIndexEntry[],
  currentIndexYaml: string | null,
  currentReadme: string | null,
  opts: DocIndexFreshnessOptions
): Issue[] {
  const issues: Issue[] = [];
  const expectedYaml = renderDocIndexYaml(entries, opts.yamlOptions);
  if (currentIndexYaml === null) {
    issues.push({ type: 'ERROR', file: opts.yamlFilePath, message: 'missing -- run the audit tool to generate it' });
  } else if (currentIndexYaml !== expectedYaml) {
    issues.push({
      type: 'ERROR',
      file: opts.yamlFilePath,
      message: 'stale -- does not match current titles/statuses/dates; re-run the audit tool to regenerate it',
    });
  }

  if (currentReadme === null) {
    issues.push({ type: 'ERROR', file: opts.readmeFilePath, message: 'missing -- the generated index table has nowhere to live' });
    return issues;
  }
  const m = opts.markerRe.exec(currentReadme);
  if (!m) {
    issues.push({
      type: 'ERROR',
      file: opts.readmeFilePath,
      message: `missing ${opts.markerLabel} markers -- the generated index list block was removed or renamed`,
    });
    return issues;
  }
  const expectedList = renderDocIndexList(entries);
  if (m[2].trim() !== expectedList.trim()) {
    issues.push({
      type: 'ERROR',
      file: opts.readmeFilePath,
      message: `index list between ${opts.markerLabel} markers is stale -- re-run the audit tool to regenerate it`,
    });
  }
  return issues;
}

export const ADR_INDEX_YAML_OPTIONS: DocIndexYamlOptions = {
  headerComment: [
    '# Auto-generated by packages/adr/adr-audit.ts -- do not hand-edit.',
    '# Structured source of truth for the ADR index (see ADR-0033). docs/adr/README.md\'s own',
    '# "## Index" list is rendered FROM this file, not maintained independently.',
  ],
  rootKey: 'adrs',
};

export const ADR_INDEX_FRESHNESS_OPTIONS: DocIndexFreshnessOptions = {
  yamlFilePath: 'docs/adr/index.yaml',
  readmeFilePath: 'docs/adr/README.md',
  markerRe: ADR_INDEX_MARKER_RE,
  markerLabel: 'ADR-INDEX',
  yamlOptions: ADR_INDEX_YAML_OPTIONS,
};

// The `Implements:` back-pointer parser (findImplementsRefs) is defined below, next to
// the audit's back-pointer scanning, so the gate and the audit share one parser.

/**
 * Status-aware remediation text for a back-pointer to a non-Accepted ADR.
 * A retired decision (Superseded/Deprecated) was accepted and then replaced, so
 * telling the author to "accept it" is wrong -- the fix is to repoint the marker.
 */
export function implementsGateMessage(number: string, status: string): string {
  if (status === 'Superseded' || status === 'Deprecated') {
    return `implements ADR-${number} (Status: ${status}) — repoint this back-pointer to its successor / the current decision; a retired decision is not a live realization target`;
  }
  return `implements ADR-${number}, which is not Accepted (Status: ${status}) — a human Decider must accept it (Status: Accepted) before the implementation can merge`;
}

/**
 * Blocking: application source that claims to implement an ADR must not merge while that ADR
 * is anything other than `Accepted`.
 *
 * This exists because the convention was stated and then not honoured. ADR-0039 said in its own
 * text that the implementation "must not merge until a human Decider accepts this ADR"; PR #410
 * merged to `main` anyway with the ADR still `Proposed` and no Decider, because nothing checked.
 * Prose in an ADR is not a gate. This is. Realization evidence for a decision that has not been
 * accepted -- or is no longer the accepted one (Superseded/Deprecated) -- is a contradiction.
 *
 * Scope is deliberately narrow on the ADR side. Adding a non-Accepted ADR on its own is fine and
 * expected -- that is how a decision gets drafted for review. What is blocked is shipping the code
 * that carries its `Implements: ADR-NNNN` marker before a human has recorded the decision.
 */
export function checkProposedAdrImplementation(
  changedFiles: string[],
  repoRoot: string,
  statusByNumber: Map<string, string>
): Issue[] {
  if (changedFiles.length === 0) return [];

  const issues: Issue[] = [];
  const sourceFiles = changedFiles.filter(
    (f) => COVERAGE_PATHS.some((p) => f.startsWith(p)) && !TEST_FILE_RE.test(f)
  );

  for (const file of sourceFiles) {
    let content: string;
    try {
      content = readFileSync(join(repoRoot, file), 'utf8');
    } catch (e) {
      // Only a genuinely absent file means "deleted in this diff". Any other read failure
      // (permissions, path is a directory) would otherwise let a real file skip the gate.
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
      continue;
    }

    const claimed = new Set<string>(findImplementsRefs(content));

    for (const number of [...claimed].sort()) {
      const status = statusByNumber.get(number);
      // Only an Accepted ADR is a valid realization target. Anything else --
      // Draft, Proposed, Superseded, Deprecated, Withdrawn -- fails: realization
      // evidence for a decision that has not been (or is no longer) the accepted
      // one is a contradiction. An unknown ADR is a dangling ref, a different check.
      if (status === undefined || status === 'Accepted') continue;
      issues.push({
        type: 'ERROR',
        file,
        message: implementsGateMessage(number, status),
      });
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

// The mirror-image check to checkCoverage above: that one flags application source changing
// without a governance-path change; this one flags a governance-path change (docs/adr/,
// docs/rfc/, docs/specs/, or this package's own tooling) bundled in the *same diff* as real,
// non-test application source -- the "a docs-scoped branch quietly also carried a production
// behavior change" case. Warn-only, matching this repo's own established blocking-vs-warn
// calibration ("is this a governance gap with no one answerable, or useful-but-not-worth-
// blocking" -- see docs/adr/README.md): a governance pass legitimately does sometimes need a
// real, small code fix (e.g. a mechanical fix to this package's own tooling alongside doc
// changes), so this surfaces "needs elevated review" rather than hard-blocking a case that might
// be entirely legitimate.
export function checkScopeMismatch(changedFiles: string[]): Issue[] {
  const governanceFiles = changedFiles.filter((f) => GOVERNANCE_PATHS.some((p) => f.startsWith(p)));
  if (governanceFiles.length === 0) return [];
  const nonGovernanceSourceFiles = changedFiles.filter(
    (f) => !GOVERNANCE_PATHS.some((p) => f.startsWith(p)) && !TEST_FILE_RE.test(f)
  );
  if (nonGovernanceSourceFiles.length === 0) return [];
  return [
    {
      type: 'WARN',
      file: nonGovernanceSourceFiles[0],
      message:
        `this diff mixes a governance-path change (e.g. ${governanceFiles[0]}) with ` +
        `${nonGovernanceSourceFiles.length} non-test application-source file(s) (e.g. ` +
        `${nonGovernanceSourceFiles[0]}) — if this is a real behavior change, it needs review ` +
        `beyond a docs/governance pass, not just a green ADR/RFC/spec lint`,
    },
  ];
}

// Shared by adr-lint.ts and scope-check.ts (both need "what changed in this diff" against a base
// ref) so the git-invocation logic exists in exactly one place, not two independently-maintained
// copies. Throws on a real git failure (bad ref, shallow clone) rather than swallowing it — each
// CLI wrapper decides how to surface that (this repo's own fail-loud convention: a caller that
// explicitly asked for a diff and got a git error should hear about it, not silently fall back to
// "nothing changed").
export function resolveGitDiffChangedFiles(repoRoot: string, base: string): string[] {
  // -z: NUL-delimited, verbatim paths — without it git quotes non-ASCII filenames
  // (core.quotePath) so they drop out of the diff scan; splitting on NUL also
  // preserves any leading/trailing whitespace in a changed filename.
  const diff = execFileSync('git', ['diff', '--name-only', '-z', `${base}...HEAD`], {
    cwd: repoRoot,
    encoding: 'utf-8',
  });
  return diff.split('\0').filter((f) => f.length > 0);
}

// The Implements gate can look at only the files changed in this push ('diff')
// or every tracked source file ('whole-corpus'). A committed config selects
// which; the built-in default is 'whole-corpus' so a missing or malformed
// config never silently narrows coverage -- the safe failure is to check more.
export type LintScope = 'diff' | 'whole-corpus';

export function coerceScope(value: string | null | undefined): LintScope | null {
  return value === 'diff' || value === 'whole-corpus' ? value : null;
}

// Resolve allow_author_self_review from its two sources with the CLI's precedence:
// an env value (when set) wins, else the config-file value when boolean, else the
// default false. Pure — the CLI reads the file/env and passes the raw values in, so
// the precedence itself is unit-testable without touching the filesystem.
export function coerceAllowAuthorSelfReview(fileValue: unknown, envValue: string | null | undefined): boolean {
  if (envValue !== undefined && envValue !== null) return /^(1|true|yes|on)$/i.test(envValue.trim());
  if (typeof fileValue === 'boolean') return fileValue;
  return false;
}

// Every tracked file under the coverage paths -- the file set the gate scans in
// whole-corpus mode. `git ls-files`, so an untracked scratch file is excluded
// the same way the rest of the linter scopes to tracked content.
export function resolveTrackedSourceFiles(repoRoot: string): string[] {
  // -z: NUL-delimited, verbatim paths. Without it git quotes non-ASCII filenames
  // (core.quotePath) so they drop out of whole-corpus scanning; splitting on NUL
  // also preserves any leading/trailing whitespace in a tracked filename.
  const out = execFileSync('git', ['ls-files', '-z', '--', ...COVERAGE_PATHS], {
    cwd: repoRoot,
    encoding: 'utf-8',
  });
  return out.split('\0').filter((f) => f.length > 0);
}

// ---------------------------------------------------------------------------
// Citation-existence checking (introduced by PR #370). Built after a real false-positive finding: a
// generated document cited a real file, a naive existsSync-style check reported it as missing
// (it was real, just sitting in an open, not-yet-merged PR, invisible to the current checkout),
// and that was wrongly asserted as a fabricated reference. The fix isn't "check harder" -- it's
// making every existence claim state its own scope explicitly, so "not found in the working
// tree" (weak, working-tree-scoped) is never conflated with "does not exist" (a claim no single
// fs check can actually make). See checkFilePathCitations' message text and checkPrCitations'
// use of a scope (the real repo, via `gh`) that resolves regardless of merge state.
// ---------------------------------------------------------------------------

// Deliberately a strict, single-heading match (not hasSection's alias-tolerant one above) --
// every ADR/RFC/spec template in this repo uses exactly "## References", so a strict match keeps
// extraction unambiguous rather than risking a false match on prose that merely mentions the
// word.
//
// No `m` flag: a lookbehind handles the "start of line" anchor instead, because `m` would also
// redefine the closing `$` to mean end-of-line rather than end-of-string, breaking the
// "run to end of file when no next section follows" case -- the exact bug already documented
// (and fixed the same way) elsewhere in this codebase's own regex-extraction history; this
// function's first draft made the identical mistake before a live test against a References-last
// document caught it.
export function extractReferencesSection(content: string): string | null {
  const match = /(?<=^|\n)##\s+References\b[ \t]*\n([\s\S]*?)(?=\n##\s|\s*$)/i.exec(content);
  return match ? match[1] : null;
}

// A citation is a backtick-quoted, repo-relative-looking path: at least one "/" and a file
// extension. Deliberately scoped to the References section only (never the whole document) --
// a code snippet elsewhere in a spec's Design/Architecture section can contain backtick-quoted
// paths that illustrate what a change touches, not a claim that the path already exists.
const CITED_FILE_PATH_RE = /`([a-zA-Z0-9_.-]+(?:\/[a-zA-Z0-9_.-]+)+\.[a-zA-Z0-9]+)`/g;

export function extractCitedFilePaths(referencesSection: string): string[] {
  const paths = new Set<string>();
  const re = new RegExp(CITED_FILE_PATH_RE);
  let match: RegExpExecArray | null;
  while ((match = re.exec(referencesSection)) !== null) {
    paths.add(match[1]);
  }
  return [...paths];
}

// Matches GitHub's own "#123" shorthand or a full .../pull/123 URL. Requires the leading "#" or
// "/pull/" so this can never collide with an ADR-NNNN reference (checkDanglingReferences above),
// which has its own, already-blocking check.
//
// Named "GithubNumber", not "Pr": GitHub's own numbering is a single shared sequence across
// issues and pull requests -- a bare "#123" citation is not necessarily a PR (a live check
// against this repo's real corpus found several "#NNN" citations that were real, closed
// *issues*, misreported as fake PRs by an earlier version of this check that only queried the
// pulls endpoint). Checking existence against the issues endpoint (which GitHub's own API
// returns for both issues and PRs -- a PR is a special kind of issue in its data model) is the
// correct scope for the bare-number form.
const CITED_GITHUB_NUMBER_RE = /(?:^|\s)#(\d+)\b|\/pull\/(\d+)\b/g;

export function extractCitedGithubNumbers(referencesSection: string): string[] {
  const numbers = new Set<string>();
  const re = new RegExp(CITED_GITHUB_NUMBER_RE);
  let match: RegExpExecArray | null;
  while ((match = re.exec(referencesSection)) !== null) {
    numbers.add((match[1] ?? match[2]) as string);
  }
  return [...numbers];
}

// exists() is dependency-injected rather than this function calling fs.existsSync directly --
// testable without a real filesystem, and it forces the caller to supply (and, via scopeLabel,
// state honestly) what "exists" actually means here. Warn-only: a citation problem is a
// content-accuracy issue to flag, matching this repo's own blocking-vs-warn calibration
// ("governance gap with no one answerable" vs. "useful but not worth blocking a merge" --
// docs/adr/README.md), not a governance-accountability gap the way a missing Deciders value is.
/**
 * True when `candidate` (resolved relative to `root`) stays inside `root`. Guards
 * the citation-existence probe: a `## References` path like `../../../etc/x.conf`
 * would otherwise let the existence check report on files anywhere on the host,
 * turning the linter into a file-existence oracle driven by document content.
 * Pure (path math only, no fs), so it's unit-tested directly.
 */
export function pathIsInsideRoot(root: string, candidate: string): boolean {
  const resolved = resolve(root, candidate);
  return resolved === root || resolved.startsWith(root + sep);
}

/**
 * Symlink-aware variant of pathIsInsideRoot. The lexical check above stops `..`
 * traversal, but `existsSync` *follows symlinks* — so a path that is lexically
 * inside `root` can still be (or pass through) a symlink whose target escapes it,
 * re-opening the file-existence oracle. Resolves both `root` and the candidate
 * through the injected `realpath` and re-checks containment on the real paths.
 * Returns false when the candidate does not exist (realpath throws) — so this also
 * *is* the existence check, no separate stat needed. `realpath` is injected (not
 * imported) so lib.ts stays fs-free and this is exercised against a real temp
 * filesystem rather than a mock.
 */
export function pathIsInsideRootReal(
  root: string,
  candidate: string,
  realpath: (p: string) => string,
): boolean {
  if (!pathIsInsideRoot(root, candidate)) return false;
  try {
    return pathIsInsideRoot(realpath(root), realpath(resolve(root, candidate)));
  } catch {
    return false;
  }
}

export function checkFilePathCitations(
  citedPaths: string[],
  file: string,
  exists: (path: string) => boolean,
  scopeLabel: string
): Issue[] {
  return citedPaths
    .filter((path) => !exists(path))
    .map((path) => ({
      type: 'WARN' as const,
      file,
      message:
        `citation \`${path}\` not found in ${scopeLabel} — if it belongs to an unmerged PR or a ` +
        `different branch, say so explicitly in the citation text rather than as a bare path`,
    }));
}

export function checkGithubNumberCitations(citedNumbers: string[], file: string, numberExists: (n: string) => boolean): Issue[] {
  return citedNumbers
    .filter((n) => !numberExists(n))
    .map((n) => ({ type: 'WARN' as const, file, message: `citation #${n} does not resolve to a real issue or pull request on this repo` }));
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

// A doc-dir member file (docs/adr/*.md, docs/rfc/*.md): any markdown file except the
// directory's own README and underscore-prefixed files (_template.md, etc.). The single
// source of truth for this filter -- lintAdrDir, lintRfcDir, and anything that needs to
// reconstruct the same file set (e.g. a test fixture generating a matching index.yaml) all
// call this instead of each restating the three conditions independently, which is exactly
// how a hand-maintained index goes stale: the same fact, stated more than once, drifts.
export function isDocDirMemberFile(name: string): boolean {
  return name.endsWith('.md') && name !== 'README.md' && !name.startsWith('_');
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
export function lintAdrDir(
  adrDir: string,
  changedFiles: string[] = [],
  repoRoot: string = adrDir,
  // Files the Implements gate scans. Distinct from changedFiles (which drives
  // the source-changed-without-an-ADR coverage warning): in whole-corpus mode
  // the gate looks at every tracked source file, not just this push's diff.
  // Defaults to changedFiles so existing callers keep diff-scoped behavior.
  gateFiles: string[] = changedFiles,
  // When true, an author who also appears as reviewer/decider does not raise the
  // self-ack-smell warning. Defaults to false so existing callers are unchanged.
  allowAuthorSelfReview = false
): LintResult {
  const issues: Issue[] = [];

  let adrFiles: string[];
  try {
    const trackedFiles = resolveGitTrackedOrStagedFiles(adrDir, repoRoot);
    adrFiles = filterToTracked(
      readdirSync(adrDir).filter(isDocDirMemberFile),
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
    issues.push(...checkHeaderStructure(content, file));

    const { issues: statusIssues, status } = checkStatusField(content, file);
    issues.push(...statusIssues);
    statusByFile.set(file.slice(0, 4), status);

    issues.push(...checkDateField(content, file));
    issues.push(...checkAcceptedField(content, file, status));
    issues.push(...checkStatusEmbodimentConsistency(content, file, status));
    issues.push(...checkRequiredSections(content, file));
    issues.push(...checkYStatement(content, file));
    issues.push(...checkConsideredOptionsMinimum(content, file));
    issues.push(...checkAuthorReviewersDeciders(content, file, status, allowAuthorSelfReview));
  }

  // Supersession symmetry + direction, binding for Accepted-lineage ADRs
  // and warn-only (checked against the Pending field) for still-Proposed
  // ones — see checkSupersessionReciprocity above.
  const supersessionMap = new Map<string, SupersessionEntry[]>();
  const pendingSupersessionMap = new Map<string, SupersessionEntry[]>();
  for (const file of adrFiles) {
    const content = contentsByFile.get(file)!;
    const num = file.slice(0, 4);

    const entries = extractSupersessionEntries(fieldValue(headerText(content), SUPERSEDES_RE) ?? '');
    if (entries.length > 0) supersessionMap.set(num, entries);

    const pendingEntries = extractSupersessionEntries(
      fieldValue(headerText(content), PENDING_SUPERSEDES_RE) ?? ''
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

    const entries = extractAmendmentEntries(fieldValue(headerText(content), AMENDS_RE) ?? '');
    if (entries.length > 0) amendmentMap.set(num, entries);

    const pendingEntries = extractAmendmentEntries(fieldValue(headerText(content), PENDING_AMENDS_RE) ?? '');
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
  const indexYamlPath = join(adrDir, 'index.yaml');
  const indexYamlContent = existsSync(indexYamlPath) ? readFileSync(indexYamlPath, 'utf8') : null;
  const indexEntries = adrFiles.map((file) => parseDocIndexEntry(file, contentsByFile.get(file)!));
  issues.push(...checkDocIndexFreshness(indexEntries, indexYamlContent, readmeContent, ADR_INDEX_FRESHNESS_OPTIONS));

  issues.push(...checkCoverage(changedFiles));

  const resolvedStatuses = new Map<string, string>();
  for (const [number, status] of statusByFile) {
    if (status) resolvedStatuses.set(number, status);
  }
  issues.push(...checkProposedAdrImplementation(gateFiles, repoRoot, resolvedStatuses));

  return { issues, adrFiles };
}

export const RFC_INDEX_YAML_OPTIONS: DocIndexYamlOptions = {
  headerComment: [
    '# Auto-generated by packages/adr/adr-audit.ts -- do not hand-edit.',
    '# Structured source of truth for the RFC index. docs/rfc/README.md\'s own',
    '# "## Index" list is rendered FROM this file, not maintained independently.',
  ],
  rootKey: 'rfcs',
};

export const RFC_INDEX_FRESHNESS_OPTIONS: DocIndexFreshnessOptions = {
  yamlFilePath: 'docs/rfc/index.yaml',
  readmeFilePath: 'docs/rfc/README.md',
  markerRe: RFC_INDEX_MARKER_RE,
  markerLabel: 'RFC-INDEX',
  yamlOptions: RFC_INDEX_YAML_OPTIONS,
};

export interface RfcLintResult {
  issues: Issue[];
  rfcFiles: string[];
}

// RFCs are deliberately NOT structurally linted the way ADRs are (docs/rfc/README.md: "RFCs are
// proposals, not commitments, and the current volume doesn't justify the tooling") -- this
// checks only index freshness, the same narrow, low-noise mechanical property the ADR check
// enforces, not Y-statement structure, considered-options, or any of the checks lintAdrDir also
// runs. A hand-maintained index can go stale regardless of how loosely the documents themselves
// are governed; that's a property of having two copies of the same facts, not of RFC rigor.
export function lintRfcDir(rfcDir: string, repoRoot: string = rfcDir): RfcLintResult {
  let rfcFiles: string[];
  try {
    const trackedFiles = resolveGitTrackedOrStagedFiles(rfcDir, repoRoot);
    rfcFiles = filterToTracked(
      readdirSync(rfcDir).filter(isDocDirMemberFile),
      rfcDir,
      trackedFiles
    ).sort();
  } catch {
    return {
      issues: [{ type: 'ERROR', file: '(rfc-dir)', message: `docs/rfc directory not found at ${rfcDir}` }],
      rfcFiles: [],
    };
  }

  const contentsByFile = new Map<string, string>();
  for (const file of rfcFiles) {
    contentsByFile.set(file, readFileSync(join(rfcDir, file), 'utf8'));
  }

  const readmePath = join(rfcDir, 'README.md');
  const readmeContent = existsSync(readmePath) ? readFileSync(readmePath, 'utf8') : null;
  const indexYamlPath = join(rfcDir, 'index.yaml');
  const indexYamlContent = existsSync(indexYamlPath) ? readFileSync(indexYamlPath, 'utf8') : null;
  const indexEntries = rfcFiles.map((file) => parseDocIndexEntry(file, contentsByFile.get(file)!));
  const issues = checkDocIndexFreshness(indexEntries, indexYamlContent, readmeContent, RFC_INDEX_FRESHNESS_OPTIONS);

  return { issues, rfcFiles };
}

// ── Embodiment (realization) audit ──────────────────────────────────────────
//
// Pure functions only — see docs/adr/README.md's "Embodiment (realization tracking)"
// section for the full rationale. adr-audit.ts owns the filesystem walk (docs/adr/,
// docs/specs/, apps/, packages/shared/) and CLI/report-writing; this section only
// computes state from already-extracted text/back-pointer counts, so it's directly
// unit-testable without touching disk.

export type EmbodimentState = 'Not started' | 'Specified' | 'Implemented' | 'Verified' | 'Inactive' | 'Deprecated';

// Matches a spec file header's back-pointer to one or more ADRs, e.g.
// "**Implements ADRs:** ADR-0042, ADR-0043" — table-row or blockquote/plain forms
// both match since only the bold-marker + label + colon are anchored.
export const SPEC_IMPLEMENTS_ADRS_RE = /\*\*Implements ADRs:?\*\*:?\s*[:|]?\s*([^\n|]+)/i;

// A back-pointer marker may list more than one ADR on a single line. We anchor on the
// marker once, then pull every ADR-NNNN from the rest of that line, so each listed ADR
// is credited. Examples (self-ignored by the scan so these illustrative markers aren't
// counted as real evidence):
//   Implements: ADR-0045, ADR-0050                  adr-scan:ignore-line
//   Implements: ADR-0045 (Task Awards), ADR-0050    adr-scan:ignore-line
// A bare ADR-NNNN inside a free-text annotation also counts as a back-pointer; keep
// annotations free of bare ADR-NNNN values when they must not create one.
const IMPLEMENTS_LINE_RE = /\bImplements:([^\n]*)/g;
const VERIFIES_LINE_RE = /\bVerifies:([^\n]*)/g;
// Word boundaries so only a complete four-digit ADR reference matches — ADR-00450 is
// not read as ADR-0045.
const ADR_REF_RE = /\bADR-(\d{4})\b/g;

function findMarkerRefs(lineRe: RegExp, content: string): string[] {
  const nums: string[] = [];
  const lr = new RegExp(lineRe.source, 'g');
  let line: RegExpExecArray | null;
  while ((line = lr.exec(content)) !== null) {
    const rr = new RegExp(ADR_REF_RE.source, 'g');
    let ref: RegExpExecArray | null;
    while ((ref = rr.exec(line[1])) !== null) nums.push(ref[1]);
  }
  return nums;
}

// Every ADR back-pointed by an "Implements:" marker, scanning each marker line's full
// tail (see the note above). Order-preserving; duplicates kept (callers dedupe).
export function findImplementsRefs(content: string): string[] {
  return findMarkerRefs(IMPLEMENTS_LINE_RE, content);
}

// Every ADR back-pointed by a "Verifies:" marker (test back-pointers). Same whole-line
// tail scan as findImplementsRefs.
export function findVerifiesRefs(content: string): string[] {
  return findMarkerRefs(VERIFIES_LINE_RE, content);
}

// A pure grep/regex scan can't tell "real evidence" apart from "a string that merely looks
// like evidence" (a docstring example, a test fixture for the parser itself, sample text in a
// README). This repo's own tooling hits that exact case: packages/adr's test fixtures for the
// back-pointer parser necessarily contain literal "Implements: ADR-NNNN"
// text, and adr-audit.ts's whole-repo scan would otherwise count them as real. The fix is an
// explicit out-of-band signal, not a scan-root exclusion (which would just as wrongly hide
// genuine back-pointers elsewhere in the same file) or string-obfuscating the fixture (fragile,
// and doesn't generalize past this one case): a trailing marker comment on the source line
// itself, checked by stripIgnoredLines() before any back-pointer regex ever sees the content.
export const ADR_SCAN_IGNORE_MARKER = 'adr-scan:ignore-line';

// Blanks any line containing ADR_SCAN_IGNORE_MARKER before back-pointer scanning. Applied to
// real file content read from disk (adr-audit.ts), never to an in-memory string passed
// directly to a function under test — a test asserting what the back-pointer parser
// extracts from a string still gets the real, unblanked string; the marker
// only tells the *outer* whole-repo scan to skip that physical source line.
export function stripIgnoredLines(content: string): string {
  return content
    .split('\n')
    .map((line) => (line.includes(ADR_SCAN_IGNORE_MARKER) ? '' : line))
    .join('\n');
}

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
export function parseAdrHeaderFields(
  content: string
): { status: string; statedEmbodiment: string; realizedByLocators: RealizedByLocator[]; lastAudited: string | null } {
  // All four read from the header. Two of them did not, which is the shape of miss that
  // reintroduces the body-prose match one field at a time.
  const header = headerText(content);
  const status = STATUS_RE.exec(header)?.[1] ?? 'unknown';
  const statedEmbodiment = EMBODIMENT_RE.exec(header)?.[1]?.trim() ?? 'unknown';
  const realizedByLocators = parseRealizedByLocators(fieldValue(header, REALIZED_BY_RE));
  const lastAudited = fieldValue(header, LAST_AUDITED_RE);
  return { status, statedEmbodiment, realizedByLocators, lastAudited };
}

export interface RealizedByLocator {
  path: string;
  // null = no hash tracking requested for this locator — falls back to existence-only,
  // matching the field's original (pre-hash) shape so existing "Realized by: <path>" entries
  // with no "@hash" suffix keep working unchanged.
  hash: string | null;
}

/**
 * Parses a "**Realized by:**" field's raw captured text into individual `{path, hash}`
 * locators. Comma-separated; each entry is `path` or `path@hash`. "—" (the standard
 * empty-field placeholder) and blank/whitespace-only input both mean "no locators declared",
 * not a single empty-string locator.
 */
export function parseRealizedByLocators(raw: string | null): RealizedByLocator[] {
  if (!raw) return [];
  const trimmed = raw.trim();
  if (trimmed === '' || trimmed === '—') return [];
  return trimmed
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((entry) => {
      const at = entry.lastIndexOf('@');
      if (at === -1) return { path: entry, hash: null };
      return { path: entry.slice(0, at).trim(), hash: entry.slice(at + 1).trim() };
    });
}

/** Inverse of parseRealizedByLocators — used by the (optional) hash-refresh CLI step. */
export function formatRealizedByLocators(locators: RealizedByLocator[]): string {
  return locators.map((l) => (l.hash ? `${l.path}@${l.hash}` : l.path)).join(', ');
}

// How many days a hash mismatch is tolerated as still-fresh evidence before the audit stops
// giving it the benefit of the doubt and counts it as real drift. Overridable via
// .adrrc.json's realizedByStaleGraceDays.
export const REALIZED_BY_STALE_GRACE_DAYS = 28;

export interface RealizedByCheckResult {
  path: string;
  fresh: boolean; // counts as evidence for this audit run
  hashChanged: boolean; // informational — true even when still `fresh` (i.e. still in grace)
}

/**
 * Checks one locator against its current on-disk hash. Kept fs-free (the caller supplies
 * `currentHash`) so this stays unit-testable without touching disk — adr-audit.ts supplies
 * the real git-backed hash in production.
 *
 * - Missing file (`currentHash === null`): never fresh, regardless of grace period.
 * - No hash recorded on the locator: existence alone is enough (pre-hash behavior, unchanged).
 * - Hash matches: fresh, nothing changed since the snapshot.
 * - Hash differs: still fresh *within* the grace period (a real code change isn't
 *   automatically a broken decision — it's a signal to go re-verify, not an instant failure);
 *   past the grace period, no longer fresh.
 */
export function checkRealizedByLocator(
  locator: RealizedByLocator,
  currentHash: string | null,
  daysSinceLastAudited: number,
  graceDays: number = REALIZED_BY_STALE_GRACE_DAYS
): RealizedByCheckResult {
  if (currentHash === null) return { path: locator.path, fresh: false, hashChanged: false };
  if (locator.hash === null) return { path: locator.path, fresh: true, hashChanged: false };
  if (currentHash === locator.hash) return { path: locator.path, fresh: true, hashChanged: false };
  return { path: locator.path, fresh: daysSinceLastAudited <= graceDays, hashChanged: true };
}

/**
 * Resolves a full "**Realized by:**" locator list against an injected current-hash lookup.
 *
 * AND semantics: every listed locator must be fresh, or none of them count as evidence — a
 * genuinely multi-part claim can't get credit for a claim about its weakest missing/stale part.
 */
export function resolveRealizedByRefs(
  locators: RealizedByLocator[],
  getCurrentHash: (path: string) => string | null,
  daysSinceLastAudited: number,
  graceDays: number = REALIZED_BY_STALE_GRACE_DAYS
): { refs: string[]; staleWarnings: string[] } {
  if (locators.length === 0) return { refs: [], staleWarnings: [] };
  const results = locators.map((l) => checkRealizedByLocator(l, getCurrentHash(l.path), daysSinceLastAudited, graceDays));
  const allFresh = results.every((r) => r.fresh);
  if (!allFresh) return { refs: [], staleWarnings: [] };
  return { refs: results.map((r) => r.path), staleWarnings: results.filter((r) => r.hashChanged).map((r) => r.path) };
}

// Minimal glob support: '**/' (zero or more path segments — an *optional* directory prefix,
// so '**/*.yml' also matches a bare top-level 'a.yml', not just a nested one; this is
// standard glob/gitignore behavior, not an edge case to skip), a bare '**' (any chars
// including '/'), '*' (any chars except '/'), and literal segments — enough for the real
// patterns this repo needs today ('packages/contracts/**', '**/*.yml', '**/*.yaml').
// Deliberately not a full glob implementation (no brace expansion, negation, or character
// classes) — pull in a real glob library if a pattern ever needs one of those; hand-rolling
// that correctly is a real source of subtle bugs not worth taking on ahead of actual demand.
export function globToRegExp(pattern: string): RegExp {
  let re = '';
  let i = 0;
  while (i < pattern.length) {
    if (pattern[i] === '*' && pattern[i + 1] === '*' && pattern[i + 2] === '/') {
      re += '(?:.*/)?';
      i += 3;
    } else if (pattern[i] === '*' && pattern[i + 1] === '*') {
      re += '.*';
      i += 2;
    } else if (pattern[i] === '*') {
      re += '[^/]*';
      i += 1;
    } else if (pattern[i] === '?') {
      // Glob single-char wildcard -- must be handled explicitly, not left to fall through to
      // the literal-char branch below: '?' is also a regex quantifier (makes the preceding
      // token optional), so an unhandled '?' would silently compile to the wrong thing instead
      // of throwing (e.g. "a?.ts" would match "a.ts"/".ts", not "a" + any one char + ".ts").
      re += '[^/]';
      i += 1;
    } else if ('.+^${}()|[]\\'.includes(pattern[i])) {
      re += '\\' + pattern[i];
      i += 1;
    } else {
      re += pattern[i];
      i += 1;
    }
  }
  return new RegExp(`^${re}$`);
}

// Compiled patterns are cached by source string -- matchesAnyGlob is called once per file
// during a whole-repo scan (scanCode()), so recompiling every glob in a config list on every
// single call is pure waste once the file count gets large; the glob list itself is static
// for the lifetime of one CLI invocation.
const GLOB_REG_EXP_CACHE = new Map<string, RegExp>();
function cachedGlobToRegExp(pattern: string): RegExp {
  let re = GLOB_REG_EXP_CACHE.get(pattern);
  if (!re) {
    re = globToRegExp(pattern);
    GLOB_REG_EXP_CACHE.set(pattern, re);
  }
  return re;
}

export function matchesAnyGlob(relPath: string, globs: string[]): boolean {
  return globs.some((g) => cachedGlobToRegExp(g).test(relPath));
}

// Extracts every ADR number referenced by an Implements:/Verifies: back-pointer comment in
// this content — used to detect a comment landing somewhere the repo's convention says it
// shouldn't (see commentForbiddenPaths in adr-audit.ts's config). Kept independent of
// scanCode()'s normal evidence-collection loop: a comment inside a forbidden path must never
// count as real embodiment evidence even though it's still worth flagging as a convention
// violation — these are two different questions, not the same check reused.
export function findCommentAdrRefs(content: string): string[] {
  return [...new Set([...findImplementsRefs(content), ...findVerifiesRefs(content)])];
}

// Implements: ADR-0084
// Every ADR referenced *in any form* — a structured marker, a prose aside, a parenthetical.
// Deliberately NOT part of findCommentAdrRefs and never fed into embodiment evidence: a file
// saying "see ADR-0042" has cited a decision, not implemented one, and widening the evidence
// matcher to catch prose would mark decisions Implemented on the strength of a comment.
//
// This exists for one question only — "does this file reference a decision record at all" —
// which is what a published-path boundary needs to ask, because the readers of a mirrored
// package cannot resolve any of these forms. Callers are expected to have run
// stripIgnoredLines first, so a fixture that merely looks like a reference is already blanked.
export function findAnyAdrRefs(content: string): string[] {
  return [...new Set([...content.matchAll(/ADR-(\d{4})/g)].map((m) => m[1]))].sort();
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
  const cleanStated = statedEmbodimentClean(entry.statedEmbodiment);
  if (cleanStated.includes('Deprecated')) return 'Deprecated';
  if (cleanStated.includes('Inactive')) return 'Inactive';
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

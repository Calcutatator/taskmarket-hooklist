#!/usr/bin/env node
// ADR linter for docs/adr/ — enforces the MADR-lite structure and status
// lifecycle documented in docs/adr/README.md.
//
// Blocking (exit 1): filename format, valid Status, Date present, all four
// required sections, no duplicate numbers, Y-statement structural keywords,
// at least one rejected alternative in Considered options, supersession-link
// symmetry/direction, no dangling ADR-NNNN cross-references.
//
// Warn-only (does not fail the build): README index completeness, relevant
// source changes without a corresponding ADR change (pass changed paths as
// argv, e.g. from `git diff --name-only`), gaps in ADR numbering.

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ADR_DIR = dirname(fileURLToPath(import.meta.url));

const FILENAME_RE = /^\d{4}-[a-z0-9-]+\.md$/;
const VALID_STATUSES = new Set(['Proposed', 'Accepted', 'Superseded', 'Deprecated', 'Rejected', 'Withdrawn']);
const STATUS_RE = /\*\*Status:\*\*\s+(\S+)/;
const DATE_RE = /\*\*Date:\*\*\s+\d{4}-\d{2}-\d{2}/;
const Y_STATEMENT_RE = /\*\*Decision \(Y-statement\):\*\*/;
const Y_STATEMENT_KEYWORDS = ['In the context of', 'facing', 'we decided', 'to achieve', 'accepting'];
const SUPERSEDES_LINE_RE = /\*\*Supersedes \/ Superseded-by:\*\*(.+)/i;
const ADR_NUM_RE = /ADR-(\d{4})/g;
const REQUIRED_SECTIONS = [['Context'], ['Considered options', 'Options considered'], ['Decision'], ['Consequences']];

// Source paths that should usually come with an ADR — warn-only, not blocking.
const COVERAGE_PATHS = ['packages/contracts/src/', 'apps/backend/src/', 'docs/specs/'];

const issues = [];
const err = (file, message) => issues.push({ type: 'ERROR', file, message });
const warn = (file, message) => issues.push({ type: 'WARN', file, message });

function hasSection(content, aliases) {
  return aliases.some((name) => new RegExp(`^##\\s+${name}\\b`, 'im').test(content));
}

let adrFiles;
try {
  adrFiles = readdirSync(ADR_DIR)
    .filter((f) => f.endsWith('.md') && f !== 'README.md' && !f.startsWith('_'))
    .sort();
} catch {
  console.error(`docs/adr directory not found at ${ADR_DIR}`);
  process.exit(1);
}

const seenNumbers = new Set();
const contentsByFile = new Map();

for (const file of adrFiles) {
  const content = readFileSync(join(ADR_DIR, file), 'utf8');
  contentsByFile.set(file, content);
  const num = file.slice(0, 4);

  if (!FILENAME_RE.test(file)) {
    err(file, 'filename must match \\d{4}-[a-z0-9-]+.md');
  }

  if (seenNumbers.has(num)) {
    err(file, `duplicate ADR number ${num}`);
  }
  seenNumbers.add(num);

  const statusMatch = STATUS_RE.exec(content);
  if (!statusMatch) {
    err(file, 'missing **Status:** field');
  } else if (!VALID_STATUSES.has(statusMatch[1])) {
    err(file, `invalid status "${statusMatch[1]}" — must be one of: ${[...VALID_STATUSES].join(', ')}`);
  }

  if (!DATE_RE.test(content)) {
    err(file, 'missing or malformed **Date:** YYYY-MM-DD');
  }

  for (const aliases of REQUIRED_SECTIONS) {
    if (!hasSection(content, aliases)) {
      err(file, `missing required section: ## ${aliases[0]}`);
    }
  }

  if (!Y_STATEMENT_RE.test(content)) {
    err(file, 'missing **Decision (Y-statement):** TL;DR block');
  } else {
    const yMatch = content.match(/\*\*Decision \(Y-statement\):\*\*([\s\S]*?)(?=\n- \*\*|\n##)/);
    const yBlock = (yMatch ? yMatch[1] : content).replace(/\n>\s*/g, ' ');
    for (const kw of Y_STATEMENT_KEYWORDS) {
      if (!yBlock.includes(kw)) {
        err(
          file,
          `Y-statement missing expected phrase "${kw}" — ensure the TL;DR follows the "In the context of..., facing..., we decided..., to achieve..., accepting..." structure`,
        );
      }
    }
  }

  const CONSIDERED_OPTIONS_ALIASES = ['Considered options', 'Options considered'];
  let sectionMatch = null;
  for (const alias of CONSIDERED_OPTIONS_ALIASES) {
    sectionMatch = content.match(new RegExp(`## ${alias}[\\s\\S]*?(?=\\n## |\\n---|\\s*$)`, 'i'));
    if (sectionMatch) break;
  }
  if (sectionMatch) {
    const tableRows = sectionMatch[0]
      .split('\n')
      .filter((l) => l.trim().startsWith('|'))
      .filter((l) => !/^\|\s*-+\s*\|/.test(l.trim()))
      .filter((l, i) => !(i === 0 && /^\|\s*option\s*\|/i.test(l.trim())));
    if (tableRows.length < 2) {
      err(file, 'Considered options has fewer than 2 alternatives — document at least one rejected option');
    }
  }
}

// Supersession symmetry + direction. An ADR can carry more than one supersession
// relationship on the same line (semicolon-separated) — e.g. an ADR that fully
// supersedes an earlier one while itself being partially superseded by a later ADR
// that only overrides one section of it. Each segment is checked independently, so
// this stays backward-compatible with every existing single-relationship line
// ("Supersedes ADR-NNNN", "Superseded by ADR-NNNN", or "—").
function detectDirection(segment) {
  // "supersed(es|ed) ... by" (e.g. "superseded by", "superseded in part by") →
  // superseded-by; anything else referencing an ADR (including plain "supersedes") →
  // supersedes.
  return /supersed(?:ed|es)\b[\s\S]*?\bby\b/i.test(segment) ? 'superseded-by' : 'supersedes';
}

const supersessionMap = new Map();
for (const file of adrFiles) {
  const content = contentsByFile.get(file);
  const lineMatch = SUPERSEDES_LINE_RE.exec(content);
  if (!lineMatch) continue;

  const entries = [];
  for (const segment of lineMatch[1].split(';')) {
    const numMatch = ADR_NUM_RE.exec(segment);
    ADR_NUM_RE.lastIndex = 0;
    if (!numMatch) continue;
    entries.push({ refNum: numMatch[1], direction: detectDirection(segment) });
  }
  if (entries.length > 0) {
    supersessionMap.set(file.slice(0, 4), entries);
  }
}

for (const [num, entries] of supersessionMap) {
  const srcFile = adrFiles.find((f) => f.startsWith(num));
  for (const { refNum, direction } of entries) {
    const refFile = adrFiles.find((f) => f.startsWith(refNum));
    if (!refFile) continue; // dangling ref already caught below

    const peerEntries = supersessionMap.get(refNum) ?? [];
    const reciprocal = peerEntries.find((e) => e.refNum === num);
    if (!reciprocal) {
      err(srcFile, `supersession link to ADR-${refNum} is not symmetric — ADR-${refNum} must also reference ADR-${num}`);
    } else if (direction === reciprocal.direction) {
      err(srcFile, `supersession direction mismatch with ADR-${refNum} — one must say "Supersedes" and the other "Superseded by"`);
    }
  }
}

// Dangling cross-references
for (const file of adrFiles) {
  const content = contentsByFile.get(file);
  const refRe = /ADR-(\d{4})/g;
  let match;
  while ((match = refRe.exec(content)) !== null) {
    if (!seenNumbers.has(match[1])) {
      err(file, `dangling reference to ADR-${match[1]} (not found in docs/adr/)`);
    }
  }
}

// Warn-only: gaps in ADR numbering. Not blocking -- concurrent branches each
// drafting their own next ADR number legitimately merge out of order (e.g. ADR
// 0022 shipping before 0021, which is already drafted on a separate PR still
// open at the time), and blocking on that would force serializing ADR-touching
// PRs or manually renumbering right before merge, the same class of mistake
// that caused the migrations-journal task_drop_id incident this repo already
// learned from. This just surfaces a gap for a human to notice, not fail on.
const numericNumbers = [...seenNumbers].map(Number).sort((a, b) => a - b);
if (numericNumbers.length > 0) {
  const min = numericNumbers[0];
  const max = numericNumbers[numericNumbers.length - 1];
  const present = new Set(numericNumbers);
  for (let n = min; n <= max; n++) {
    if (!present.has(n)) {
      const gapNum = String(n).padStart(4, '0');
      warn(
        '(numbering)',
        `ADR ${gapNum} is missing between existing ADRs ${String(min).padStart(4, '0')} and ${String(max).padStart(4, '0')} -- fine if a PR reserving it just hasn't merged yet, otherwise confirm it wasn't silently skipped`,
      );
    }
  }
}

// Warn-only: README index completeness
const readmePath = join(ADR_DIR, 'README.md');
if (existsSync(readmePath)) {
  const readme = readFileSync(readmePath, 'utf8');
  for (const file of adrFiles) {
    const num = file.slice(0, 4);
    if (!readme.includes(num)) {
      warn(file, `ADR ${num} is not listed in docs/adr/README.md`);
    }
  }
}

// Warn-only: coverage — relevant source changed without an ADR change
const changedFiles = process.argv.slice(2);
if (changedFiles.length > 0) {
  const hasAdrChange = changedFiles.some((f) => f.startsWith('docs/adr/'));
  if (!hasAdrChange) {
    const triggered = changedFiles.filter((f) => COVERAGE_PATHS.some((p) => f.startsWith(p)));
    if (triggered.length > 0) {
      warn(triggered[0], 'source changed without any docs/adr/** change — consider whether a new ADR is needed');
    }
  }
}

for (const issue of issues) {
  const prefix = issue.type === 'ERROR' ? 'ERROR' : 'WARN ';
  console.log(`  ${prefix}  ${issue.file}: ${issue.message}`);
  // Surface as PR annotations when running in GitHub Actions; warnings stay non-blocking.
  if (process.env.GITHUB_ACTIONS) {
    const cmd = issue.type === 'ERROR' ? 'error' : 'warning';
    console.log(`::${cmd}::ADR lint: ${issue.file}: ${issue.message}`);
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

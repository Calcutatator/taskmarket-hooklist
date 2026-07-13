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
// argv, e.g. from `git diff --name-only`).

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

// Supersession symmetry + direction
const supersessionMap = new Map();
for (const file of adrFiles) {
  const content = contentsByFile.get(file);
  const lineMatch = SUPERSEDES_LINE_RE.exec(content);
  if (lineMatch) {
    const line = lineMatch[1].toLowerCase();
    const numMatch = ADR_NUM_RE.exec(lineMatch[1]);
    ADR_NUM_RE.lastIndex = 0;
    if (numMatch) {
      const direction = line.includes('superseded by') ? 'superseded-by' : 'supersedes';
      supersessionMap.set(file.slice(0, 4), { refNum: numMatch[1], direction });
    }
  }
}
for (const [num, { refNum, direction }] of supersessionMap) {
  const refFile = adrFiles.find((f) => f.startsWith(refNum));
  if (!refFile) continue;
  const srcFile = adrFiles.find((f) => f.startsWith(num));
  const peer = supersessionMap.get(refNum);
  if (!peer || peer.refNum !== num) {
    err(srcFile, `supersession link to ADR-${refNum} is not symmetric — ADR-${refNum} must also reference ADR-${num}`);
  } else if (direction === peer.direction) {
    err(srcFile, `supersession direction mismatch with ADR-${refNum} — one must say "Supersedes" and the other "Superseded by"`);
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

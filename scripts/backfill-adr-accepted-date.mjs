#!/usr/bin/env node
// Implements: ADR-0081
// One-shot backfill for the "**Accepted:**" ADR header field introduced by ADR-0081.
//
// Kept in the repo rather than run-and-discarded so the derivation is auditable: the field's
// historical values are inferred from git, and a reader who later distrusts a date needs to
// see exactly how it was produced. It is not wired into any job — it is expected to run once.
//
// Derivation, per ADR, in priority order:
//   1. OBSERVED  — the file existed with a non-accepted Status, and a later commit changed it
//                  to an acceptance-bearing one. That commit's author date IS the acceptance.
//   2. BORN      — the file's very first commit already carried an acceptance-bearing Status
//                  (this repo accepts most ADRs in the same commit that adds them). The first
//                  commit's date is then the acceptance date.
//   3. UNKNOWN   — neither applies. Nothing is written; the record is reported for a human.
//
// Deliberately absent: any fallback to the "**Date:**" header. Date means
// last-meaningfully-updated, so using it would silently manufacture an acceptance date out of
// an unrelated fact — precisely the failure this field exists to stop.
//
// Usage: node scripts/backfill-adr-accepted-date.mjs [--apply]
//        (dry-run by default; prints the plan and writes nothing)

import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ADR_DIR = join(REPO_ROOT, 'docs', 'adr');
const ACCEPTANCE_BEARING = new Set(['Accepted', 'Superseded', 'Deprecated']);
const APPLY = process.argv.includes('--apply');

const git = (...args) =>
  execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

// Every date this script produces is read out of history, so a truncated history does not fail
// — it silently answers with the oldest commit it happens to have. On a shallow clone (CI
// checkouts default to depth 1) that means every ADR would be dated the clone, and the output
// would look exactly as confident as a correct run. Refuse to start instead.
if (git('rev-parse', '--is-shallow-repository').trim() === 'true') {
  console.error(
    'refusing to run in a shallow clone: acceptance dates are derived from commit history, ' +
      'and a truncated history yields wrong dates rather than an error. Run `git fetch --unshallow` first.'
  );
  process.exit(1);
}

const statusOf = (text) => {
  const m = /^-\s+\*\*Status:\*\*\s+(\S+)/m.exec(text);
  return m ? m[1] : null;
};

// Commits touching this file, oldest first, as [sha, YYYY-MM-DD] pairs. --follow is
// deliberately omitted: a rename would make "the first commit" mean the pre-rename file,
// whose Status is not necessarily this record's.
const historyOf = (relPath) =>
  git('log', '--reverse', '--format=%H %ad', '--date=short', '--', relPath)
    .split('\n')
    .filter(Boolean)
    .map((line) => line.split(' '));

const contentAt = (sha, relPath) => {
  try {
    return git('show', `${sha}:${relPath}`);
  } catch {
    return null; // deleted/renamed at that revision
  }
};

const results = [];

for (const file of readdirSync(ADR_DIR).filter((f) => /^\d{4}-.*\.md$/.test(f)).sort()) {
  const relPath = `docs/adr/${file}`;
  const current = readFileSync(join(ADR_DIR, file), 'utf8');
  const status = statusOf(current);

  if (!status || !ACCEPTANCE_BEARING.has(status)) {
    results.push({ file, status, method: 'SKIP', date: null });
    continue;
  }

  const history = historyOf(relPath);
  if (history.length === 0) {
    results.push({ file, status, method: 'UNKNOWN', date: null, note: 'untracked' });
    continue;
  }

  let method = null;
  let date = null;
  let previousWasAccepted = null;

  for (const [sha, commitDate] of history) {
    const text = contentAt(sha, relPath);
    if (text === null) continue;
    const isAccepted = ACCEPTANCE_BEARING.has(statusOf(text));

    if (previousWasAccepted === null) {
      // First commit that actually carries this file.
      if (isAccepted) {
        method = 'BORN';
        date = commitDate;
        break;
      }
      previousWasAccepted = false;
      continue;
    }
    if (isAccepted) {
      method = 'OBSERVED';
      date = commitDate;
      break;
    }
  }

  results.push({ file, status, method: method ?? 'UNKNOWN', date });
}

const insert = (content, date) => {
  // Immediately after "- **Date:** ..." so the two temporal fields read together.
  const dateLine = /^-\s+\*\*Date:\*\*.*$/m;
  if (!dateLine.test(content)) throw new Error('no **Date:** line to anchor against');
  return content.replace(dateLine, (line) => `${line}\n- **Accepted:** ${date}`);
};

let written = 0;
for (const r of results) {
  if (r.method === 'OBSERVED' || r.method === 'BORN') {
    if (APPLY) {
      const path = join(ADR_DIR, r.file);
      const content = readFileSync(path, 'utf8');
      if (!/^-\s+\*\*Accepted:\*\*/m.test(content)) {
        writeFileSync(path, insert(content, r.date));
        written += 1;
      }
    }
  }
}

const tally = results.reduce((acc, r) => ({ ...acc, [r.method]: (acc[r.method] ?? 0) + 1 }), {});
for (const r of results.filter((x) => x.method === 'UNKNOWN')) {
  console.error(`  UNKNOWN  ${r.file} (status ${r.status}) — needs a human-supplied date`);
}
console.error(`\n${APPLY ? 'applied' : 'dry run'}: ${JSON.stringify(tally)}${APPLY ? `, files written: ${written}` : ''}`);
console.log(JSON.stringify({ status: 'ok', apply: APPLY, tally, written, results }, null, 2));

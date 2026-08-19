// Unit + corpus tests for packages/adr/lib.ts (the ADR linter's pure core).
//
// Convention: every new check needs both a case where it fires and an
// adjacent case where it correctly does NOT fire (a negative-space test) —
// a check only ever exercised on the positive case can't catch itself
// becoming over-eager later.

import { describe, test, expect } from 'vitest';
import fc from 'fast-check';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync, realpathSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  type AdrAuditEntry,
  isPlaceholder,
  stripLeadingWrapper,
  primaryName,
  normalizeName,
  detectDirection,
  detectAmendDirection,
  extractSupersessionEntries,
  extractAmendmentEntries,
  stripCaveatClauses,
  extractAdrNumbers,
  isBindingStatus,
  checkSupersessionReciprocity,
  fieldValue,
  SUPERSEDES_RE,
  lintAdrDir,
  formatIssueLine,
  formatGithubAnnotation,
  normalizeIssueFilePath,
  buildAuditSummary,
  computeDrift,
  computeEmbodiment,
  type RealizedByLocator,
  parseRealizedByLocators,
  formatRealizedByLocators,
  checkRealizedByLocator,
  resolveRealizedByRefs,
  globToRegExp,
  matchesAnyGlob,
  findCommentAdrRefs,
  findAnyAdrRefs,
  stripIgnoredLines,
  ADR_SCAN_IGNORE_MARKER,
  statedEmbodimentClean,
  type SpecFile,
  checkSpec,
  lintSpecs,
  SPEC_REQUIRED_SECTIONS,
  SPEC_VALID_STATUSES,
  checkFilenameFormat,
  findDuplicateNumbers,
  checkStatusField,
  checkDateField,
  checkAcceptedField,
  AUTHOR_RE,
  checkStatusEmbodimentConsistency,
  checkHeaderStructure,
  parseHeader,
  headerText,
  KNOWN_HEADER_KEYS,
  ACCEPTANCE_BEARING_STATUSES,
  checkRequiredSections,
  statesADecision,
  checkYStatement,
  checkConsideredOptionsMinimum,
  checkAuthorReviewersDeciders,
  checkDanglingReferences,
  checkNumberingGaps,
  checkDocIndexFreshness,
  parseDocIndexEntry,
  renderDocIndexYaml,
  renderDocIndexList,
  buildIndexMarkerRe,
  ADR_INDEX_YAML_OPTIONS,
  ADR_INDEX_FRESHNESS_OPTIONS,
  RFC_INDEX_MARKER_RE,
  RFC_INDEX_FRESHNESS_OPTIONS,
  RFC_INDEX_YAML_OPTIONS,
  lintRfcDir,
  checkCoverage,
  checkProposedAdrImplementation,
  findImplementsRefs,
  findVerifiesRefs,
  coerceScope,
  coerceAllowAuthorSelfReview,
  checkScopeMismatch,
  extractReferencesSection,
  extractCitedFilePaths,
  extractCitedGithubNumbers,
  checkFilePathCitations,
  pathIsInsideRoot,
  pathIsInsideRootReal,
  resolveTrackedSourceFiles,
  resolveGitDiffChangedFiles,
  checkGithubNumberCitations,
  resolveGitTrackedOrStagedFiles,
  isDocDirMemberFile,
  FILENAME_RE,
  VALID_STATUSES,
  REQUIRED_SECTIONS,
  Y_STATEMENT_KEYWORDS,
  COVERAGE_PATHS,
  GOVERNANCE_PATHS,
} from './lib.js';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const PACKAGE_DIR = dirname(fileURLToPath(import.meta.url));
const ADR_DIR = join(PACKAGE_DIR, '..', '..', 'docs', 'adr');

// ---------------------------------------------------------------------------
// Placeholder detection
// ---------------------------------------------------------------------------

describe('isPlaceholder', () => {
  test('entirely a placeholder, no leading wrapper', () => {
    expect(isPlaceholder('pending human approval')).toBe(true);
    expect(isPlaceholder('TBD')).toBe(true);
    expect(isPlaceholder('')).toBe(true);
    expect(isPlaceholder(null)).toBe(true);
    expect(isPlaceholder(undefined)).toBe(true);
  });

  test('entirely a placeholder, with leading wrapper punctuation', () => {
    expect(isPlaceholder('(pending human approval)')).toBe(true);
    expect(isPlaceholder('— (awaiting external ack)')).toBe(true);
    expect(isPlaceholder('- TBD')).toBe(true);
    expect(isPlaceholder('  — none yet')).toBe(true);
  });

  test('a real name is never a placeholder', () => {
    expect(isPlaceholder('Beau')).toBe(false);
    expect(isPlaceholder('Beau Williams')).toBe(false);
    expect(isPlaceholder('beauwilliams')).toBe(false);
  });

  test('real content followed by a separately-pending clause is NOT blank', () => {
    const value = 'Original: Alice (approved 2026-01-01); later amendment: awaiting ack';
    expect(isPlaceholder(value)).toBe(false);
  });
});

test('stripLeadingWrapper strips only leading dashes/parens/brackets/whitespace', () => {
  expect(stripLeadingWrapper('— (awaiting ack)')).toBe('awaiting ack)');
  expect(stripLeadingWrapper('Beau')).toBe('Beau');
  expect(stripLeadingWrapper('  (pending)')).toBe('pending)');
});

// ---------------------------------------------------------------------------
// Self-ack name comparison
// ---------------------------------------------------------------------------

test('primaryName / normalizeName take the name before a self-attestation annotation', () => {
  expect(primaryName('Beau — self-attested; no independent reviewer recorded')).toBe('Beau');
  expect(normalizeName('Beau — self-attested; no independent reviewer recorded')).toBe('beau');
  expect(normalizeName('Beau')).toBe('beau');
  expect(normalizeName('Beau Williams')).toBe('beauwilliams');
});

// ---------------------------------------------------------------------------
// Supersedes / Superseded-by multi-line fix
// ---------------------------------------------------------------------------

describe('extractSupersessionEntries — dotAll multi-line fix', () => {
  test('a real single-line value still works unchanged', () => {
    const content = [
      '- **Status:** Superseded',
      '- **Date:** 2026-07-20',
      '- **Supersedes / Superseded-by:** Superseded by ADR-0023',
      '',
      '## Context',
    ].join('\n');

    const fieldText = fieldValue(content, SUPERSEDES_RE)!;
    const entries = extractSupersessionEntries(fieldText);
    expect(entries).toHaveLength(1);
    expect(entries[0].refNum).toBe('0023');
    expect(entries[0].direction).toBe('superseded-by');
  });

  test('a wrapped multi-line value is captured in full (regression)', () => {
    const content = [
      '- **Status:** Accepted',
      '- **Date:** 2026-07-16',
      '- **Supersedes / Superseded-by:** Supersedes ADR-0002; superseded in part by ADR-0020,',
      '  which only overrides the wallet-normalization section below and leaves the rest of',
      '  this decision intact',
      '',
      '## Context',
    ].join('\n');

    const value = fieldValue(content, SUPERSEDES_RE);
    expect(value).toMatch(/ADR-0020/);
    expect(value).toMatch(/overrides the wallet-normalization section/);

    const entries = extractSupersessionEntries(value!);
    expect(entries).toHaveLength(2);
    expect(entries.map((e) => e.refNum).sort()).toEqual(['0002', '0020']);
    const bySrc = Object.fromEntries(entries.map((e) => [e.refNum, e.direction]));
    expect(bySrc['0002']).toBe('supersedes');
    expect(bySrc['0020']).toBe('superseded-by');
  });
});

describe('stripCaveatClauses / extractSupersessionEntries — caveat-clause regression', () => {
  test('a caveat clause naming an ADR only as context is not treated as a claimed target', () => {
    const segment = 'Superseded by ADR-0006, for the scope not already superseded by ADR-0020';
    const cleaned = stripCaveatClauses(segment);
    expect(cleaned).not.toMatch(/ADR-0020/);
    expect(cleaned).toMatch(/ADR-0006/);

    const entries = extractSupersessionEntries(segment);
    expect(entries.map((e) => e.refNum).sort()).toEqual(['0006']);
    expect(entries[0].direction).toBe('superseded-by');
  });

  test('caveat stripping does not corrupt direction detection when the caveat appears before the real claim', () => {
    const segment = 'not already superseded by ADR-0020, but Supersedes ADR-0009';
    const entries = extractSupersessionEntries(segment);
    expect(entries.map((e) => e.refNum)).toEqual(['0009']);
    expect(entries[0].direction).toBe('supersedes');
  });
});

describe('extractSupersessionEntries — genuine multi-target-in-one-segment', () => {
  test('a single segment listing multiple targets in prose (no semicolons) captures all of them', () => {
    const segment = 'Supersedes ADR-0002, ADR-0004, ADR-0006';
    const entries = extractSupersessionEntries(segment);
    expect(entries.map((e) => e.refNum).sort()).toEqual(['0002', '0004', '0006']);
    for (const e of entries) {
      expect(e.direction).toBe('supersedes');
    }
  });

  test('duplicate mentions of the same ADR within a segment are deduplicated', () => {
    const segment = 'Supersedes ADR-0002 and, for clarity, ADR-0002 again';
    const entries = extractSupersessionEntries(segment);
    expect(entries.map((e) => e.refNum)).toEqual(['0002']);
  });
});

describe('extractSupersessionEntries — existing semicolon-multi-relationship case', () => {
  test('semicolon-separated segments are each extracted independently (synthetic)', () => {
    const fieldText = ' Supersedes ADR-0004; Superseded by ADR-0009';
    const entries = extractSupersessionEntries(fieldText);
    expect(entries).toEqual([
      { refNum: '0004', direction: 'supersedes' },
      { refNum: '0009', direction: 'superseded-by' },
    ]);
  });

  test('matches the real multi-relationship ADR in this repo (ADR-0023)', () => {
    const content = readFileSync(
      join(
        ADR_DIR,
        '0023-converge-inbox-and-mybids-self-auth-onto-the-general-read-auth-header.md'
      ),
      'utf8'
    );
    const fieldText = fieldValue(content, SUPERSEDES_RE);
    expect(fieldText).toBeTruthy();
    const entries = extractSupersessionEntries(fieldText!);
    expect(
      entries
        .map((e) => ({ refNum: e.refNum, direction: e.direction }))
        .sort((a, b) => a.refNum.localeCompare(b.refNum))
    ).toEqual([
      { refNum: '0015', direction: 'supersedes' },
      { refNum: '0017', direction: 'supersedes' },
    ]);
  });
});

describe('extractAdrNumbers', () => {
  test('returns distinct numbers in first-seen order', () => {
    expect(extractAdrNumbers('ADR-0002 and ADR-0004 and ADR-0002 again')).toEqual(['0002', '0004']);
  });
});

describe('isBindingStatus — status-aware pending-vs-binding', () => {
  test('Accepted, Superseded, Deprecated, Rejected, Withdrawn are all binding', () => {
    for (const status of ['Accepted', 'Superseded', 'Deprecated', 'Rejected', 'Withdrawn']) {
      expect(isBindingStatus(status)).toBe(true);
    }
  });
  test('Proposed is not yet binding', () => {
    expect(isBindingStatus('Proposed')).toBe(false);
  });
});

describe('checkSupersessionReciprocity', () => {
  test('a matched Accepted <-> Superseded pair produces no issues', () => {
    const supersessionMap = new Map([
      ['0006', [{ refNum: '0004', direction: 'supersedes' as const }]],
      ['0004', [{ refNum: '0006', direction: 'superseded-by' as const }]],
    ]);
    const statusByFile = new Map<string, string | null>([
      ['0006', 'Accepted'],
      ['0004', 'Superseded'],
    ]);
    const findFile = (num: string) => `${num}-fake.md`;
    const results = checkSupersessionReciprocity({
      supersessionMap,
      pendingSupersessionMap: new Map(),
      statusByFile,
      findFile,
    });
    expect(results).toEqual([]);
  });

  test('an Accepted ADR claiming a supersession the peer does not reciprocate is a blocking ERROR', () => {
    const supersessionMap = new Map([
      ['0006', [{ refNum: '0004', direction: 'supersedes' as const }]],
    ]);
    const statusByFile = new Map<string, string | null>([
      ['0006', 'Accepted'],
      ['0004', 'Superseded'],
    ]);
    const findFile = (num: string) => `${num}-fake.md`;
    const results = checkSupersessionReciprocity({
      supersessionMap,
      pendingSupersessionMap: new Map(),
      statusByFile,
      findFile,
    });
    expect(results).toHaveLength(1);
    expect(results[0].type).toBe('ERROR');
    expect(results[0].message).toMatch(/not symmetric/);
  });

  test('a direction mismatch (both claim the same direction) is a blocking ERROR', () => {
    const supersessionMap = new Map([
      ['0006', [{ refNum: '0004', direction: 'supersedes' as const }]],
      ['0004', [{ refNum: '0006', direction: 'supersedes' as const }]],
    ]);
    const statusByFile = new Map<string, string | null>([
      ['0006', 'Accepted'],
      ['0004', 'Accepted'],
    ]);
    const findFile = (num: string) => `${num}-fake.md`;
    const results = checkSupersessionReciprocity({
      supersessionMap,
      pendingSupersessionMap: new Map(),
      statusByFile,
      findFile,
    });
    expect(results).toHaveLength(2);
    expect(results.every((r) => r.type === 'ERROR' && /direction mismatch/.test(r.message))).toBe(
      true
    );
  });

  test('a Proposed ADR claiming supersession without a peer binding reference only warns, and checks the pending field', () => {
    const supersessionMap = new Map([
      ['0032', [{ refNum: '0006', direction: 'superseded-by' as const }]],
    ]);
    const statusByFile = new Map<string, string | null>([
      ['0032', 'Proposed'],
      ['0006', 'Accepted'],
    ]);
    const findFile = (num: string) => `${num}-fake.md`;

    let results = checkSupersessionReciprocity({
      supersessionMap,
      pendingSupersessionMap: new Map(),
      statusByFile,
      findFile,
    });
    expect(results).toHaveLength(1);
    expect(results[0].type).toBe('WARN');
    expect(results[0].message).toMatch(/not yet Accepted/);

    const pendingSupersessionMap = new Map([
      ['0006', [{ refNum: '0032', direction: 'supersedes' as const }]],
    ]);
    results = checkSupersessionReciprocity({
      supersessionMap,
      pendingSupersessionMap,
      statusByFile,
      findFile,
    });
    expect(results).toEqual([]);
  });

  test('an Accepted ADR is unaffected by an unrelated Proposed ADR opened against the same topic', () => {
    const supersessionMap = new Map([
      ['0006', [{ refNum: '0004', direction: 'supersedes' as const }]],
      ['0004', [{ refNum: '0006', direction: 'superseded-by' as const }]],
    ]);
    const statusByFile = new Map<string, string | null>([
      ['0006', 'Accepted'],
      ['0004', 'Superseded'],
    ]);
    const findFile = (num: string) => (num === '0032' ? undefined : `${num}-fake.md`);
    const results = checkSupersessionReciprocity({
      supersessionMap,
      pendingSupersessionMap: new Map(),
      statusByFile,
      findFile,
    });
    expect(results).toEqual([]);
  });
});

test('detectDirection: "superseded by" (with or without a wrapped newline before "by") is superseded-by', () => {
  expect(detectDirection('Supersedes ADR-0002')).toBe('supersedes');
  expect(detectDirection('Superseded by ADR-0006')).toBe('superseded-by');
  expect(detectDirection('superseded in part\nby ADR-0020')).toBe('superseded-by');
});

test('detectAmendDirection: "amended by" (with or without a wrapped newline before "by") is amended-by', () => {
  expect(detectAmendDirection('Amends ADR-0002')).toBe('amends');
  expect(detectAmendDirection('Amended by ADR-0006')).toBe('amended-by');
  expect(detectAmendDirection('amended in part\nby ADR-0020')).toBe('amended-by');
});

test('extractAmendmentEntries: mirrors extractSupersessionEntries for the Amends/Amended-by relation', () => {
  expect(extractAmendmentEntries('Amends ADR-0002')).toEqual([{ refNum: '0002', direction: 'amends' }]);
  expect(extractAmendmentEntries('Amended by ADR-0006; Amends ADR-0002')).toEqual([
    { refNum: '0006', direction: 'amended-by' },
    { refNum: '0002', direction: 'amends' },
  ]);
});

describe('checkSupersessionReciprocity — amendment relation (parameterized)', () => {
  test('a matched Amends <-> Amended-by pair produces no issues, with amendment wording', () => {
    const amendmentMap = new Map([
      ['0006', [{ refNum: '0004', direction: 'amends' as const }]],
      ['0004', [{ refNum: '0006', direction: 'amended-by' as const }]],
    ]);
    const statusByFile = new Map<string, string | null>([
      ['0006', 'Accepted'],
      ['0004', 'Accepted'],
    ]);
    const findFile = (num: string) => `${num}-fake.md`;
    const results = checkSupersessionReciprocity({
      supersessionMap: amendmentMap,
      pendingSupersessionMap: new Map(),
      statusByFile,
      findFile,
      relationLabel: 'amendment',
      directionWords: ['Amends', 'Amended by'],
      pendingFieldName: 'Pending Amends / Amended-by',
    });
    expect(results).toEqual([]);
  });

  test('a missing reciprocal amendment reference is a blocking ERROR with amendment wording, not supersession', () => {
    const amendmentMap = new Map([['0006', [{ refNum: '0004', direction: 'amends' as const }]]]);
    const statusByFile = new Map<string, string | null>([
      ['0006', 'Accepted'],
      ['0004', 'Accepted'],
    ]);
    const findFile = (num: string) => `${num}-fake.md`;
    const results = checkSupersessionReciprocity({
      supersessionMap: amendmentMap,
      pendingSupersessionMap: new Map(),
      statusByFile,
      findFile,
      relationLabel: 'amendment',
      directionWords: ['Amends', 'Amended by'],
      pendingFieldName: 'Pending Amends / Amended-by',
    });
    expect(results).toHaveLength(1);
    expect(results[0].type).toBe('ERROR');
    expect(results[0].message).toMatch(/^amendment link to ADR-0004 is not symmetric/);
  });

  test('negative space: a Supersedes-only claim never satisfies an Amends claim, and vice versa', () => {
    // The whole point of tracking these as two independent relations: an ADR that amends
    // a peer must not be considered reciprocated just because that peer happens to
    // supersede it (or anything else in the Supersedes map).
    const amendmentMap = new Map([['0006', [{ refNum: '0004', direction: 'amends' as const }]]]);
    const supersessionMap = new Map([['0004', [{ refNum: '0006', direction: 'supersedes' as const }]]]);
    const statusByFile = new Map<string, string | null>([
      ['0006', 'Accepted'],
      ['0004', 'Accepted'],
    ]);
    const findFile = (num: string) => `${num}-fake.md`;

    const amendResults = checkSupersessionReciprocity({
      supersessionMap: amendmentMap,
      pendingSupersessionMap: new Map(),
      statusByFile,
      findFile,
      relationLabel: 'amendment',
      directionWords: ['Amends', 'Amended by'],
      pendingFieldName: 'Pending Amends / Amended-by',
    });
    expect(amendResults.some((r) => r.type === 'ERROR' && r.file === '0006-fake.md')).toBe(true);

    const supersessionResults = checkSupersessionReciprocity({
      supersessionMap,
      pendingSupersessionMap: new Map(),
      statusByFile,
      findFile,
    });
    expect(supersessionResults.some((r) => r.type === 'ERROR' && r.file === '0004-fake.md')).toBe(true);
  });
});

describe('checkSupersessionReciprocity (property, parameterized across both relations)', () => {
  const RELATIONS = [
    { name: 'supersession', config: {}, forward: 'supersedes' as const, backward: 'superseded-by' as const },
    {
      name: 'amendment',
      config: {
        relationLabel: 'amendment',
        directionWords: ['Amends', 'Amended by'] as [string, string],
        pendingFieldName: 'Pending Amends / Amended-by',
      },
      forward: 'amends' as const,
      backward: 'amended-by' as const,
    },
  ];

  const BINDING_STATUSES = ['Accepted', 'Superseded', 'Deprecated', 'Rejected', 'Withdrawn'];
  const twoDistinctNums = fc
    .uniqueArray(fc.integer({ min: 0, max: 9999 }).map((n) => String(n).padStart(4, '0')), {
      minLength: 2,
      maxLength: 2,
    })
    .map(([a, b]) => [a, b] as const);
  const findFileFor = (nums: readonly string[]) => (num: string) => nums.includes(num) ? `${num}-fake.md` : undefined;

  for (const { name, config, forward, backward } of RELATIONS) {
    describe(name, () => {
      test('property: a perfectly reciprocal pair (any binding status combination) always produces zero issues', () => {
        fc.assert(
          fc.property(
            twoDistinctNums,
            fc.constantFrom(...BINDING_STATUSES),
            fc.constantFrom(...BINDING_STATUSES),
            fc.boolean(),
            (nums, statusA, statusB, aIsForward) => {
              const [a, b] = nums;
              const map = new Map([
                [a, [{ refNum: b, direction: aIsForward ? forward : backward }]],
                [b, [{ refNum: a, direction: aIsForward ? backward : forward }]],
              ]);
              const statusByFile = new Map<string, string | null>([
                [a, statusA],
                [b, statusB],
              ]);
              const results = checkSupersessionReciprocity({
                supersessionMap: map,
                pendingSupersessionMap: new Map(),
                statusByFile,
                findFile: findFileFor(nums),
                ...config,
              });
              expect(results).toEqual([]);
            }
          )
        );
      });

      test('property: a one-sided binding claim always produces exactly one "not symmetric" ERROR on the claimant', () => {
        fc.assert(
          fc.property(
            twoDistinctNums,
            fc.constantFrom(...BINDING_STATUSES),
            fc.constantFrom(...BINDING_STATUSES),
            fc.constantFrom(forward, backward),
            (nums, statusA, statusB, direction) => {
              const [a, b] = nums;
              const map = new Map([[a, [{ refNum: b, direction }]]]);
              const statusByFile = new Map<string, string | null>([
                [a, statusA],
                [b, statusB],
              ]);
              const results = checkSupersessionReciprocity({
                supersessionMap: map,
                pendingSupersessionMap: new Map(),
                statusByFile,
                findFile: findFileFor(nums),
                ...config,
              });
              expect(results).toHaveLength(1);
              expect(results[0].type).toBe('ERROR');
              expect(results[0].file).toBe(`${a}-fake.md`);
              expect(results[0].message).toMatch(/not symmetric/);
            }
          )
        );
      });

      test('property: both sides claiming the same direction (binding) always produces two direction-mismatch ERRORs', () => {
        fc.assert(
          fc.property(
            twoDistinctNums,
            fc.constantFrom(...BINDING_STATUSES),
            fc.constantFrom(...BINDING_STATUSES),
            fc.constantFrom(forward, backward),
            (nums, statusA, statusB, direction) => {
              const [a, b] = nums;
              const map = new Map([
                [a, [{ refNum: b, direction }]],
                [b, [{ refNum: a, direction }]],
              ]);
              const statusByFile = new Map<string, string | null>([
                [a, statusA],
                [b, statusB],
              ]);
              const results = checkSupersessionReciprocity({
                supersessionMap: map,
                pendingSupersessionMap: new Map(),
                statusByFile,
                findFile: findFileFor(nums),
                ...config,
              });
              expect(results).toHaveLength(2);
              expect(results.every((r) => r.type === 'ERROR' && /direction mismatch/.test(r.message))).toBe(true);
            }
          )
        );
      });

      test('property: a Proposed claimant with no peer reciprocation is a WARN, not an ERROR', () => {
        fc.assert(
          fc.property(
            twoDistinctNums,
            fc.constantFrom(...BINDING_STATUSES),
            fc.constantFrom(forward, backward),
            (nums, peerStatus, direction) => {
              const [a, b] = nums;
              const map = new Map([[a, [{ refNum: b, direction }]]]);
              const statusByFile = new Map<string, string | null>([
                [a, 'Proposed'],
                [b, peerStatus],
              ]);
              const results = checkSupersessionReciprocity({
                supersessionMap: map,
                pendingSupersessionMap: new Map(),
                statusByFile,
                findFile: findFileFor(nums),
                ...config,
              });
              expect(results).toHaveLength(1);
              expect(results[0].type).toBe('WARN');
              expect(results[0].file).toBe(`${a}-fake.md`);
            }
          )
        );
      });

      test('property: a Proposed claimant whose peer reciprocates via the pending field produces zero issues', () => {
        fc.assert(
          fc.property(
            twoDistinctNums,
            fc.constantFrom(...BINDING_STATUSES),
            fc.boolean(),
            (nums, peerStatus, aIsForward) => {
              const [a, b] = nums;
              const map = new Map([[a, [{ refNum: b, direction: aIsForward ? forward : backward }]]]);
              const pendingMap = new Map([[b, [{ refNum: a, direction: aIsForward ? backward : forward }]]]);
              const statusByFile = new Map<string, string | null>([
                [a, 'Proposed'],
                [b, peerStatus],
              ]);
              const results = checkSupersessionReciprocity({
                supersessionMap: map,
                pendingSupersessionMap: pendingMap,
                statusByFile,
                findFile: findFileFor(nums),
                ...config,
              });
              expect(results).toEqual([]);
            }
          )
        );
      });

      test('property: a claim referencing an ADR outside the known file set never produces an issue (dangling refs handled elsewhere)', () => {
        fc.assert(
          fc.property(twoDistinctNums, fc.constantFrom(...BINDING_STATUSES), fc.constantFrom(forward, backward), (nums, status, direction) => {
            const [a, b] = nums;
            const map = new Map([[a, [{ refNum: b, direction }]]]);
            const statusByFile = new Map<string, string | null>([[a, status]]);
            // findFile only knows about `a` — `b` is "dangling" from this function's perspective.
            const results = checkSupersessionReciprocity({
              supersessionMap: map,
              pendingSupersessionMap: new Map(),
              statusByFile,
              findFile: (num) => (num === a ? `${a}-fake.md` : undefined),
              ...config,
            });
            expect(results).toEqual([]);
          })
        );
      });
    });
  }
});

// ---------------------------------------------------------------------------
// Corpus-level integration: real docs/adr/ passes with 0 errors
// ---------------------------------------------------------------------------

test('lintAdrDir: the real docs/adr/ corpus has zero blocking errors', () => {
  const { issues, adrFiles } = lintAdrDir(ADR_DIR);
  expect(adrFiles.length).toBeGreaterThan(0);
  const errors = issues.filter((i) => i.type === 'ERROR');
  expect(errors).toEqual([]);
});

// ---------------------------------------------------------------------------
// Integrity checks (filename, duplicate numbers, Status, Date, required
// sections, dangling references) — these were previously exercised only
// indirectly via the real-corpus gate; adding direct fixture-based
// positive/negative coverage for each, matching the convention already
// established for the newer checks below (Author/Reviewers/Deciders,
// Y-statement, Considered options).
// ---------------------------------------------------------------------------

test('lintAdrDir: a filename that does not match \\d{4}-[a-z0-9-]+.md is a blocking error', () => {
  const content = makeAdr({ num: '0908', status: 'Accepted', author: 'Alice', reviewers: 'Bob', deciders: 'Carol' });
  withFixtureDir({ 'ADR-0908-bad-filename.md': content }, (dir) => {
    const { issues } = lintAdrDir(dir);
    const errors = issues.filter((i) => i.type === 'ERROR');
    expect(errors.some((e) => /filename must match/.test(e.message))).toBe(true);
  });
});

test('lintAdrDir: a well-formed filename is not flagged (negative space)', () => {
  const content = makeAdr({ num: '0908', status: 'Accepted', author: 'Alice', reviewers: 'Bob', deciders: 'Carol' });
  withFixtureDir({ '0908-fixture.md': content }, (dir) => {
    const { issues } = lintAdrDir(dir);
    const errors = issues.filter((i) => i.type === 'ERROR');
    expect(errors.some((e) => /filename must match/.test(e.message))).toBe(false);
  });
});

test('lintAdrDir: two files sharing the same leading 4-digit number is a blocking error', () => {
  const a = makeAdr({ num: '0909', status: 'Accepted', author: 'Alice', reviewers: 'Bob', deciders: 'Carol' });
  const b = makeAdr({ num: '0909', status: 'Accepted', author: 'Alice', reviewers: 'Bob', deciders: 'Carol' });
  withFixtureDir({ '0909-alpha.md': a, '0909-beta.md': b }, (dir) => {
    const { issues } = lintAdrDir(dir);
    const errors = issues.filter((i) => i.type === 'ERROR');
    expect(errors.some((e) => /duplicate ADR number 0909/.test(e.message))).toBe(true);
  });
});

test('lintAdrDir: a missing **Status:** field is a blocking error', () => {
  const content = makeAdr({ num: '0910', status: 'Accepted', author: 'Alice', reviewers: 'Bob', deciders: 'Carol' }).replace(
    '- **Status:** Accepted\n',
    ''
  );
  withFixtureDir({ '0910-fixture.md': content }, (dir) => {
    const { issues } = lintAdrDir(dir);
    const errors = issues.filter((i) => i.type === 'ERROR');
    expect(errors.some((e) => /missing \*\*Status:\*\* field/.test(e.message))).toBe(true);
  });
});

test('lintAdrDir: an invalid **Status:** value is a blocking error', () => {
  const content = makeAdr({ num: '0911', status: 'Revised', author: 'Alice', reviewers: 'Bob', deciders: 'Carol' });
  withFixtureDir({ '0911-fixture.md': content }, (dir) => {
    const { issues } = lintAdrDir(dir);
    const errors = issues.filter((i) => i.type === 'ERROR');
    expect(errors.some((e) => /invalid status "Revised"/.test(e.message))).toBe(true);
  });
});

test('lintAdrDir: a valid **Status:** value is not flagged (negative space)', () => {
  const content = makeAdr({ num: '0911', status: 'Accepted', author: 'Alice', reviewers: 'Bob', deciders: 'Carol' });
  withFixtureDir({ '0911-fixture.md': content }, (dir) => {
    const { issues } = lintAdrDir(dir);
    const errors = issues.filter((i) => i.type === 'ERROR');
    expect(errors.some((e) => /invalid status/.test(e.message))).toBe(false);
  });
});

test('lintAdrDir: a missing or malformed **Date:** field is a blocking error', () => {
  const content = makeAdr({ num: '0912', status: 'Accepted', author: 'Alice', reviewers: 'Bob', deciders: 'Carol' }).replace(
    '- **Date:** 2026-07-28\n',
    '- **Date:** 07/28/2026\n'
  );
  withFixtureDir({ '0912-fixture.md': content }, (dir) => {
    const { issues } = lintAdrDir(dir);
    const errors = issues.filter((i) => i.type === 'ERROR');
    expect(errors.some((e) => /missing or malformed \*\*Date:\*\*/.test(e.message))).toBe(true);
  });
});

test('lintAdrDir: a missing required section (## Context) is a blocking error', () => {
  const content = makeAdr({ num: '0913', status: 'Accepted', author: 'Alice', reviewers: 'Bob', deciders: 'Carol' }).replace(
    '## Context',
    '## Background'
  );
  withFixtureDir({ '0913-fixture.md': content }, (dir) => {
    const { issues } = lintAdrDir(dir);
    const errors = issues.filter((i) => i.type === 'ERROR');
    expect(errors.some((e) => /missing required section: ## Context/.test(e.message))).toBe(true);
  });
});

test('lintAdrDir: a dangling ADR-NNNN cross-reference is a blocking error', () => {
  const content =
    makeAdr({ num: '0914', status: 'Accepted', author: 'Alice', reviewers: 'Bob', deciders: 'Carol' }) +
    '\nSee also ADR-9999 for related context.\n';
  withFixtureDir({ '0914-fixture.md': content }, (dir) => {
    const { issues } = lintAdrDir(dir);
    const errors = issues.filter((i) => i.type === 'ERROR');
    expect(errors.some((e) => /dangling reference to ADR-9999/.test(e.message))).toBe(true);
  });
});

test('lintAdrDir: a reference to an ADR that exists in the same directory is not flagged (negative space)', () => {
  const a = makeAdr({ num: '0915', status: 'Accepted', author: 'Alice', reviewers: 'Bob', deciders: 'Carol' });
  const b =
    makeAdr({ num: '0916', status: 'Accepted', author: 'Alice', reviewers: 'Bob', deciders: 'Carol' }) +
    '\nSee also ADR-0915 for related context.\n';
  withFixtureDir({ '0915-fixture.md': a, '0916-fixture.md': b }, (dir) => {
    const { issues } = lintAdrDir(dir);
    const errors = issues.filter((i) => i.type === 'ERROR');
    expect(errors.some((e) => /dangling reference/.test(e.message))).toBe(false);
  });
});

test('lintAdrDir: a gap in ADR numbering is a non-blocking WARN', () => {
  const a = makeAdr({ num: '0917', status: 'Accepted', author: 'Alice', reviewers: 'Bob', deciders: 'Carol' });
  const b = makeAdr({ num: '0919', status: 'Accepted', author: 'Alice', reviewers: 'Bob', deciders: 'Carol' });
  withFixtureDir({ '0917-fixture.md': a, '0919-fixture.md': b }, (dir) => {
    const { issues } = lintAdrDir(dir);
    expect(issues.some((i) => i.type === 'WARN' && /ADR 0918 is missing/.test(i.message))).toBe(true);
    expect(issues.some((i) => i.type === 'ERROR' && /0918/.test(i.message))).toBe(false);
  });
});

test('lintAdrDir: contiguous ADR numbers produce no numbering-gap warning (negative space)', () => {
  const a = makeAdr({ num: '0917', status: 'Accepted', author: 'Alice', reviewers: 'Bob', deciders: 'Carol' });
  const b = makeAdr({ num: '0918', status: 'Accepted', author: 'Alice', reviewers: 'Bob', deciders: 'Carol' });
  withFixtureDir({ '0917-fixture.md': a, '0918-fixture.md': b }, (dir) => {
    const { issues } = lintAdrDir(dir);
    expect(issues.some((i) => /is missing between existing ADRs/.test(i.message))).toBe(false);
  });
});

test('lintAdrDir: a stale/missing docs/adr/index.yaml or README index is a blocking ERROR', () => {
  const content = makeAdr({ num: '0920', status: 'Accepted', author: 'Alice', reviewers: 'Bob', deciders: 'Carol' });
  withFixtureDir(
    {
      '0920-fixture.md': content,
      'README.md': '<!-- ADR-INDEX:START -->\n<!-- ADR-INDEX:END -->\n',
      // Explicitly wrong (not the auto-computed default) -- withFixtureDir would otherwise
      // inject a correct index.yaml for fixtures that aren't testing index freshness itself.
      'index.yaml': 'adrs: []\n',
    },
    (dir) => {
      const { issues } = lintAdrDir(dir);
      expect(issues.some((i) => i.type === 'ERROR' && i.file === 'docs/adr/index.yaml')).toBe(true);
      expect(issues.some((i) => i.type === 'ERROR' && i.file === 'docs/adr/README.md')).toBe(true);
    }
  );
});

test('lintAdrDir: a current index.yaml and README index are not flagged (negative space)', () => {
  const content = makeAdr({ num: '0920', status: 'Accepted', author: 'Alice', reviewers: 'Bob', deciders: 'Carol' });
  const entries = [{ number: '0920', file: '0920-fixture.md', title: 'Fixture ADR', status: 'Accepted', date: '2026-07-28' }];
  withFixtureDir(
    {
      '0920-fixture.md': content,
      'README.md': `<!-- ADR-INDEX:START -->\n${renderDocIndexList(entries)}\n<!-- ADR-INDEX:END -->\n`,
      'index.yaml': renderDocIndexYaml(entries, ADR_INDEX_YAML_OPTIONS),
    },
    (dir) => {
      const { issues } = lintAdrDir(dir);
      expect(issues.some((i) => i.file === 'docs/adr/index.yaml' || i.file === 'docs/adr/README.md')).toBe(false);
    }
  );
});

test('lintAdrDir: a covered path changing without any docs/adr/ change is a non-blocking WARN', () => {
  const content = makeAdr({ num: '0921', status: 'Accepted', author: 'Alice', reviewers: 'Bob', deciders: 'Carol' });
  withFixtureDir({ '0921-fixture.md': content }, (dir) => {
    const { issues } = lintAdrDir(dir, ['docs/specs/some-spec.md']);
    expect(
      issues.some((i) => i.type === 'WARN' && /source changed without any docs\/adr\/\*\* change/.test(i.message))
    ).toBe(true);
  });
});

test('lintAdrDir: a covered path change alongside a docs/adr/ change produces no coverage warning (negative space)', () => {
  const content = makeAdr({ num: '0921', status: 'Accepted', author: 'Alice', reviewers: 'Bob', deciders: 'Carol' });
  withFixtureDir({ '0921-fixture.md': content }, (dir) => {
    const { issues } = lintAdrDir(dir, ['docs/specs/some-spec.md', 'docs/adr/0921-fixture.md']);
    expect(issues.some((i) => /source changed without any docs\/adr\/\*\* change/.test(i.message))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Direct pure-function unit + property/fuzz tests for every check extracted
// out of lintAdrDir. Zero filesystem I/O — each check is content/data in,
// Issue[] out. Complements (does not replace) the fixture-based lintAdrDir
// integration tests above, which verify end-to-end wiring; these verify
// each check's exact logic, including randomized edge cases.
// ---------------------------------------------------------------------------

describe('checkFilenameFormat', () => {
  test('a well-formed filename produces no issues', () => {
    expect(checkFilenameFormat('0032-adopt-rfc-lite.md')).toEqual([]);
  });

  test('a malformed filename is a blocking error', () => {
    const issues = checkFilenameFormat('ADR-0032-bad.md');
    expect(issues).toHaveLength(1);
    expect(issues[0].type).toBe('ERROR');
  });

  test('property: any string matching FILENAME_RE never produces an issue', () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^[0-9]{4}-[a-z0-9-]+\.md$/),
        (file) => {
          expect(checkFilenameFormat(file)).toEqual([]);
        }
      )
    );
  });

  test('property: a string missing the .md suffix always fails', () => {
    fc.assert(
      fc.property(fc.stringMatching(/^[0-9]{4}-[a-z0-9-]+$/), (base) => {
        expect(FILENAME_RE.test(base)).toBe(false);
        expect(checkFilenameFormat(base)).toHaveLength(1);
      })
    );
  });
});

describe('findDuplicateNumbers', () => {
  test('no duplicates produces no issues', () => {
    expect(findDuplicateNumbers(['0001-a.md', '0002-b.md', '0003-c.md'])).toEqual([]);
  });

  test('a duplicate pair flags only the second occurrence', () => {
    const issues = findDuplicateNumbers(['0001-a.md', '0001-b.md']);
    expect(issues).toHaveLength(1);
    expect(issues[0].file).toBe('0001-b.md');
  });

  test('a triple duplicate flags the 2nd and 3rd occurrences, not the 1st', () => {
    const issues = findDuplicateNumbers(['0001-a.md', '0001-b.md', '0001-c.md']);
    expect(issues.map((i) => i.file)).toEqual(['0001-b.md', '0001-c.md']);
  });

  test('property: for a random list of unique 4-digit numbers, no file is ever flagged', () => {
    fc.assert(
      fc.property(fc.uniqueArray(fc.integer({ min: 0, max: 9999 }), { minLength: 1, maxLength: 30 }), (nums) => {
        const files = nums.map((n) => `${String(n).padStart(4, '0')}-x.md`);
        expect(findDuplicateNumbers(files)).toEqual([]);
      })
    );
  });

  test('property: issue count equals total files minus distinct numbers', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: 20 }), { minLength: 1, maxLength: 40 }),
        (nums) => {
          const files = nums.map((n, i) => `${String(n).padStart(4, '0')}-x${i}.md`);
          const distinct = new Set(nums).size;
          expect(findDuplicateNumbers(files)).toHaveLength(files.length - distinct);
        }
      )
    );
  });
});

describe('checkStatusField', () => {
  test('a valid status produces no issues and returns the parsed status', () => {
    const { issues, status } = checkStatusField('- **Status:** Accepted\n', 'x.md');
    expect(issues).toEqual([]);
    expect(status).toBe('Accepted');
  });

  test('an invalid status is a blocking error', () => {
    const { issues } = checkStatusField('- **Status:** Revised\n', 'x.md');
    expect(issues).toHaveLength(1);
    expect(issues[0].type).toBe('ERROR');
  });

  test('a missing status field is a blocking error, status is null', () => {
    const { issues, status } = checkStatusField('no status here\n', 'x.md');
    expect(issues).toHaveLength(1);
    expect(status).toBeNull();
  });

  test('property: any value from VALID_STATUSES always passes', () => {
    fc.assert(
      fc.property(fc.constantFrom(...VALID_STATUSES), (s) => {
        const { issues, status } = checkStatusField(`- **Status:** ${s}\n`, 'x.md');
        expect(issues).toEqual([]);
        expect(status).toBe(s);
      })
    );
  });

  test('property: a random alphabetic value never in VALID_STATUSES always fails', () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^[A-Z][a-z]{2,12}$/).filter((s) => !VALID_STATUSES.has(s)),
        (s) => {
          const { issues } = checkStatusField(`- **Status:** ${s}\n`, 'x.md');
          expect(issues).toHaveLength(1);
        }
      )
    );
  });
});

describe('checkDateField', () => {
  test('a valid date produces no issues', () => {
    expect(checkDateField('- **Date:** 2026-07-28\n', 'x.md')).toEqual([]);
  });

  test('a missing date is a blocking error', () => {
    expect(checkDateField('no date here\n', 'x.md')).toHaveLength(1);
  });

  test('property: any YYYY-MM-DD digit shape always passes (DATE_RE checks shape, not calendar validity)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 9999 }),
        fc.integer({ min: 0, max: 99 }),
        fc.integer({ min: 0, max: 99 }),
        (y, m, d) => {
          const date = `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
          expect(checkDateField(`- **Date:** ${date}\n`, 'x.md')).toEqual([]);
        }
      )
    );
  });

  test('property: a slash-separated date never matches, regardless of digits', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 12 }),
        fc.integer({ min: 1, max: 28 }),
        fc.integer({ min: 2000, max: 2099 }),
        (m, d, y) => {
          const date = `${String(m).padStart(2, '0')}/${String(d).padStart(2, '0')}/${y}`;
          expect(checkDateField(`- **Date:** ${date}\n`, 'x.md')).toHaveLength(1);
        }
      )
    );
  });
});

// Verifies: ADR-0082
describe('checkAcceptedField', () => {
  const hdr = (status: string, accepted: string | null, date = '2026-07-01') =>
    `- **Status:** ${status}\n- **Date:** ${date}\n` +
    (accepted === null ? '' : `- **Accepted:** ${accepted}\n`) +
    '- **Embodiment:** Not started\n';

  test('an Accepted ADR with a well-formed date produces no issues', () => {
    expect(checkAcceptedField(hdr('Accepted', '2026-07-05'), 'x.md', 'Accepted')).toEqual([]);
  });

  test('an Accepted ADR with no Accepted field is a blocking error', () => {
    const issues = checkAcceptedField(hdr('Accepted', null), 'x.md', 'Accepted');
    expect(issues).toHaveLength(1);
    expect(issues[0].type).toBe('ERROR');
  });

  test('a Proposed ADR with no Accepted field produces no issues', () => {
    expect(checkAcceptedField(hdr('Proposed', null), 'x.md', 'Proposed')).toEqual([]);
  });

  // The self-approval case: an agent drafting an ADR must not assert an approval date.
  test('a Proposed ADR carrying an acceptance date is a blocking error', () => {
    const issues = checkAcceptedField(hdr('Proposed', '2026-07-05'), 'x.md', 'Proposed');
    expect(issues).toHaveLength(1);
    expect(issues[0].type).toBe('ERROR');
    expect(issues[0].message).toContain('have been accepted');
  });

  test('Rejected and Withdrawn are treated the same way — the field is wrong, not optional', () => {
    for (const status of ['Rejected', 'Withdrawn']) {
      expect(checkAcceptedField(hdr(status, '2026-07-05'), 'x.md', status)).toHaveLength(1);
      expect(checkAcceptedField(hdr(status, null), 'x.md', status)).toEqual([]);
    }
  });

  // Superseded/Deprecated ADRs were Accepted first; losing the date on the way out would
  // delete history exactly when the record becomes historical.
  test('Superseded and Deprecated still require an acceptance date', () => {
    for (const status of ['Superseded', 'Deprecated']) {
      expect(checkAcceptedField(hdr(status, null), 'x.md', status)).toHaveLength(1);
      expect(checkAcceptedField(hdr(status, '2026-07-05'), 'x.md', status)).toEqual([]);
    }
  });

  test('a blank or placeholder value is treated as missing, not as present', () => {
    for (const value of ['', 'TBD', 'pending', '—']) {
      const issues = checkAcceptedField(hdr('Accepted', value), 'x.md', 'Accepted');
      expect(issues).toHaveLength(1);
      expect(issues[0].message).toContain('missing or blank');
    }
  });

  test('a non-ISO date is a blocking error', () => {
    for (const value of ['2026/07/05', '05-07-2026', 'July 5 2026', '2026-7-5']) {
      const issues = checkAcceptedField(hdr('Accepted', value), 'x.md', 'Accepted');
      expect(issues).toHaveLength(1);
      expect(issues[0].message).toContain('malformed');
    }
  });

  test('an acceptance date earlier than Date is warn-only, not blocking', () => {
    const issues = checkAcceptedField(hdr('Accepted', '2026-06-01', '2026-07-01'), 'x.md', 'Accepted');
    expect(issues).toHaveLength(1);
    expect(issues[0].type).toBe('WARN');
  });

  // The field is anchored to the list-item form: prose or a table cell mentioning
  // "Accepted:" must not be read as the field. This is the bug class that bit the corpus
  // this field was added for — a header key invented in prose that no parser could see.
  test('an "Accepted:" mention outside the header list is not read as the field', () => {
    const content =
      '- **Status:** Proposed\n- **Date:** 2026-07-01\n\n' +
      '## Context\n\nThe prior RFC was Accepted: 2026-06-01, which is prose, not a field.\n';
    expect(checkAcceptedField(content, 'x.md', 'Proposed')).toEqual([]);
  });

  test('a null status (missing Status field) raises no acceptance-date issue of its own', () => {
    expect(checkAcceptedField(hdr('Accepted', null), 'x.md', null)).toEqual([]);
  });

  test('property: every acceptance-bearing status demands the field, every other status forbids it', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...VALID_STATUSES),
        fc.boolean(),
        (status, withDate) => {
          const issues = checkAcceptedField(
            hdr(status, withDate ? '2026-07-05' : null),
            'x.md',
            status
          );
          const wanted = ACCEPTANCE_BEARING_STATUSES.has(status);
          expect(issues.length === 0).toBe(wanted === withDate);
        }
      )
    );
  });

  // A body list item must not satisfy a header field. The body is made of list items too, so
  // anchoring to the list-item shape alone was not enough — field lookup is scoped to the
  // header block above the first "## " heading.
  test('an "- **Accepted:**" bullet in the body does not satisfy the header field', () => {
    const content =
      '- **Status:** Accepted\n- **Date:** 2026-07-01\n\n' +
      '## Consequences\n\n- **Accepted:** 2026-07-05 — an example of the new field, in prose\n';
    const issues = checkAcceptedField(content, 'x.md', 'Accepted');
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toContain('missing or blank');
  });

  test('a body bullet does not trip the forbidden direction on a Proposed ADR either', () => {
    const content =
      '- **Status:** Proposed\n- **Date:** 2026-07-01\n\n' +
      '## Context\n\n- **Accepted:** 2026-07-05 is what the field will look like\n';
    expect(checkAcceptedField(content, 'x.md', 'Proposed')).toEqual([]);
  });

  // Duplicate/unknown keys are checkHeaderStructure's job — closure is asked once, centrally,
  // rather than re-implemented by each field check. checkAcceptedField reads the first value and
  // trusts the structure check to have flagged the duplication.
  test('a duplicated Accepted field is reported by the structure check, not this one', () => {
    const content =
      '- **Status:** Accepted\n- **Date:** 2026-07-01\n' +
      '- **Accepted:** 2026-07-05\n- **Accepted:** 2026-07-09\n\n## Context\n';
    expect(checkAcceptedField(content, 'x.md', 'Accepted')).toEqual([]);
    const structural = checkHeaderStructure(content, 'x.md');
    expect(structural).toHaveLength(1);
    expect(structural[0].type).toBe('ERROR');
    expect(structural[0].message).toContain('appears 2 times');
  });

  // Shape-valid but impossible dates: the historical values were machine-derived in bulk, where
  // an arithmetic slip yields a day that never existed rather than merely the wrong one.
  test('a well-shaped but impossible calendar date is a blocking error', () => {
    for (const value of ['2026-02-30', '2026-13-01', '2026-00-10', '2026-04-31', '2025-02-29']) {
      const issues = checkAcceptedField(hdr('Accepted', value), 'x.md', 'Accepted');
      expect(issues).toHaveLength(1);
      expect(issues[0].message).toContain('malformed');
    }
  });

  test('a leap day in an actual leap year is accepted', () => {
    expect(checkAcceptedField(hdr('Accepted', '2028-02-29', '2028-01-01'), 'x.md', 'Accepted')).toEqual([]);
  });

  test('property: a real calendar date always passes, an impossible one never does', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1970, max: 2999 }),
        fc.integer({ min: 1, max: 12 }),
        fc.integer({ min: 1, max: 31 }),
        (y, m, d) => {
          const iso = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
          const real = new Date(Date.UTC(y, m - 1, d)).getUTCDate() === d;
          const issues = checkAcceptedField(hdr('Accepted', iso, `${y}-01-01`), 'x.md', 'Accepted');
          expect(issues.filter((i) => i.type === 'ERROR')).toHaveLength(real ? 0 : 1);
        }
      )
    );
  });
});

// Verifies: ADR-0083
describe('parseHeader / checkHeaderStructure', () => {
  test('the header is the contiguous run of field lines, anchored at the first one', () => {
    const content = '# 0001 — T\n\n> Y-statement prose\n\n- **Status:** Accepted\n- **Date:** 2026-07-01\n\n## Context\n\n- **Cost:** a body bullet\n';
    const parsed = parseHeader(content);
    expect(parsed.found).toBe(true);
    expect(parsed.fields.map((f) => f.key)).toEqual(['Status', 'Date']);
  });

  // Verifies: ADR-0085
  // Five records in this corpus wrap a header value over two or more lines. A rule that attached
  // only the first continuation dropped the rest, silently — and for a Realized by value that
  // means the audit computes embodiment from a locator set it never knew was incomplete.
  test('a value wrapped across several continuation lines is captured in full', () => {
    const content =
      '- **Status:** Accepted\n- **Realized by:** a.sol,\n  b.sol,\n  c.sol\n- **Date:** 2026-07-01\n\n## C\n';
    const parsed = parseHeader(content);
    expect(parsed.fields.find((f) => f.key === 'Realized by')?.value).toBe('a.sol, b.sol, c.sol');
    expect(parsed.fields.map((f) => f.key)).toEqual(['Status', 'Realized by', 'Date']);
  });

  // Verifies: ADR-0085
  test('a blank line or blockquote inside the header does not end it', () => {
    const content =
      '- **Status:** Accepted\n- **Date:** 2026-07-01\n\n> **Correction:** prose\n\n- **Deciders:** Beau\n\n## Context\n';
    expect(parseHeader(content).fields.map((f) => f.key)).toEqual(['Status', 'Date', 'Deciders']);
  });

  // Verifies: ADR-0085
  test('an indented line after a gap does not attach to the field above the gap', () => {
    const content =
      '- **Status:** Accepted\n- **Date:** 2026-07-01\n\n> quote\n\n  stray indented line\n\n- **Deciders:** Beau\n\n## Context\n';
    const parsed = parseHeader(content);
    expect(parsed.fields.find((f) => f.key === 'Date')?.value).toBe('2026-07-01');
    expect(parsed.fields.map((f) => f.key)).toEqual(['Status', 'Date', 'Deciders']);
  });

  // fieldRegex's terminator and HEADER_FIELD_LINE_RE must accept the same whitespace: with only
  // "\n- " accepted, a tab-indented field was not seen as the next field and was swallowed into
  // the value above it.
  test('a tab-separated field line terminates the previous field value', () => {
    const content = "- **Status:** Accepted\n- **Author:** Beau\n-\t**Deciders:** Ada\n\n## Context\n";
    expect(parseHeader(content).fields.map((f) => f.key)).toEqual(['Status', 'Author', 'Deciders']);
    expect(fieldValue(headerText(content), AUTHOR_RE)).toBe('Beau');
  });

  test('an indented continuation line attaches to the field above it', () => {
    const content = '- **Status:** Accepted\n- **Last audited:** 2026-07-01 (added an\n  Implements comment)\n- **Date:** 2026-07-01\n\n## Context\n';
    const parsed = parseHeader(content);
    expect(parsed.fields.map((f) => f.key)).toEqual(['Status', 'Last audited', 'Date']);
    expect(parsed.fields[1].value).toBe('2026-07-01 (added an Implements comment)');
  });

  // The regression that motivated abandoning the positional slice: a heading above the metadata
  // must not truncate the header to nothing. Under slice-at-first-"##" this found no fields at
  // all, and every check scoped to it silently passed.
  test('a heading ABOVE the metadata does not truncate the header', () => {
    const content = '# 0001 — T\n\n## Update 2026-08-11\n\nA dated supplement on top.\n\n- **Status:** Accepted\n- **Date:** 2026-07-01\n\n## Context\n';
    const parsed = parseHeader(content);
    expect(parsed.fields.map((f) => f.key)).toEqual(['Status', 'Date']);
    expect(checkStatusField(content, 'x.md').status).toBe('Accepted');
    expect(checkDateField(content, 'x.md')).toEqual([]);
  });

  // The decoy-text failure a whole-document search invites.
  test('a Status label in body prose is not the field', () => {
    const content = '- **Status:** Proposed\n- **Date:** 2026-07-01\n\n## Context\n\nThe pipeline reports **Status:** Accepted when it finishes.\n';
    expect(checkStatusField(content, 'x.md').status).toBe('Proposed');
  });

  // A preamble bullet in the header's shape must not be mistaken for the header. Anchoring on
  // "first metadata-shaped run" alone selected it, which read as a record with no Status — loud
  // for Status itself, but silently skipping every check keyed off the status value.
  test('a metadata-shaped bullet before the header does not become the header', () => {
    const content =
      '# 0099 — T\n\n- **Note:** an aside in the preamble\n\n' +
      '- **Status:** Accepted\n- **Date:** 2026-07-01\n- **Accepted:** 2026-07-01\n\n## Context\n';
    const parsed = parseHeader(content);
    expect(parsed.fields.map((f) => f.key)).toEqual(['Status', 'Date', 'Accepted']);
    expect(checkStatusField(content, 'x.md').status).toBe('Accepted');
    expect(checkAcceptedField(content, 'x.md', 'Accepted')).toEqual([]);
  });

  test('a run without the signature key is still reported when no better run exists', () => {
    const issues = checkHeaderStructure('# T\n\n- **Note:** no status anywhere\n\n## Context\n', 'x.md');
    expect(issues.some((i) => /unknown header field "Note"/.test(i.message))).toBe(true);
  });

  test('a document with no metadata run has no header, and that is an error', () => {
    const issues = checkHeaderStructure('# 0001 — T\n\nJust prose.\n', 'x.md');
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toContain('no header field block found');
  });

  test('an unknown header key is a blocking error', () => {
    const issues = checkHeaderStructure('- **Status:** Accepted\n- **Approved:** 2026-07-01\n\n## Context\n', 'x.md');
    expect(issues).toHaveLength(1);
    expect(issues[0].type).toBe('ERROR');
    expect(issues[0].message).toContain('unknown header field "Approved"');
  });

  test('an "x-" prefixed key is the declared extension escape hatch', () => {
    expect(checkHeaderStructure('- **Status:** Accepted\n- **x-team:** payments\n\n## Context\n', 'x.md')).toEqual([]);
  });

  test('every known key passes closure', () => {
    const header = [...KNOWN_HEADER_KEYS].map((k) => `- **${k}:** v`).join('\n');
    expect(checkHeaderStructure(`${header}\n\n## Context\n`, 'x.md')).toEqual([]);
  });

  test('headerText excludes the body, so body bullets cannot satisfy a field regex', () => {
    const content = '- **Status:** Accepted\n- **Date:** 2026-07-01\n\n## Context\n\n- **Author:** Someone In The Body\n';
    expect(headerText(content)).not.toContain('Someone In The Body');
  });

  test('the real corpus is closed: every header key is known and unique', () => {
    const files = readdirSync(ADR_DIR).filter((f) => /^\d{4}-.*\.md$/.test(f));
    expect(files.length).toBeGreaterThan(0);
    const issues = files.flatMap((f) =>
      checkHeaderStructure(readFileSync(join(ADR_DIR, f), 'utf8'), f)
    );
    expect(issues).toEqual([]);
  });
});

// Verifies: ADR-0084
describe('findAnyAdrRefs (published-path boundary matcher)', () => {
  // The whole point of the wider matcher: every real violation found in the mirrored package
  // was prose, and none of them was a structured marker. The narrow evidence matcher reported
  // a confident zero for years against a corpus that was not clean.
  test('prose citation forms are found, and the marker matcher misses all of them', () => {
    for (const line of [
      'a parenthetical (ADR-0026) in a doc comment',
      '// see ADR-0028 for why this is split',
      'per ADR-0028, the reservation happens first',
      "ADR-0029's own chosen option was the second one",
    ]) {
      expect(findAnyAdrRefs(line)).toHaveLength(1);
      expect(findCommentAdrRefs(line)).toEqual([]);
    }
  });

  test('structured markers are found too — the wide matcher is a superset', () => {
    expect(findAnyAdrRefs('// Implements: ADR-0002')).toEqual(['0002']); // adr-scan:ignore-line
  });

  test('references are deduped and sorted', () => {
    expect(findAnyAdrRefs('ADR-0011 and ADR-0002 and ADR-0011 again')).toEqual(['0002', '0011']);
  });

  test('text that is not a reference is not matched', () => {
    expect(findAnyAdrRefs('ADR-12 ADR-123 ADRS-0001 adr-0001')).toEqual([]);
  });

  // The two questions must not collapse: widening the boundary matcher into the evidence
  // matcher would mark a decision Implemented because someone wrote "see ADR-0042".
  test('a prose citation is never embodiment evidence', () => {
    const prose = '// this mirrors the shape chosen in ADR-0042\n';
    expect(findAnyAdrRefs(prose)).toEqual(['0042']);
    expect(findCommentAdrRefs(prose)).toEqual([]);
  });

  test('the ignore marker still applies, so a fixture that looks like a reference is exempt', () => {
    const fixture = `const example = 'ADR-0042'; // ${ADR_SCAN_IGNORE_MARKER}\n`;
    expect(findAnyAdrRefs(stripIgnoredLines(fixture))).toEqual([]);
  });
});

// Verifies: ADR-0083
describe('checkStatusEmbodimentConsistency', () => {
  const rec = (status: string, embodiment: string) =>
    `- **Status:** ${status}\n- **Date:** 2026-07-01\n- **Embodiment:** ${embodiment}\n\n## Context\n`;

  test('an unapproved record claiming realization is a blocking error', () => {
    for (const status of ['Proposed', 'Rejected', 'Withdrawn']) {
      for (const embodiment of ['Implemented', 'Verified']) {
        const issues = checkStatusEmbodimentConsistency(rec(status, embodiment), 'x.md', status);
        expect(issues).toHaveLength(1);
        expect(issues[0].type).toBe('ERROR');
      }
    }
  });

  test('an accepted record may claim anything', () => {
    for (const status of ['Accepted', 'Superseded', 'Deprecated']) {
      expect(checkStatusEmbodimentConsistency(rec(status, 'Verified'), 'x.md', status)).toEqual([]);
    }
  });

  test('an unapproved record that claims no realization is fine', () => {
    for (const embodiment of ['Not started', 'Specified', 'Inactive']) {
      expect(checkStatusEmbodimentConsistency(rec('Proposed', embodiment), 'x.md', 'Proposed')).toEqual([]);
    }
  });

  test('a trailing annotation on the embodiment value does not defeat the check', () => {
    const issues = checkStatusEmbodimentConsistency(
      rec('Proposed', 'Verified (see the migration note)'),
      'x.md',
      'Proposed'
    );
    expect(issues).toHaveLength(1);
  });

  // Header-scoped like every other field read: a body bullet must not decide this.
  test('an Embodiment line in the body does not trigger the check', () => {
    const content =
      '- **Status:** Proposed\n- **Date:** 2026-07-01\n- **Embodiment:** Not started\n\n' +
      '## Context\n\n- **Embodiment:** Verified is what this will become.\n';
    expect(checkStatusEmbodimentConsistency(content, 'x.md', 'Proposed')).toEqual([]);
  });

  test('the real corpus has no unapproved record claiming realization', () => {
    const files = readdirSync(ADR_DIR).filter((f) => /^\d{4}-.*\.md$/.test(f));
    const issues = files.flatMap((f) => {
      const content = readFileSync(join(ADR_DIR, f), 'utf8');
      const { status } = checkStatusField(content, f);
      return checkStatusEmbodimentConsistency(content, f, status);
    });
    expect(issues).toEqual([]);
  });
});

describe('statesADecision', () => {
  test('a Withdrawn record is exempt from the checks that presuppose a decision', () => {
    expect(statesADecision('Withdrawn')).toBe(false);
  });

  test('every other status still states a decision', () => {
    for (const status of [...VALID_STATUSES].filter((s) => s !== 'Withdrawn')) {
      expect(statesADecision(status)).toBe(true);
    }
  });

  test('an unreadable status is treated as stating a decision, so the checks still run', () => {
    expect(statesADecision(null)).toBe(true);
  });
});

describe('tombstone records', () => {
  const tombstone = [
    '# 0012 — Vacated: renumbered',
    '',
    '- **Status:** Withdrawn',
    '- **Date:** 2026-07-20',
    '- **Embodiment:** Inactive',
    '',
    'No decision was made under this number.',
    '',
  ].join('\n');

  const structuralErrors = (dir: string): string[] =>
    lintAdrDir(dir)
      .issues.filter((i) => i.type === 'ERROR')
      .map((i) => i.message)
      .filter((m) => /Y-statement|required section|rejected alternative/.test(m));

  test('a tombstone raises none of the checks that presuppose a decision', () => {
    const dir = mkdtempSync(join(tmpdir(), 'adr-tombstone-'));
    try {
      writeFileSync(join(dir, '0012-vacated.md'), tombstone);
      expect(structuralErrors(dir)).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('the same body under a decision-bearing status still fails those checks', () => {
    const dir = mkdtempSync(join(tmpdir(), 'adr-tombstone-'));
    try {
      writeFileSync(join(dir, '0012-vacated.md'), tombstone.replace('**Status:** Withdrawn', '**Status:** Accepted'));
      const messages = structuralErrors(dir);
      expect(messages.some((m) => /Y-statement/.test(m))).toBe(true);
      expect(messages.some((m) => /## Decision/.test(m))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('checkRequiredSections', () => {
  const ALL_HEADINGS = REQUIRED_SECTIONS.map((a) => a[0]);
  const VALID = ALL_HEADINGS.map((h) => `## ${h}\n`).join('\n');

  test('all sections present produces no issues', () => {
    expect(checkRequiredSections(VALID, 'x.md')).toEqual([]);
  });

  test('property: random omitted subset is flagged exactly, nothing else', () => {
    fc.assert(
      fc.property(fc.uniqueArray(fc.constantFrom(...ALL_HEADINGS), { minLength: 1 }), (omitted) => {
        let text = VALID;
        for (const heading of omitted) {
          text = text.replace(`## ${heading}\n`, `## Removed-${heading}\n`);
        }
        const issues = checkRequiredSections(text, 'x.md');
        const flagged = new Set(
          ALL_HEADINGS.filter((h) => issues.some((i) => i.message.includes(`## ${h}`)))
        );
        expect(flagged).toEqual(new Set(omitted));
      })
    );
  });
});

describe('checkYStatement', () => {
  const VALID_Y_BLOCK =
    '**Decision (Y-statement):** In the context of a test, facing a need, we decided to test, to achieve coverage, accepting the verbosity.\n\n## Context\n';

  test('a fully valid Y-statement produces no issues', () => {
    expect(checkYStatement(VALID_Y_BLOCK, 'x.md')).toEqual([]);
  });

  test('a missing marker is a single extraction-independent error', () => {
    const issues = checkYStatement('no marker here\n', 'x.md');
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toContain('missing **Decision (Y-statement):**');
  });

  test('property: random omitted keyword subset is flagged exactly, nothing else', () => {
    fc.assert(
      fc.property(fc.uniqueArray(fc.constantFrom(...Y_STATEMENT_KEYWORDS), { minLength: 1 }), (omitted) => {
        let text = VALID_Y_BLOCK;
        for (const kw of omitted) {
          // Replace with a scrambled version that can't accidentally match another keyword's
          // word-boundary regex (e.g. don't turn "we decided" into text containing "accepting").
          text = text.replace(kw, kw.split('').reverse().join('_'));
        }
        const issues = checkYStatement(text, 'x.md');
        const flagged = new Set(
          Y_STATEMENT_KEYWORDS.filter((kw) => issues.some((i) => i.message.includes(`"${kw}"`)))
        );
        expect(flagged).toEqual(new Set(omitted));
      })
    );
  });
});

describe('checkConsideredOptionsMinimum (direct)', () => {
  const withRows = (rows: number) => {
    const dataRows = Array.from({ length: rows }, (_, i) => `| Option ${i} | pro | con |`).join('\n');
    return `## Considered options\n\n| Option | Pros | Cons |\n|---|---|---|\n${dataRows}\n\n## Decision\n`;
  };

  test('property: flagged if and only if fewer than 2 rows', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 8 }), (rows) => {
        const issues = checkConsideredOptionsMinimum(withRows(rows), 'x.md');
        expect(issues.length > 0).toBe(rows < 2);
      })
    );
  });
});

describe('checkAuthorReviewersDeciders (direct)', () => {
  function adr(author?: string, reviewers?: string, deciders?: string): string {
    // fieldRegex's lazy capture needs a following "\n- **" or "\n##" to terminate on — without
    // a trailing heading, the LAST field's value would fail to match at all (fieldValue would
    // wrongly return null for it, reading as a placeholder regardless of its real value).
    return (
      [
        author !== undefined ? `- **Author:** ${author}` : '',
        reviewers !== undefined ? `- **Reviewers:** ${reviewers}` : '',
        deciders !== undefined ? `- **Deciders:** ${deciders}` : '',
      ].join('\n') + '\n## Context\n'
    );
  }

  test('Accepted + placeholder Deciders is blocking', () => {
    const issues = checkAuthorReviewersDeciders(adr('Alice', 'Bob', '—'), 'x.md', 'Accepted');
    expect(issues.some((i) => i.type === 'ERROR')).toBe(true);
  });

  test('Accepted + placeholder Reviewers is warn-only', () => {
    const issues = checkAuthorReviewersDeciders(adr('Alice', '—', 'Carol'), 'x.md', 'Accepted');
    expect(issues.every((i) => i.type === 'WARN')).toBe(true);
    expect(issues.length).toBeGreaterThan(0);
  });

  test('Proposed + placeholder Deciders is not flagged at all (negative space)', () => {
    const issues = checkAuthorReviewersDeciders(adr('Alice', 'Bob', '—'), 'x.md', 'Proposed');
    expect(issues).toEqual([]);
  });

  test('self-ack smell is suppressed when author self-review is allowed', () => {
    const issues = checkAuthorReviewersDeciders(adr('Carol', 'Carol', 'Carol'), 'x.md', 'Accepted', true);
    expect(issues.some((i) => /self-ack smell/.test(i.message))).toBe(false);
  });

  test('a blank Deciders still blocks even when author self-review is allowed', () => {
    const issues = checkAuthorReviewersDeciders(adr('Carol', 'Carol', '—'), 'x.md', 'Accepted', true);
    expect(issues.some((i) => i.type === 'ERROR' && /Deciders is blank/.test(i.message))).toBe(true);
  });

  test('a blank Reviewers still warns even when author self-review is allowed', () => {
    const issues = checkAuthorReviewersDeciders(adr('Carol', '—', 'Carol'), 'x.md', 'Accepted', true);
    expect(issues.some((i) => i.type === 'WARN' && /Reviewers is blank/.test(i.message))).toBe(true);
  });

  test('property: across every Status x placeholder-combination, Deciders-blocking fires iff Accepted and Deciders is a placeholder', () => {
    const names = ['—', 'Alice', 'Bob', 'Carol'];
    fc.assert(
      fc.property(
        fc.constantFrom('Proposed', 'Accepted', 'Superseded'),
        fc.constantFrom(...names),
        fc.constantFrom(...names),
        fc.constantFrom(...names),
        (status, author, reviewers, deciders) => {
          const issues = checkAuthorReviewersDeciders(adr(author, reviewers, deciders), 'x.md', status);
          const decidersBlocking = issues.some(
            (i) => i.type === 'ERROR' && i.message.includes('Deciders is blank or a placeholder')
          );
          expect(decidersBlocking).toBe(status === 'Accepted' && deciders === '—');
        }
      )
    );
  });

  test('property: self-ack WARN fires iff Author matches Deciders/Reviewers and Author is not a placeholder', () => {
    const names = ['—', 'Alice', 'Bob'];
    fc.assert(
      fc.property(
        fc.constantFrom(...names),
        fc.constantFrom(...names),
        fc.constantFrom(...names),
        (author, reviewers, deciders) => {
          const issues = checkAuthorReviewersDeciders(adr(author, reviewers, deciders), 'x.md', 'Accepted');
          const deciderSelfAck = issues.some((i) => i.message.includes('Author and Deciders name the same person'));
          expect(deciderSelfAck).toBe(author !== '—' && deciders !== '—' && author === deciders);
        }
      )
    );
  });
});

describe('checkDanglingReferences', () => {
  test('a reference to a known number is not flagged', () => {
    expect(checkDanglingReferences('see ADR-0001', 'x.md', new Set(['0001']))).toEqual([]);
  });

  test('a reference to an unknown number is a blocking error', () => {
    const issues = checkDanglingReferences('see ADR-9999', 'x.md', new Set(['0001']));
    expect(issues).toHaveLength(1);
    expect(issues[0].type).toBe('ERROR');
  });

  test('property: exactly the referenced numbers outside the known set are flagged', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.integer({ min: 0, max: 50 }), { minLength: 0, maxLength: 10 }),
        fc.uniqueArray(fc.integer({ min: 0, max: 50 }), { minLength: 0, maxLength: 10 }),
        (knownNums, referencedNums) => {
          const known = new Set(knownNums.map((n) => String(n).padStart(4, '0')));
          const content = referencedNums.map((n) => `ADR-${String(n).padStart(4, '0')}`).join(' and ');
          const issues = checkDanglingReferences(content, 'x.md', known);
          const flaggedNums = new Set(
            issues.map((i) => /ADR-(\d{4})/.exec(i.message)![1])
          );
          const expectedDangling = new Set(
            referencedNums.map((n) => String(n).padStart(4, '0')).filter((n) => !known.has(n))
          );
          expect(flaggedNums).toEqual(expectedDangling);
        }
      )
    );
  });
});

describe('checkNumberingGaps', () => {
  test('contiguous numbers produce no warnings', () => {
    expect(checkNumberingGaps(new Set(['0001', '0002', '0003']))).toEqual([]);
  });

  test('a single gap is flagged', () => {
    const issues = checkNumberingGaps(new Set(['0001', '0003']));
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toContain('0002');
  });

  test('empty set produces no warnings', () => {
    expect(checkNumberingGaps(new Set())).toEqual([]);
  });

  test('property: warning count equals (max - min + 1) - distinct count', () => {
    fc.assert(
      fc.property(fc.uniqueArray(fc.integer({ min: 0, max: 60 }), { minLength: 1, maxLength: 20 }), (nums) => {
        const set = new Set(nums.map((n) => String(n).padStart(4, '0')));
        const min = Math.min(...nums);
        const max = Math.max(...nums);
        const span = max - min + 1;
        expect(checkNumberingGaps(set)).toHaveLength(span - nums.length);
      })
    );
  });
});

// Verifies: ADR-0033
describe('parseDocIndexEntry', () => {
  test('extracts number, title, status, and date from a real ADR header', () => {
    const content = ['# 0001 — Mainnet contract upgrades stay manual and developer-local', '', '- **Status:** Accepted', '- **Date:** 2026-07-13'].join(
      '\n'
    );
    expect(parseDocIndexEntry('0001-mainnet-upgrades-stay-manual.md', content)).toEqual({
      number: '0001',
      file: '0001-mainnet-upgrades-stay-manual.md',
      title: 'Mainnet contract upgrades stay manual and developer-local',
      status: 'Accepted',
      date: '2026-07-13',
    });
  });

  test("falls back to 'unknown' for title/status/date when absent", () => {
    expect(parseDocIndexEntry('0001-x.md', 'no header fields here')).toEqual({
      number: '0001',
      file: '0001-x.md',
      title: 'unknown',
      status: 'unknown',
      date: 'unknown',
    });
  });
});

describe('renderDocIndexYaml / renderDocIndexList', () => {
  const entries = [
    { number: '0002', file: '0002-b.md', title: 'Second decision', status: 'Accepted', date: '2026-07-02' },
    { number: '0001', file: '0001-a.md', title: 'First: a title, with punctuation', status: 'Superseded', date: '2026-07-01' },
  ];

  test('YAML output is sorted by number and quotes titles needing it', () => {
    const yaml = renderDocIndexYaml(entries, ADR_INDEX_YAML_OPTIONS);
    expect(yaml.indexOf('number: "0001"')).toBeLessThan(yaml.indexOf('number: "0002"'));
    expect(yaml).toContain('title: "First: a title, with punctuation"');
    expect(yaml).toContain('title: Second decision');
  });

  test('list output is sorted by number with a real markdown link per entry', () => {
    const list = renderDocIndexList(entries);
    const lines = list.split('\n');
    expect(lines[0]).toBe('- [0001 — First: a title, with punctuation](0001-a.md)');
    expect(lines[1]).toBe('- [0002 — Second decision](0002-b.md)');
  });
});

describe('checkDocIndexFreshness', () => {
  const entries = [{ number: '0001', file: '0001-a.md', title: 'A decision', status: 'Accepted', date: '2026-07-01' }];
  const freshYaml = renderDocIndexYaml(entries, ADR_INDEX_YAML_OPTIONS);
  const freshReadme = `intro\n<!-- ADR-INDEX:START -->\n${renderDocIndexList(entries)}\n<!-- ADR-INDEX:END -->\noutro`;

  test('no issues when both index.yaml and the README list are current', () => {
    expect(checkDocIndexFreshness(entries, freshYaml, freshReadme, ADR_INDEX_FRESHNESS_OPTIONS)).toEqual([]);
  });

  test('missing index.yaml is a blocking error', () => {
    const issues = checkDocIndexFreshness(entries, null, freshReadme, ADR_INDEX_FRESHNESS_OPTIONS);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ type: 'ERROR', file: 'docs/adr/index.yaml' });
  });

  test('negative space: a stale index.yaml (real content changed since) is a blocking error', () => {
    const staleYaml = renderDocIndexYaml([{ ...entries[0], status: 'Superseded' }], ADR_INDEX_YAML_OPTIONS);
    const issues = checkDocIndexFreshness(entries, staleYaml, freshReadme, ADR_INDEX_FRESHNESS_OPTIONS);
    expect(issues.some((i) => i.file === 'docs/adr/index.yaml')).toBe(true);
  });

  test('README missing the ADR-INDEX markers entirely is a blocking error', () => {
    const issues = checkDocIndexFreshness(entries, freshYaml, 'no markers here', ADR_INDEX_FRESHNESS_OPTIONS);
    expect(issues.some((i) => i.file === 'docs/adr/README.md' && i.message.includes('markers'))).toBe(true);
  });

  test('negative space: a stale README list is a blocking error', () => {
    const staleReadme = `intro\n<!-- ADR-INDEX:START -->\n<!-- ADR-INDEX:END -->\noutro`;
    const issues = checkDocIndexFreshness(entries, freshYaml, staleReadme, ADR_INDEX_FRESHNESS_OPTIONS);
    expect(issues.some((i) => i.file === 'docs/adr/README.md')).toBe(true);
  });

  test('null README content is a blocking error, matching the null-index.yaml case', () => {
    const issues = checkDocIndexFreshness(entries, freshYaml, null, ADR_INDEX_FRESHNESS_OPTIONS);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ type: 'ERROR', file: 'docs/adr/README.md' });
  });
});

describe('checkProposedAdrImplementation', () => {
  function withSourceFile(relativePath: string, contents: string) {
    const root = mkdtempSync(join(tmpdir(), 'adr-implements-fixture-'));
    const full = join(root, relativePath);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, contents);
    return { cleanup: () => rmSync(root, { recursive: true, force: true }), root };
  }

  const SOURCE = `${COVERAGE_PATHS[1]}lib/thing.ts`;

  test('blocks a non-Accepted ADR listed second on a comma back-pointer line', () => {
    // ADR-0006 is Accepted and ADR-0040 is Proposed; the gate must report ADR-0040
    // even though it is listed second on the marker line.
    const { cleanup, root } = withSourceFile(SOURCE, '// Implements: ADR-0006, ADR-0040\nexport const a = 1;');
    try {
      const issues = checkProposedAdrImplementation(
        [SOURCE],
        root,
        new Map([['0006', 'Accepted'], ['0040', 'Proposed']])
      );
      expect(issues).toHaveLength(1);
      expect(issues[0].message).toContain('ADR-0040');
    } finally {
      cleanup();
    }
  });

  test('blocks source implementing a Proposed ADR', () => {
    const { cleanup, root } = withSourceFile(SOURCE, '// Implements: ADR-0040\nexport const a = 1;');
    try {
      const issues = checkProposedAdrImplementation(
        [SOURCE],
        root,
        new Map([['0040', 'Proposed']])
      );
      expect(issues).toHaveLength(1);
      expect(issues[0].type).toBe('ERROR');
      expect(issues[0].message).toContain('ADR-0040');
    } finally {
      cleanup();
    }
  });

  test('allows source implementing an Accepted ADR', () => {
    const { cleanup, root } = withSourceFile(SOURCE, '// Implements: ADR-0040\nexport const a = 1;');
    try {
      expect(
        checkProposedAdrImplementation([SOURCE], root, new Map([['0040', 'Accepted']]))
      ).toEqual([]);
    } finally {
      cleanup();
    }
  });

  test('allows a Proposed ADR added on its own, with no implementing source', () => {
    expect(
      checkProposedAdrImplementation(
        ['docs/adr/0099-a-proposal.md'],
        '/nonexistent',
        new Map([['0099', 'Proposed']])
      )
    ).toEqual([]);
  });

  test('ignores tests that merely verify a Proposed ADR', () => {
    const testPath = `${COVERAGE_PATHS[1]}lib/thing.test.ts`;
    const { cleanup, root } = withSourceFile(testPath, '// Verifies: ADR-0040');
    try {
      expect(
        checkProposedAdrImplementation([testPath], root, new Map([['0040', 'Proposed']]))
      ).toEqual([]);
    } finally {
      cleanup();
    }
  });

  test('rethrows a read failure that is not a missing file, so nothing bypasses the gate', () => {
    const root = mkdtempSync(join(tmpdir(), 'adr-implements-fixture-'));
    const asDirectory = `${COVERAGE_PATHS[1]}lib/thing.ts`;
    mkdirSync(join(root, asDirectory), { recursive: true });
    try {
      expect(() =>
        checkProposedAdrImplementation([asDirectory], root, new Map([['0040', 'Proposed']]))
      ).toThrow();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('ignores a file deleted in the same diff', () => {
    expect(
      checkProposedAdrImplementation([SOURCE], '/nonexistent', new Map([['0040', 'Proposed']]))
    ).toEqual([]);
  });

  test('reports each Proposed ADR a file claims, once', () => {
    const { cleanup, root } = withSourceFile(
      SOURCE,
      '// Implements: ADR-0040 // adr-scan:ignore-line\n// Implements: ADR-0040 // adr-scan:ignore-line\n// Implements: ADR-0041 // adr-scan:ignore-line\n'
    );
    try {
      const issues = checkProposedAdrImplementation(
        [SOURCE],
        root,
        new Map([
          ['0040', 'Proposed'],
          ['0041', 'Proposed'],
        ])
      );
      expect(issues).toHaveLength(2);
    } finally {
      cleanup();
    }
  });

  test('blocks any non-Accepted status, not only Proposed', () => {
    for (const status of ['Draft', 'Superseded', 'Deprecated', 'Withdrawn']) {
      const { cleanup, root } = withSourceFile(SOURCE, '// Implements: ADR-0040\n');
      try {
        const issues = checkProposedAdrImplementation([SOURCE], root, new Map([['0040', status]]));
        expect(issues).toHaveLength(1);
        expect(issues[0].message).toContain('ADR-0040');
      } finally {
        cleanup();
      }
    }
  });

  test('a retired (Superseded/Deprecated) ADR gets a repoint message, not an accept-it message', () => {
    const { cleanup, root } = withSourceFile(SOURCE, '// Implements: ADR-0040\n');
    try {
      const [issue] = checkProposedAdrImplementation([SOURCE], root, new Map([['0040', 'Superseded']]));
      expect(issue.message).toContain('repoint');
      expect(issue.message).not.toContain('must accept');
    } finally {
      cleanup();
    }
  });

  test('skips an ADR whose status is unknown (a dangling ref is a different check)', () => {
    const { cleanup, root } = withSourceFile(SOURCE, '// Implements: ADR-0777\n');
    try {
      expect(checkProposedAdrImplementation([SOURCE], root, new Map())).toEqual([]);
    } finally {
      cleanup();
    }
  });
});

describe('coerceScope', () => {
  test('accepts the two valid scopes verbatim', () => {
    expect(coerceScope('diff')).toBe('diff');
    expect(coerceScope('whole-corpus')).toBe('whole-corpus');
  });

  test('returns null for anything else, so the caller falls through to its default', () => {
    for (const bad of ['', 'DIFF', 'all', 'wholecorpus', undefined, null]) {
      expect(coerceScope(bad)).toBeNull();
    }
  });
});

describe('coerceAllowAuthorSelfReview', () => {
  test('defaults to false when neither env nor config supplies a value', () => {
    expect(coerceAllowAuthorSelfReview(undefined, undefined)).toBe(false);
    expect(coerceAllowAuthorSelfReview(null, null)).toBe(false);
  });

  test('honors the config-file boolean when no env is set', () => {
    expect(coerceAllowAuthorSelfReview(true, undefined)).toBe(true);
    expect(coerceAllowAuthorSelfReview(false, undefined)).toBe(false);
  });

  test('ignores a non-boolean config value and falls back to the default', () => {
    expect(coerceAllowAuthorSelfReview('true', undefined)).toBe(false);
    expect(coerceAllowAuthorSelfReview(1, undefined)).toBe(false);
  });

  test('lets the env var win over the config file (highest precedence)', () => {
    expect(coerceAllowAuthorSelfReview(false, '1')).toBe(true);
    expect(coerceAllowAuthorSelfReview(false, 'true')).toBe(true);
    expect(coerceAllowAuthorSelfReview(true, 'false')).toBe(false);
    expect(coerceAllowAuthorSelfReview(true, '0')).toBe(false);
  });
});

describe('checkCoverage', () => {
  test('empty changedFiles produces no warning', () => {
    expect(checkCoverage([])).toEqual([]);
  });

  test('a docs/adr/ change present suppresses the warning regardless of other paths', () => {
    expect(checkCoverage(['docs/adr/0001-x.md', `${COVERAGE_PATHS[0]}foo.ts`])).toEqual([]);
  });

  test('a covered path changing without any docs/adr/ change is a warning', () => {
    const issues = checkCoverage([`${COVERAGE_PATHS[0]}foo.ts`]);
    expect(issues).toHaveLength(1);
    expect(issues[0].type).toBe('WARN');
  });

  test('an uncovered path changing without any docs/adr/ change produces no warning', () => {
    expect(checkCoverage(['some/unrelated/path.ts'])).toEqual([]);
  });

  test('property: warns iff (no docs/adr/ path present) and (some path matches a covered prefix)', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.oneof(
            fc.constantFrom(...COVERAGE_PATHS).map((p) => `${p}fixture.ts`),
            fc.constant('docs/adr/fixture.md'),
            fc.constant('unrelated/fixture.ts')
          ),
          { maxLength: 10 }
        ),
        (changedFiles) => {
          const hasAdrChange = changedFiles.some((f) => f.startsWith('docs/adr/'));
          const hasCoveredPath = changedFiles.some((f) => COVERAGE_PATHS.some((p) => f.startsWith(p)));
          const issues = checkCoverage(changedFiles);
          expect(issues.length > 0).toBe(!hasAdrChange && hasCoveredPath);
        }
      )
    );
  });
});

describe('checkScopeMismatch', () => {
  test('empty changedFiles produces no warning', () => {
    expect(checkScopeMismatch([])).toEqual([]);
  });

  test('governance-only diff (no non-governance path) produces no warning', () => {
    expect(checkScopeMismatch(['docs/adr/0001-x.md', 'docs/rfc/0002-y.md', 'packages/adr/lib.ts'])).toEqual([]);
  });

  test('application-only diff (no governance path) produces no warning', () => {
    expect(checkScopeMismatch(['apps/backend/src/foo.ts', 'apps/web/components/bar.tsx'])).toEqual([]);
  });

  test('a governance-path change bundled with non-test application source is a warning', () => {
    const issues = checkScopeMismatch(['docs/adr/0001-x.md', 'apps/backend/src/foo.ts']);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ type: 'WARN', file: 'apps/backend/src/foo.ts' });
  });

  test('a governance-path change bundled only with test files is not a warning', () => {
    expect(checkScopeMismatch(['docs/adr/0001-x.md', 'apps/backend/src/foo.test.ts', 'apps/web/bar.spec.tsx'])).toEqual([]);
  });

  test('this package’s own tooling under packages/adr/ counts as governance, not application source', () => {
    expect(checkScopeMismatch(['docs/rfc/0001-x.md', 'packages/adr/scope-check.ts'])).toEqual([]);
  });

  test('property: warns iff (some path is governance) and (some non-test path is not governance)', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.oneof(
            fc.constantFrom(...GOVERNANCE_PATHS).map((p) => `${p}fixture.ts`),
            fc.constant('apps/backend/src/fixture.ts'),
            fc.constant('apps/backend/src/fixture.test.ts')
          ),
          { maxLength: 10 }
        ),
        (changedFiles) => {
          const hasGovernance = changedFiles.some((f) => GOVERNANCE_PATHS.some((p) => f.startsWith(p)));
          const hasNonGovernanceSource = changedFiles.some(
            (f) => !GOVERNANCE_PATHS.some((p) => f.startsWith(p)) && !/\.(test|spec)\.tsx?$/.test(f)
          );
          const issues = checkScopeMismatch(changedFiles);
          expect(issues.length > 0).toBe(hasGovernance && hasNonGovernanceSource);
        }
      )
    );
  });
});

describe('extractReferencesSection', () => {
  test('extracts the content between "## References" and the next "## " heading', () => {
    const content = '# Title\n\n## Summary\nBody.\n\n## References\n- foo\n- bar\n\n## Non-goals\nMore.';
    expect(extractReferencesSection(content)?.trim()).toBe('- foo\n- bar');
  });

  test('extracts to end of document when References is the last section', () => {
    const content = '# Title\n\n## References\n- foo\n';
    expect(extractReferencesSection(content)?.trim()).toBe('- foo');
  });

  test('returns null when no References section exists', () => {
    expect(extractReferencesSection('# Title\n\n## Summary\nBody.')).toBeNull();
  });
});

describe('extractCitedFilePaths', () => {
  test('extracts backtick-quoted repo-relative paths', () => {
    expect(extractCitedFilePaths('- Spec: `docs/specs/foo.md`\n- Code: `apps/web/lib/bar.ts`')).toEqual([
      'docs/specs/foo.md',
      'apps/web/lib/bar.ts',
    ]);
  });

  test('does not match a bare word, a URL without a path-like shape, or a backtick-quoted symbol with no slash', () => {
    expect(extractCitedFilePaths('- See `foo` and `bar()` — https://example.com/x')).toEqual([]);
  });

  test('deduplicates repeated citations', () => {
    expect(extractCitedFilePaths('`docs/adr/0001-x.md` and again `docs/adr/0001-x.md`')).toEqual(['docs/adr/0001-x.md']);
  });
});

describe('extractCitedGithubNumbers', () => {
  test('matches "#123" shorthand', () => {
    expect(extractCitedGithubNumbers('- PR: #369 fixed this')).toEqual(['369']);
  });

  test('matches a full pull request URL', () => {
    expect(extractCitedGithubNumbers('- https://github.com/org/repo/pull/42')).toEqual(['42']);
  });

  test('does not match an ADR-NNNN reference', () => {
    expect(extractCitedGithubNumbers('- Related: ADR-0027')).toEqual([]);
  });

  test('deduplicates repeated citations', () => {
    expect(extractCitedGithubNumbers('#42 ... also #42')).toEqual(['42']);
  });
});

describe('pathIsInsideRoot', () => {
  const root = join(tmpdir(), 'repo-root');

  test('accepts a plain in-repo relative path', () => {
    expect(pathIsInsideRoot(root, 'docs/adr/0001-x.md')).toBe(true);
    expect(pathIsInsideRoot(root, 'apps/backend/src/scripts/smoke-identity.ts')).toBe(true);
  });

  test('rejects a path that escapes the repo via ..', () => {
    expect(pathIsInsideRoot(root, '../../../etc/passwd')).toBe(false);
    expect(pathIsInsideRoot(root, '../sibling/file.ts')).toBe(false);
  });

  test('rejects an absolute path outside the repo', () => {
    expect(pathIsInsideRoot(root, '/etc/hosts')).toBe(false);
  });

  test('rejects a sibling dir that merely shares the root name prefix', () => {
    // `<root>-evil` startsWith `<root>` but is NOT inside `<root>/`; the sep
    // guard is what stops this from being a false positive.
    expect(pathIsInsideRoot(root, `../${root.split('/').pop()}-evil/x.ts`)).toBe(false);
  });

});

describe('pathIsInsideRootReal (symlink-aware, real filesystem)', () => {
  test('resolves symlinks: a path lexically inside root but symlinked out is rejected', () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'adr-root-')));
    const outside = realpathSync(mkdtempSync(join(tmpdir(), 'adr-out-')));
    try {
      mkdirSync(join(root, 'docs'));
      writeFileSync(join(root, 'docs', 'real.md'), 'x');
      writeFileSync(join(outside, 'secret.txt'), 'x');
      symlinkSync(outside, join(root, 'escape')); // symlink inside root -> external dir
      const rp = (p: string): string => realpathSync(p);

      // a genuine in-repo file: present and contained -> true
      expect(pathIsInsideRootReal(root, 'docs/real.md', rp)).toBe(true);
      // a path *through* the escaping symlink: lexically inside, really outside -> false
      expect(pathIsInsideRootReal(root, 'escape/secret.txt', rp)).toBe(false);
      // a non-existent path: realpath throws -> false (this call also *is* the existence check)
      expect(pathIsInsideRootReal(root, 'docs/nope.md', rp)).toBe(false);
      // a lexical `..` escape: rejected before realpath is ever consulted
      expect(pathIsInsideRootReal(root, '../../../etc/passwd', rp)).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });
});

describe('resolveTrackedSourceFiles (real git repo)', () => {
  test('preserves a tracked non-ASCII filename under a coverage path', () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'adr-git-')));
    try {
      execFileSync('git', ['init', '-q'], { cwd: root });
      execFileSync('git', ['config', 'user.email', 't@example.com'], { cwd: root });
      execFileSync('git', ['config', 'user.name', 't'], { cwd: root });
      mkdirSync(join(root, 'apps', 'backend', 'src'), { recursive: true });
      const unicode = 'apps/backend/src/日本語.ts'; // git would quote this without -z
      writeFileSync(join(root, unicode), 'x');
      writeFileSync(join(root, 'apps/backend/src/plain.ts'), 'x');
      execFileSync('git', ['add', '-A'], { cwd: root });

      const tracked = resolveTrackedSourceFiles(root);
      expect(tracked).toContain(unicode);
      expect(tracked).toContain('apps/backend/src/plain.ts');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('resolveGitDiffChangedFiles (real git repo)', () => {
  test('preserves a non-ASCII changed filename in a diff', () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'adr-git-')));
    try {
      execFileSync('git', ['init', '-q'], { cwd: root });
      execFileSync('git', ['config', 'user.email', 't@example.com'], { cwd: root });
      execFileSync('git', ['config', 'user.name', 't'], { cwd: root });
      execFileSync('git', ['commit', '-q', '--allow-empty', '-m', 'base'], { cwd: root });
      const base = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf-8' }).trim();
      const unicode = 'apps/backend/src/日本語.ts'; // git would quote this without -z
      mkdirSync(join(root, 'apps', 'backend', 'src'), { recursive: true });
      writeFileSync(join(root, unicode), 'x');
      execFileSync('git', ['add', '-A'], { cwd: root });
      execFileSync('git', ['commit', '-q', '-m', 'add unicode'], { cwd: root });

      expect(resolveGitDiffChangedFiles(root, base)).toContain(unicode);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('checkFilePathCitations', () => {
  test('no issues when every cited path exists per the injected exists()', () => {
    expect(checkFilePathCitations(['a.md', 'b.ts'], 'doc.md', () => true, 'the working tree')).toEqual([]);
  });

  test('a WARN per missing path, naming the stated scope', () => {
    const issues = checkFilePathCitations(['a.md'], 'doc.md', () => false, 'the working tree');
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ type: 'WARN', file: 'doc.md' });
    expect(issues[0].message).toContain('the working tree');
    expect(issues[0].message).toContain('a.md');
  });

  test('property: warns exactly for the paths exists() reports false for', () => {
    fc.assert(
      fc.property(fc.array(fc.string({ minLength: 1 }), { maxLength: 10 }), fc.array(fc.boolean(), { maxLength: 10 }), (paths, flags) => {
        const existsMap = new Map(paths.map((p, i) => [p, flags[i % Math.max(flags.length, 1)] ?? true]));
        const issues = checkFilePathCitations(paths, 'doc.md', (p) => existsMap.get(p) ?? true, 'scope');
        const expectedMissing = paths.filter((p) => !(existsMap.get(p) ?? true)).length;
        expect(issues.length).toBe(expectedMissing);
      })
    );
  });
});

describe('checkGithubNumberCitations', () => {
  test('no issues when every cited number resolves per the injected numberExists()', () => {
    expect(checkGithubNumberCitations(['1', '2'], 'doc.md', () => true)).toEqual([]);
  });

  test('a WARN per issue/PR number that does not resolve', () => {
    const issues = checkGithubNumberCitations(['999'], 'doc.md', () => false);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ type: 'WARN', file: 'doc.md' });
    expect(issues[0].message).toContain('#999');
  });
});

// ---------------------------------------------------------------------------
// Author / Reviewers / Deciders governance checks, against synthetic
// fixture ADRs so the real corpus is never mutated by a test run.
// ---------------------------------------------------------------------------

function makeAdr({
  num,
  status,
  author,
  reviewers,
  deciders,
  accepted,
}: {
  num: string;
  status: string;
  author?: string;
  reviewers?: string;
  deciders?: string;
  // Defaults to a valid date for acceptance-bearing statuses so every existing fixture stays
  // lint-clean; pass null to build a fixture that deliberately omits the field.
  accepted?: string | null;
}): string {
  return [
    `# ${num} — Fixture ADR`,
    '',
    '> **Decision (Y-statement):** In the context of a test fixture, facing the need for',
    '> deterministic lint coverage, we decided to synthesize a minimal ADR to achieve',
    '> isolation from the real corpus, accepting that it reads awkwardly.',
    '',
    `- **Status:** ${status}`,
    '- **Date:** 2026-07-28',
    ...(accepted === null
      ? []
      : ACCEPTANCE_BEARING_STATUSES.has(status)
        ? [`- **Accepted:** ${accepted ?? '2026-07-28'}`]
        : []),
    ...(author !== undefined ? [`- **Author:** ${author}`] : []),
    ...(reviewers !== undefined ? [`- **Reviewers:** ${reviewers}`] : []),
    ...(deciders !== undefined ? [`- **Deciders:** ${deciders}`] : []),
    '- **Supersedes / Superseded-by:** —',
    '',
    '## Context',
    '',
    'Fixture context.',
    '',
    '## Considered options',
    '',
    '| Option | Pros | Cons |',
    '|---|---|---|',
    '| Option A | ... | ... |',
    '| Option B (rejected) | ... | ... |',
    '',
    '## Decision',
    '',
    'Fixture decision.',
    '',
    '## Consequences',
    '',
    '**Positive:**',
    '- ...',
    '',
    '**Negative / trade-offs:**',
    '- ...',
    '',
    '**Neutral / follow-up:**',
    '- ...',
    '',
    '## References',
    '',
    '- none',
    '',
  ].join('\n');
}

// Auto-injects a valid index.yaml (and, when the fixture provides its own README.md without
// explicit ADR-INDEX markers, leaves it untouched) so the many fixtures here testing something
// else entirely -- Y-statement structure, Reviewers/Deciders, filename format -- don't also
// trip checkDocIndexFreshness's blocking checks. A fixture that wants to test index freshness
// itself passes its own 'index.yaml' key, which overrides this default.
function withFixtureDir<T>(fixtures: Record<string, string>, fn: (dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), 'adr-lint-fixture-'));
  try {
    const withDefaults = { ...fixtures };
    if (!('index.yaml' in withDefaults)) {
      // isDocDirMemberFile is the single source of truth lintAdrDir's own adrFiles filter uses
      // too -- not FILENAME_RE, which is stricter (strictly-numbered filenames only). A fixture
      // testing a malformed filename (e.g. checkFilenameFormat's own blocking check) would
      // otherwise be silently excluded from this auto-generated index, tripping an unrelated
      // index-freshness failure.
      const entries = Object.entries(fixtures)
        .filter(([name]) => isDocDirMemberFile(name))
        .map(([name, body]) => parseDocIndexEntry(name, body));
      withDefaults['index.yaml'] = renderDocIndexYaml(entries, ADR_INDEX_YAML_OPTIONS);
      // Same reasoning as the index.yaml default above: a fixture not testing README
      // freshness itself shouldn't trip the now-blocking null-README check just because it
      // never mentioned README.md.
      if (!('README.md' in withDefaults)) {
        withDefaults['README.md'] = `<!-- ADR-INDEX:START -->\n${renderDocIndexList(entries)}\n<!-- ADR-INDEX:END -->\n`;
      }
    }
    for (const [name, body] of Object.entries(withDefaults)) {
      writeFileSync(join(dir, name), body, 'utf8');
    }
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('lintAdrDir: Accepted + placeholder Deciders is a blocking error', () => {
  withFixtureDir(
    {
      '0900-fixture.md': makeAdr({
        num: '0900',
        status: 'Accepted',
        author: 'Alice',
        reviewers: 'Alice — self-attested; no independent reviewer recorded',
        deciders: '(pending human approval)',
      }),
    },
    (dir) => {
      const { issues } = lintAdrDir(dir);
      const errors = issues.filter((i) => i.type === 'ERROR');
      expect(errors.some((e) => /Deciders is blank or a placeholder/.test(e.message))).toBe(true);
    }
  );
});

test('lintAdrDir: Accepted + placeholder Reviewers is warn-only, not blocking', () => {
  withFixtureDir(
    {
      '0901-fixture.md': makeAdr({
        num: '0901',
        status: 'Accepted',
        author: 'Alice',
        reviewers: '(pending)',
        deciders: 'Bob',
      }),
    },
    (dir) => {
      const { issues } = lintAdrDir(dir);
      const errors = issues.filter((i) => i.type === 'ERROR');
      const warnings = issues.filter((i) => i.type === 'WARN');
      expect(errors.filter((e) => /Reviewers/.test(e.message))).toEqual([]);
      expect(warnings.some((w) => /Reviewers is blank or a placeholder/.test(w.message))).toBe(
        true
      );
    }
  );
});

test('lintAdrDir: self-ack smell warns (not errors) when Author and Deciders match', () => {
  withFixtureDir(
    {
      '0902-fixture.md': makeAdr({
        num: '0902',
        status: 'Accepted',
        author: 'Carol',
        reviewers: 'Dave',
        deciders: 'Carol',
      }),
    },
    (dir) => {
      const { issues } = lintAdrDir(dir);
      const errors = issues.filter((i) => i.type === 'ERROR');
      expect(errors).toEqual([]);
      const warnings = issues.filter((i) => i.type === 'WARN');
      expect(
        warnings.some((w) => /Author and Deciders name the same person \(Carol\)/.test(w.message))
      ).toBe(true);
    }
  );
});

test('lintAdrDir: Proposed status with placeholder Deciders is not a blocking error', () => {
  withFixtureDir(
    {
      '0903-fixture.md': makeAdr({
        num: '0903',
        status: 'Proposed',
        author: 'Erin',
        reviewers: 'Erin — self-attested; no independent reviewer recorded',
        deciders: '(pending human approval)',
      }),
    },
    (dir) => {
      const { issues } = lintAdrDir(dir);
      const errors = issues.filter((i) => i.type === 'ERROR');
      expect(errors).toEqual([]);
    }
  );
});

// ---------------------------------------------------------------------------
// Y-statement extraction failure
// ---------------------------------------------------------------------------

test('lintAdrDir: reports an extraction failure instead of scanning the whole document when the Y-statement marker has no recognizable block boundary', () => {
  // The block-extraction regex looks ahead for the FIRST `\n- **` metadata bullet or `\n##`
  // heading anywhere after the marker — so extraction only genuinely fails when NEITHER
  // appears anywhere later in the file, which this fixture deliberately has (no metadata
  // bullets, no headings at all). All five required phrases are present in the prose below
  // the marker as a distractor — if the check fell back to scanning the whole document on
  // extraction failure, it would wrongly pass a malformed/unterminated Y-statement instead
  // of reporting that the block couldn't be found.
  const content = [
    '> **Decision (Y-statement):** incomplete, no terminator follows',
    '',
    'In the context of unrelated prose, facing an unrelated concern, we decided to',
    'write this paragraph to achieve nothing in particular, accepting that it is a distractor.',
    '',
  ].join('\n');

  withFixtureDir({ '0904-fixture.md': content }, (dir) => {
    const { issues } = lintAdrDir(dir);
    const errors = issues.filter((i) => i.type === 'ERROR');
    expect(
      errors.some((e) => /could not extract \*\*Decision \(Y-statement\):\*\* TL;DR block/.test(e.message))
    ).toBe(true);
    // The whole-document fallback would have found all five required phrases in the
    // distractor prose and reported zero "missing expected phrase" errors — confirm none
    // of those fire, i.e. the check didn't silently validate against the wrong text.
    expect(errors.some((e) => /missing expected phrase/.test(e.message))).toBe(false);
  });
});

test('lintAdrDir: a "facing" keyword match must be a real word, not a substring of another word', () => {
  // Regression guard: Y_STATEMENT_KEYWORDS originally used a plain .includes() substring
  // search, so "interfacing" (or "surfacing", etc.) would satisfy the "facing" keyword even
  // though the Y-statement never actually contains that word on its own.
  const content = [
    '> **Decision (Y-statement):** In the context of an API redesign, interfacing with the',
    '> new schema, we decided to adopt it to achieve consistency, accepting the migration cost.',
    '',
    '## Context',
    '',
    'Fixture.',
    '',
  ].join('\n');

  withFixtureDir({ '0905-fixture.md': content }, (dir) => {
    const { issues } = lintAdrDir(dir);
    const errors = issues.filter((i) => i.type === 'ERROR');
    expect(errors.some((e) => /missing expected phrase "facing"/.test(e.message))).toBe(true);
  });
});

test('lintAdrDir: a real standalone "facing" keyword still passes (negative space)', () => {
  const content = [
    '> **Decision (Y-statement):** In the context of an API redesign, facing a schema change,',
    '> we decided to adopt it to achieve consistency, accepting the migration cost.',
    '',
    '## Context',
    '',
    'Fixture.',
    '',
  ].join('\n');

  withFixtureDir({ '0906-fixture.md': content }, (dir) => {
    const { issues } = lintAdrDir(dir);
    const errors = issues.filter((i) => i.type === 'ERROR');
    expect(errors.some((e) => /missing expected phrase "facing"/.test(e.message))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Considered-options section-extraction anchoring
// ---------------------------------------------------------------------------

test('lintAdrDir: a nested "### Considered options" recap must not be matched instead of the real ## section', () => {
  // Regression guard: the section-extraction regex originally matched the substring
  // "## Considered options" without anchoring to a real top-level heading, so it could
  // match inside a nested "### Considered options" recap (e.g. a Decision-section summary)
  // instead of the actual H2 section — validating the wrong content's row count.
  const content = [
    makeAdr({ num: '0907', status: 'Accepted', author: 'Alice', reviewers: 'Bob', deciders: 'Carol' }),
    '',
    '### Considered options',
    '',
    '| Option | Pros | Cons |',
    '|---|---|---|',
    '| Recap only | x | y |',
    '',
  ].join('\n');

  withFixtureDir({ '0907-fixture.md': content }, (dir) => {
    const { issues } = lintAdrDir(dir);
    const errors = issues.filter((i) => i.type === 'ERROR');
    // makeAdr's own "## Considered options" section already has 2 real rows (Option A, Option
    // B) — an un-anchored match on the nested 1-row recap would wrongly flag "fewer than 2
    // alternatives" here.
    expect(errors.some((e) => /fewer than 2 alternatives/.test(e.message))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Property-based tests (fast-check) — regex-heavy extraction/detection
// functions where hand-picked examples alone are too easy to fool.
// ---------------------------------------------------------------------------

const PENDING_PHRASES = ['pending', 'tbd', 'awaiting', 'none', 'unknown', 'n/a', 'na'];
const WRAPPERS = ['', '-', '–', '—', '(', '[', '_', '*', '  ', '— (', '_(', '**'];

describe('isPlaceholder (property)', () => {
  test('any pending phrase behind any wrapper is always a placeholder', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...PENDING_PHRASES),
        fc.constantFrom(...WRAPPERS),
        fc.constantFrom('', ')', '*', '_', ' — author cannot self-ack)'),
        (phrase, wrapper, suffix) => {
          expect(isPlaceholder(`${wrapper}${phrase}${suffix}`)).toBe(true);
        }
      )
    );
  });

  test('negative space: real partial content naming a person is never a placeholder', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('Cong', 'Gary', 'Beau', 'Alice', 'Priya'),
        fc.integer({ min: 1, max: 999 }),
        fc.constantFrom(...PENDING_PHRASES),
        (name, prNum, phrase) => {
          const value = `Original: ${name} (PR #${prNum} approval, 2026-07-27); later: ${phrase}`;
          expect(isPlaceholder(value)).toBe(false);
        }
      )
    );
  });
});

describe('stripCaveatClauses + extractAdrNumbers (property)', () => {
  test('caveat-mentioned ADRs never survive stripping, real targets always do', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.integer({ min: 1000, max: 9999 }), { minLength: 2, maxLength: 2 }),
        fc.uniqueArray(fc.integer({ min: 1000, max: 9999 }), { minLength: 2, maxLength: 2 }),
        // This schema has an independent Amends relation alongside
        // Supersedes, so the caveat clause must recognize both verbs.
        fc.constantFrom('superseded', 'supersedes', 'amended', 'amends'),
        fc.constantFrom('not ', ''),
        (real, caveat, verb, notPrefix) => {
          fc.pre(real.every((r) => !caveat.includes(r)));
          const text =
            `ADR-${real[0]} and ADR-${real[1]} ` +
            `(${notPrefix}already ${verb} by ADR-${caveat[0]} and ADR-${caveat[1]})`;
          const stripped = stripCaveatClauses(text);
          const refs = extractAdrNumbers(stripped);
          expect(refs).toEqual([String(real[0]), String(real[1])]);
        }
      )
    );
  });

  test('negative space: with no caveat clause, every real reference survives untouched', () => {
    fc.assert(
      fc.property(fc.uniqueArray(fc.integer({ min: 1000, max: 9999 }), { minLength: 1, maxLength: 4 }), (nums) => {
        const text = nums.map((n) => `ADR-${n}`).join(', ');
        const stripped = stripCaveatClauses(text);
        const refs = extractAdrNumbers(stripped);
        expect(refs).toEqual(nums.map(String));
      })
    );
  });
});

// ---------------------------------------------------------------------------
// CLI output format snapshot — CI's ::error::/::warning:: annotation parsing
// depends on this staying stable, and nothing else guards it.
// ---------------------------------------------------------------------------

describe('CLI output format', () => {
  test('plain issue line format', () => {
    expect(formatIssueLine({ type: 'ERROR', file: '0100-fixture.md', message: 'bad ref' })).toBe(
      '  ERROR  0100-fixture.md: bad ref'
    );
    expect(formatIssueLine({ type: 'WARN', file: '', message: 'gap at 0050' })).toBe('  WARN   : gap at 0050');
  });

  test('github actions annotation format, including escaping', () => {
    expect(
      formatGithubAnnotation({ type: 'ERROR', file: '0100-fixture.md', message: 'bad ref' }, 'docs/adr/0100-fixture.md')
    ).toBe('::error file=docs/adr/0100-fixture.md::bad ref');
    // The message ("data") only gets %/\r/\n escaped per GitHub's rules — unlike the file
    // ("property"), ':' and ',' are left as-is in data position.
    expect(
      formatGithubAnnotation({ type: 'WARN', file: '0100-fixture.md', message: 'a:b,c\nd' }, 'docs/adr/0100-fixture.md')
    ).toBe('::warning file=docs/adr/0100-fixture.md::a:b,c%0Ad');
  });

  test('github actions annotation format falls back to no file= property for a non-file sentinel', () => {
    expect(formatGithubAnnotation({ type: 'WARN', file: '(numbering)', message: 'gap' }, '')).toBe('::warning::gap');
  });
});

describe('normalizeIssueFilePath', () => {
  test('prefixes a bare filename with the given directory', () => {
    expect(normalizeIssueFilePath('0100-fixture.md', 'docs/adr')).toBe('docs/adr/0100-fixture.md');
  });

  test('leaves an already repo-relative path untouched', () => {
    expect(normalizeIssueFilePath('docs/specs/foo.md', 'docs/adr')).toBe('docs/specs/foo.md');
  });

  test('returns empty for a non-file sentinel like "(numbering)"', () => {
    expect(normalizeIssueFilePath('(numbering)', 'docs/adr')).toBe('');
  });
});

// Verifies: ADR-0032
describe('Embodiment audit', () => {
  function entry(partial: Partial<AdrAuditEntry> & Pick<AdrAuditEntry, 'number'>): AdrAuditEntry {
    return { status: 'Accepted', statedEmbodiment: 'Not started', specRefs: [], codeRefs: [], testRefs: [], ...partial };
  }

  describe('statedEmbodimentClean', () => {
    test('strips a trailing [unaudited] annotation', () => {
      expect(statedEmbodimentClean('Not started `[unaudited]`')).toBe('Not started');
    });

    test('negative space: a value with no annotation is returned unchanged', () => {
      expect(statedEmbodimentClean('Implemented')).toBe('Implemented');
    });
  });

  describe('computeEmbodiment', () => {
    test('computes Not started when nothing references the ADR', () => {
      expect(computeEmbodiment(entry({ number: '0001' }))).toBe('Not started');
    });

    test('computes Specified when only a spec references it', () => {
      expect(computeEmbodiment(entry({ number: '0001', specRefs: ['docs/specs/x.md'] }))).toBe('Specified');
    });

    test('computes Implemented when code references it, even with no spec ref', () => {
      expect(computeEmbodiment(entry({ number: '0001', codeRefs: ['packages/adr/adr-audit.ts'] }))).toBe('Implemented');
    });

    test('computes Verified when a test references it, even with no code ref', () => {
      expect(computeEmbodiment(entry({ number: '0001', testRefs: ['packages/adr/lib.test.ts'] }))).toBe('Verified');
    });

    test('prefers Verified over Implemented over Specified when multiple ref types are present', () => {
      expect(
        computeEmbodiment(entry({ number: '0001', specRefs: ['a.md'], codeRefs: ['b.ts'], testRefs: ['c.test.ts'] }))
      ).toBe('Verified');
    });

    test('computes Inactive when the stated value says Inactive, regardless of refs', () => {
      expect(computeEmbodiment(entry({ number: '0001', statedEmbodiment: 'Inactive', codeRefs: ['b.ts'] }))).toBe('Inactive');
    });

    test('computes Deprecated when the stated value says Deprecated, regardless of refs', () => {
      // Distinct from Inactive: a Deprecated ADR was genuinely realized once (real back-pointers
      // may still transiently exist elsewhere before cleanup), but its realizing code is gone by
      // design and can never resolve a back-pointer again -- Inactive never had one to begin with.
      expect(computeEmbodiment(entry({ number: '0001', statedEmbodiment: 'Deprecated' }))).toBe('Deprecated');
      expect(computeEmbodiment(entry({ number: '0001', statedEmbodiment: 'Deprecated', codeRefs: ['b.ts'] }))).toBe('Deprecated');
    });
  });

  describe('computeDrift', () => {
    test('returns null when stated matches computed', () => {
      expect(computeDrift(entry({ number: '0001', statedEmbodiment: 'Implemented', codeRefs: ['b.ts'] }))).toBeNull();
    });

    test('negative space: returns a descriptive string when stated and computed disagree', () => {
      const drift = computeDrift(entry({ number: '0001', statedEmbodiment: 'Implemented' }));
      expect(drift).toContain("stated='Implemented'");
      expect(drift).toContain("computed='Not started'");
    });
  });

  describe('buildAuditSummary', () => {
    test('sorts entries by ADR number and maps ref arrays to counts', () => {
      const summary = buildAuditSummary(
        [
          entry({ number: '0010', statedEmbodiment: 'Not started' }),
          entry({ number: '0002', statedEmbodiment: 'Implemented', codeRefs: ['a.ts', 'b.ts'] }),
        ],
        '2026-07-28'
      );
      expect(summary.generated).toBe('2026-07-28');
      expect(summary.adrs.map((a) => a.number)).toEqual(['0002', '0010']);
      expect(summary.adrs[0].codeRefs).toBe(2);
      expect(summary.adrs[0].drift).toBeNull();
      expect(summary.adrs[1].drift).toBeNull(); // Not started stated, Not started computed
    });

    test('negative space: a clean corpus (no drift anywhere) reports drift: null for every entry', () => {
      const summary = buildAuditSummary([entry({ number: '0001', statedEmbodiment: 'Not started' })], '2026-07-28');
      expect(summary.adrs.every((a) => a.drift === null)).toBe(true);
    });
  });
});

describe('parseRealizedByLocators', () => {
  test('splits a comma-separated locator list, trimming whitespace, with no hash', () => {
    expect(parseRealizedByLocators('packages/contracts/src/facets/CoreFacet.sol, .github/workflows/deploy-testnet.yml')).toEqual([
      { path: 'packages/contracts/src/facets/CoreFacet.sol', hash: null },
      { path: '.github/workflows/deploy-testnet.yml', hash: null },
    ]);
  });

  test('parses an optional @hash suffix per locator', () => {
    expect(parseRealizedByLocators('a.sol@a1b2c3, b.yml')).toEqual([
      { path: 'a.sol', hash: 'a1b2c3' },
      { path: 'b.yml', hash: null },
    ]);
  });

  test('negative space: the empty-field placeholder means no locators, not one literal placeholder locator', () => {
    expect(parseRealizedByLocators('—')).toEqual([]);
  });

  test('negative space: null and blank input both mean no locators', () => {
    expect(parseRealizedByLocators(null)).toEqual([]);
    expect(parseRealizedByLocators('   ')).toEqual([]);
  });

  test('drops empty segments from a trailing/doubled comma', () => {
    expect(parseRealizedByLocators('a.sol, , b.yml')).toEqual([
      { path: 'a.sol', hash: null },
      { path: 'b.yml', hash: null },
    ]);
  });
});

describe('formatRealizedByLocators', () => {
  test('round-trips through parseRealizedByLocators', () => {
    const raw = 'a.sol@a1b2c3, b.yml';
    expect(formatRealizedByLocators(parseRealizedByLocators(raw))).toBe(raw);
  });
});

describe('checkRealizedByLocator', () => {
  test('a missing file is never fresh, even with no hash recorded', () => {
    const result = checkRealizedByLocator({ path: 'gone.ts', hash: null }, null, 0);
    expect(result).toEqual({ path: 'gone.ts', fresh: false, hashChanged: false });
  });

  test('no hash recorded means existence alone is enough — pre-hash behavior unchanged', () => {
    const result = checkRealizedByLocator({ path: 'x.ts', hash: null }, 'anything', 0);
    expect(result).toEqual({ path: 'x.ts', fresh: true, hashChanged: false });
  });

  test('matching hash is fresh with no staleness flag', () => {
    const result = checkRealizedByLocator({ path: 'x.ts', hash: 'abc123' }, 'abc123', 0);
    expect(result).toEqual({ path: 'x.ts', fresh: true, hashChanged: false });
  });

  test('hash mismatch within the grace period is still fresh, but flagged as changed', () => {
    const result = checkRealizedByLocator({ path: 'x.ts', hash: 'abc123' }, 'def456', 10, 28);
    expect(result).toEqual({ path: 'x.ts', fresh: true, hashChanged: true });
  });

  test('negative space: hash mismatch past the grace period is no longer fresh', () => {
    const result = checkRealizedByLocator({ path: 'x.ts', hash: 'abc123' }, 'def456', 29, 28);
    expect(result).toEqual({ path: 'x.ts', fresh: false, hashChanged: true });
  });

  test('boundary: exactly at the grace-day limit still counts as fresh', () => {
    const result = checkRealizedByLocator({ path: 'x.ts', hash: 'abc123' }, 'def456', 28, 28);
    expect(result.fresh).toBe(true);
  });
});

describe('resolveRealizedByRefs', () => {
  test('returns every locator when all exist (AND semantics satisfied)', () => {
    const getHash = (l: string) => (l === 'a.sol' || l === 'b.yml' ? 'h' : null);
    const result = resolveRealizedByRefs(
      [
        { path: 'a.sol', hash: null },
        { path: 'b.yml', hash: null },
      ],
      getHash,
      0
    );
    expect(result.refs).toEqual(['a.sol', 'b.yml']);
    expect(result.staleWarnings).toEqual([]);
  });

  test('negative space: if even one required locator is missing, none count as evidence', () => {
    const getHash = (l: string) => (l === 'present.sol' ? 'h' : null); // 'missing.sol' is not
    const result = resolveRealizedByRefs(
      [
        { path: 'present.sol', hash: null },
        { path: 'missing.sol', hash: null },
      ],
      getHash,
      0
    );
    expect(result.refs).toEqual([]);
  });

  test('negative space: an empty locator list resolves to no refs without calling the checker', () => {
    let called = false;
    const result = resolveRealizedByRefs([], () => ((called = true), 'h'), 0);
    expect(result.refs).toEqual([]);
    expect(called).toBe(false);
  });

  test('a hash mismatch still in grace counts as evidence but surfaces a stale warning', () => {
    const getHash = () => 'changed-hash';
    const result = resolveRealizedByRefs([{ path: 'x.ts', hash: 'original-hash' }], getHash, 5, 28);
    expect(result.refs).toEqual(['x.ts']);
    expect(result.staleWarnings).toEqual(['x.ts']);
  });

  test('negative space: a hash mismatch past grace drops out of evidence entirely, no warning needed', () => {
    const getHash = () => 'changed-hash';
    const result = resolveRealizedByRefs([{ path: 'x.ts', hash: 'original-hash' }], getHash, 40, 28);
    expect(result.refs).toEqual([]);
    expect(result.staleWarnings).toEqual([]);
  });
});

describe('stripIgnoredLines', () => {
  test('blanks a line carrying the marker, leaves other lines untouched', () => {
    const content = 'keep this\nremove this // adr-scan:ignore-line\nkeep this too';
    expect(stripIgnoredLines(content)).toBe('keep this\n\nkeep this too');
  });

  test('negative space: content with no marker is returned unchanged', () => {
    const content = 'line one\nline two';
    expect(stripIgnoredLines(content)).toBe(content);
  });

  test('blanks every marked line when there is more than one', () => {
    const content = 'a // adr-scan:ignore-line\nb\nc // adr-scan:ignore-line';
    expect(stripIgnoredLines(content)).toBe('\nb\n');
  });
});

describe('globToRegExp / matchesAnyGlob', () => {
  test('"**" matches any chars including "/"', () => {
    expect(matchesAnyGlob('packages/contracts/src/facets/CoreFacet.sol', ['packages/contracts/**'])).toBe(true);
  });

  test('negative space: "**" prefix requires the literal prefix segment to match', () => {
    expect(matchesAnyGlob('packages/shared/src/index.ts', ['packages/contracts/**'])).toBe(false);
  });

  test('"*" matches any chars except "/", for an extension pattern', () => {
    expect(matchesAnyGlob('.github/workflows/deploy-testnet.yml', ['**/*.yml'])).toBe(true);
    expect(matchesAnyGlob('.github/workflows/deploy-testnet.yaml', ['**/*.yml'])).toBe(false);
  });

  test('matches against any glob in the list, not just the first', () => {
    expect(matchesAnyGlob('a.yaml', ['**/*.yml', '**/*.yaml'])).toBe(true);
  });

  test('negative space: an empty glob list never matches', () => {
    expect(matchesAnyGlob('anything.ts', [])).toBe(false);
  });

  test('regex special characters in a literal segment are escaped, not interpreted', () => {
    // A literal '.' must only match '.', not "any character" — 'packages/contracts/foo.sol'
    // should not falsely match a pattern meant only for a literal dot.
    expect(globToRegExp('a.b').test('aXb')).toBe(false);
    expect(globToRegExp('a.b').test('a.b')).toBe(true);
  });
});

describe('findImplementsRefs / findVerifiesRefs (multi-ADR marker lines)', () => {
  test('credits a single ADR', () => {
    expect(findImplementsRefs('// Implements: ADR-0045')).toEqual(['0045']); // adr-scan:ignore-line
  });
  test('credits every ADR in a comma list, not just the first', () => {
    expect(findImplementsRefs('// Implements: ADR-0045, ADR-0050')).toEqual(['0045', '0050']); // adr-scan:ignore-line
  });
  test('credits an annotated comma list', () => {
    expect(findImplementsRefs('// Implements: ADR-0045 (Task Awards), ADR-0050')).toEqual(['0045', '0050']); // adr-scan:ignore-line
  });
  test('preserves reference order and keeps duplicates', () => {
    expect(findImplementsRefs('// Implements: ADR-0050, ADR-0045, ADR-0050')).toEqual(['0050', '0045', '0050']); // adr-scan:ignore-line
  });
  test('matches only a complete four-digit reference, not a longer run of digits', () => {
    expect(findImplementsRefs('// Implements: ADR-00450')).toEqual([]); // adr-scan:ignore-line
  });
  test('ignores a bare ADR ref with no marker on the line', () => {
    expect(findImplementsRefs('// see ADR-0050 for context')).toEqual([]);
  });
  test('scopes a marker to its own line — the list never absorbs the next line', () => {
    expect(findImplementsRefs('// Implements: ADR-0045\n// ADR-0050 note')).toEqual(['0045']); // adr-scan:ignore-line
  });
  test('Verifies: behaves the same', () => {
    expect(findVerifiesRefs('// Verifies: ADR-0045, ADR-0050')).toEqual(['0045', '0050']); // adr-scan:ignore-line
  });
});

describe('findCommentAdrRefs', () => {
  // These fixtures contain literal "Implements: ADR-NNNN" text, and this repo's own
  // adr-audit.ts whole-repo-scans packages/adr/lib.test.ts too (it's real source under
  // CODE_ROOTS) — so each fixture line carries the ADR_SCAN_IGNORE_MARKER trailing comment,
  // the tool's own out-of-band "don't count this line as real evidence" signal (see
  // stripIgnoredLines in lib.ts), rather than obfuscating the string itself.
  test('extracts ADR numbers from Implements: and Verifies: comments', () => {
    expect(findCommentAdrRefs('// Implements: ADR-0002\n// Verifies: ADR-0011')).toEqual(['0002', '0011']); // adr-scan:ignore-line
  });

  test('dedupes when the same ADR is referenced more than once', () => {
    expect(findCommentAdrRefs('// Implements: ADR-0002\n// Implements: ADR-0002')).toEqual(['0002']); // adr-scan:ignore-line
  });

  test('negative space: content with no back-pointer comment returns an empty list', () => {
    expect(findCommentAdrRefs('// just a normal comment')).toEqual([]);
  });

  test('a line marked adr-scan:ignore-line is excluded from evidence entirely', () => {
    const content = '// Implements: ADR-0002 // adr-scan:ignore-line\n// Implements: ADR-0011';
    expect(findCommentAdrRefs(stripIgnoredLines(content))).toEqual(['0011']);
  });
});

// Verifies: ADR-0032
describe('Spec-lite linter (checkSpec / lintSpecs)', () => {
  const VALID_SPEC = `# Test Spec

> Version: 1.0 | Date: 2026-07-28 | Status: Ready
> **Implements ADRs:** ADR-0001

## Purpose

Test purpose.

## Design / Architecture

Test design.

## Interfaces / Contracts

Test interfaces.

## Testing & Verification

Test verification.

## Non-goals

Test non-goals.

## References

- Test reference.
`;

  function spec(text: string, path = 'docs/specs/test-spec.md'): SpecFile {
    return { path, text };
  }

  test('a fully valid spec produces no issues', () => {
    const issues = checkSpec(spec(VALID_SPEC), new Set(['0001']));
    expect(issues).toEqual([]);
  });

  test.each(SPEC_REQUIRED_SECTIONS.map((aliases) => aliases[0]))(
    'flags a missing required section: %s',
    (heading) => {
      const text = VALID_SPEC.replace(`## ${heading}\n`, `## Removed\n`);
      const issues = checkSpec(spec(text), new Set());
      expect(issues.some((i) => i.type === 'ERROR' && i.message.includes(`'## ${heading}'`))).toBe(
        true
      );
    }
  );

  test('an alias heading satisfies the requirement (negative space)', () => {
    const text = VALID_SPEC.replace('## Non-goals\n', '## Out of Scope\n');
    const issues = checkSpec(spec(text), new Set());
    expect(issues.some((i) => i.message.includes('Non-goals'))).toBe(false);
  });

  test('invalid Status is flagged', () => {
    const text = VALID_SPEC.replace('Status: Ready', 'Status: Revised');
    const issues = checkSpec(spec(text), new Set());
    expect(issues.some((i) => i.type === 'ERROR' && i.message.includes('Invalid Status'))).toBe(
      true
    );
  });

  test('absent Status field is not flagged (negative space)', () => {
    const text = VALID_SPEC.replace('Status: Ready', 'Ready-ish');
    const issues = checkSpec(spec(text), new Set());
    expect(issues.some((i) => i.message.includes('Invalid Status'))).toBe(false);
  });

  test('malformed Date is flagged', () => {
    const text = VALID_SPEC.replace('Date: 2026-07-28', 'Date: 07/28/2026');
    const issues = checkSpec(spec(text), new Set());
    expect(issues.some((i) => i.type === 'ERROR' && i.message.includes('valid YYYY-MM-DD'))).toBe(
      true
    );
  });

  test('a dangling Implements ADRs reference is warn-only, not blocking', () => {
    const issues = checkSpec(spec(VALID_SPEC), new Set());
    const dangling = issues.filter((i) => i.message.includes('does not exist'));
    expect(dangling).toHaveLength(1);
    expect(dangling[0].type).toBe('WARN');
  });

  test('a resolvable Implements ADRs reference produces no warning (negative space)', () => {
    const issues = checkSpec(spec(VALID_SPEC), new Set(['0001']));
    expect(issues.some((i) => i.type === 'WARN')).toBe(false);
  });

  test('lintSpecs aggregates issues across multiple files and reports specFiles', () => {
    const result = lintSpecs(
      [spec(VALID_SPEC, 'docs/specs/a.md'), spec('# Broken\n', 'docs/specs/b.md')],
      new Set(['0001'])
    );
    expect(result.specFiles).toEqual(['docs/specs/a.md', 'docs/specs/b.md']);
    expect(result.issues.filter((i) => i.file === 'docs/specs/b.md').length).toBeGreaterThan(0);
    expect(result.issues.filter((i) => i.file === 'docs/specs/a.md').length).toBe(0);
  });

  describe('property: random section omission is flagged exactly, nothing else', () => {
    test('holds across randomized subsets', () => {
      fc.assert(
        fc.property(
          fc.uniqueArray(fc.constantFrom(...SPEC_REQUIRED_SECTIONS.map((a) => a[0])), {
            minLength: 1,
          }),
          (omitted) => {
            let text = VALID_SPEC;
            for (const heading of omitted) {
              text = text.replace(`## ${heading}\n`, `## Removed-${heading}\n`);
            }
            const issues = checkSpec(spec(text), new Set(['0001']));
            const flagged = new Set(
              SPEC_REQUIRED_SECTIONS.map((a) => a[0]).filter((heading) =>
                issues.some((i) => i.message.includes(`'## ${heading}'`))
              )
            );
            expect(flagged).toEqual(new Set(omitted));
          }
        )
      );
    });
  });

  describe('property: random Status values flag only the invalid ones', () => {
    test('holds across randomized candidates', () => {
      fc.assert(
        fc.property(
          fc.constantFrom('Draft', 'Ready', 'Superseded', 'Revised', 'Pending', 'Final', 'wip'),
          (status) => {
            const text = VALID_SPEC.replace('Status: Ready', `Status: ${status}`);
            const issues = checkSpec(spec(text), new Set());
            const hasError = issues.some((i) => i.message.includes('Invalid Status'));
            expect(hasError).toBe(!SPEC_VALID_STATUSES.has(status));
          }
        )
      );
    });
  });
});

// ---------------------------------------------------------------------------
// resolveGitTrackedOrStagedFiles — scopes raw-filesystem discovery (in
// lintAdrDir here, and the analogous discovery functions in adr-audit.ts /
// spec-lint.ts) to what git actually tracks or has staged, so an untracked
// WIP .md file dropped in the corpus dir doesn't get swept into corpus-wide
// checks. Exercised against a real, disposable git repo (never this repo)
// so committing/staging in the fixture can't touch the real working tree.
// ---------------------------------------------------------------------------

function withGitFixtureRepo<T>(fn: (dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), 'adr-git-fixture-'));
  try {
    execFileSync('git', ['init', '-q'], { cwd: dir });
    execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
    execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir });
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('resolveGitTrackedOrStagedFiles', () => {
  test('a committed (tracked) file is included', () => {
    withGitFixtureRepo((dir) => {
      writeFileSync(join(dir, 'tracked.md'), 'x', 'utf8');
      execFileSync('git', ['add', 'tracked.md'], { cwd: dir });
      execFileSync('git', ['commit', '-q', '-m', 'add tracked'], { cwd: dir });

      const files = resolveGitTrackedOrStagedFiles(dir, dir);
      expect(files).not.toBeNull();
      expect(files!.has(join(dir, 'tracked.md'))).toBe(true);
    });
  });

  test('an untracked file is excluded', () => {
    withGitFixtureRepo((dir) => {
      writeFileSync(join(dir, 'tracked.md'), 'x', 'utf8');
      execFileSync('git', ['add', 'tracked.md'], { cwd: dir });
      execFileSync('git', ['commit', '-q', '-m', 'add tracked'], { cwd: dir });

      writeFileSync(join(dir, 'scratch.md'), 'wip', 'utf8');

      const files = resolveGitTrackedOrStagedFiles(dir, dir);
      expect(files).not.toBeNull();
      expect(files!.has(join(dir, 'scratch.md'))).toBe(false);
    });
  });

  test('a staged-but-uncommitted file is included', () => {
    withGitFixtureRepo((dir) => {
      writeFileSync(join(dir, 'tracked.md'), 'x', 'utf8');
      execFileSync('git', ['add', 'tracked.md'], { cwd: dir });
      execFileSync('git', ['commit', '-q', '-m', 'add tracked'], { cwd: dir });

      writeFileSync(join(dir, 'staged.md'), 'staged', 'utf8');
      execFileSync('git', ['add', 'staged.md'], { cwd: dir });

      const files = resolveGitTrackedOrStagedFiles(dir, dir);
      expect(files).not.toBeNull();
      expect(files!.has(join(dir, 'staged.md'))).toBe(true);
    });
  });

  test('a non-git directory falls back to null (unfiltered behavior)', () => {
    withFixtureDir({ 'plain.md': 'not a git repo' }, (dir) => {
      const files = resolveGitTrackedOrStagedFiles(dir, dir);
      expect(files).toBeNull();
    });
  });
});

// ---------------------------------------------------------------------------
// lintAdrDir — end-to-end: an untracked WIP .md file in the ADR dir doesn't
// participate in corpus-wide checks (duplicate-number detection, etc.)
// while a tracked/staged file still does. All existing lintAdrDir fixture
// tests above use a bare (non-git) tmpdir, so they exercise the fallback
// path unchanged; these exercise the git-scoped path specifically.
// ---------------------------------------------------------------------------

describe('lintAdrDir — git-scoped discovery', () => {
  test('an untracked scratch .md file is excluded from discovery entirely', () => {
    withGitFixtureRepo((dir) => {
      const tracked = makeAdr({ num: '0950', status: 'Accepted', author: 'Alice', reviewers: 'Bob', deciders: 'Carol' });
      writeFileSync(join(dir, '0950-tracked.md'), tracked, 'utf8');
      execFileSync('git', ['add', '0950-tracked.md'], { cwd: dir });
      execFileSync('git', ['commit', '-q', '-m', 'add tracked adr'], { cwd: dir });

      // Untracked scratch file, deliberately malformed (bad filename) — should
      // never be swept into the lint pass at all.
      writeFileSync(join(dir, 'WIP-notes.md'), 'not an ADR, just scratch', 'utf8');

      const { issues, adrFiles } = lintAdrDir(dir, [], dir);
      expect(adrFiles).toEqual(['0950-tracked.md']);
      expect(issues.some((i) => i.file === 'WIP-notes.md')).toBe(false);
    });
  });

  test('a staged-but-uncommitted ADR still participates in discovery', () => {
    withGitFixtureRepo((dir) => {
      const tracked = makeAdr({ num: '0951', status: 'Accepted', author: 'Alice', reviewers: 'Bob', deciders: 'Carol' });
      writeFileSync(join(dir, '0951-tracked.md'), tracked, 'utf8');
      execFileSync('git', ['add', '0951-tracked.md'], { cwd: dir });
      execFileSync('git', ['commit', '-q', '-m', 'add tracked adr'], { cwd: dir });

      const staged = makeAdr({ num: '0952', status: 'Accepted', author: 'Dave', reviewers: 'Erin', deciders: 'Frank' });
      writeFileSync(join(dir, '0952-staged.md'), staged, 'utf8');
      execFileSync('git', ['add', '0952-staged.md'], { cwd: dir });

      const { adrFiles } = lintAdrDir(dir, [], dir);
      expect(adrFiles.sort()).toEqual(['0951-tracked.md', '0952-staged.md']);
    });
  });
});

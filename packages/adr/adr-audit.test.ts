// Unit tests for the pure ADR-discovery/parsing primitives adr-audit.ts relies on
// (packages/adr/lib.ts's parseAdrFilenameNumber / parseAdrHeaderFields).
//
// adr-audit.ts itself is a CLI wrapper with a top-level `main()` side effect (like
// adr-lint.ts's `runCli()` call at file scope) — importing it directly in a test would
// execute the whole audit and write docs/adr-audit/*. So, mirroring the CLI/lib split
// already established for adr-lint.ts (logic in lib.ts, tested directly; the CLI file
// itself untested but exercised transitively), the actual parsing logic lives in lib.ts
// and is tested here without ever importing adr-audit.ts.

import { describe, test, expect } from 'vitest';

import { parseAdrFilenameNumber, parseAdrHeaderFields } from './lib.js';

describe('parseAdrFilenameNumber', () => {
  test('extracts the leading 4-digit number from a well-formed ADR filename', () => {
    expect(parseAdrFilenameNumber('0032-some-decision.md')).toBe('0032');
  });

  test('extracts the number regardless of how long the slug is', () => {
    expect(parseAdrFilenameNumber('0001-mainnet-upgrades-stay-manual.md')).toBe('0001');
  });

  test('returns null for a name that does not match the ADR filename shape', () => {
    expect(parseAdrFilenameNumber('README.md')).toBeNull();
    expect(parseAdrFilenameNumber('_template.md')).toBeNull();
    expect(parseAdrFilenameNumber('32-too-short.md')).toBeNull();
    expect(parseAdrFilenameNumber('0032-Has-Capitals.md')).toBeNull();
  });
});

describe('parseAdrHeaderFields', () => {
  // A real sample header, shaped like docs/adr/0001-mainnet-upgrades-stay-manual.md.
  const sampleHeader = [
    '# 0001 — Mainnet contract upgrades stay manual and developer-local',
    '',
    '> **Decision (Y-statement):** In the context of..., facing..., we decided..., to achieve...,',
    '> accepting...',
    '',
    '- **Status:** Accepted',
    '- **Date:** 2026-07-13',
    '- **Embodiment:** Inactive',
    '- **Last audited:** 2026-07-29',
    '- **Author:** Beau',
    '- **Reviewers:** Beau — self-attested; no independent reviewer recorded',
    '- **Deciders:** Beau',
    '- **Supersedes / Superseded-by:** —',
    '',
    '## Context',
    '',
    'Some context.',
  ].join('\n');

  test('extracts Status and stated Embodiment from a real sample ADR header', () => {
    expect(parseAdrHeaderFields(sampleHeader)).toEqual({
      status: 'Accepted',
      statedEmbodiment: 'Inactive',
      realizedByLocators: [],
      lastAudited: '2026-07-29',
    });
  });

  test('falls back to "unknown"/null for each field independently when absent', () => {
    expect(parseAdrHeaderFields('# no header fields here')).toEqual({
      status: 'unknown',
      statedEmbodiment: 'unknown',
      realizedByLocators: [],
      lastAudited: null,
    });
    expect(parseAdrHeaderFields('- **Status:** Proposed\n\n## Context')).toEqual({
      status: 'Proposed',
      statedEmbodiment: 'unknown',
      realizedByLocators: [],
      lastAudited: null,
    });
  });

  test('extracts Realized-by locators when present, with an optional @hash', () => {
    const header = sampleHeader.replace(
      '- **Supersedes / Superseded-by:** —',
      '- **Supersedes / Superseded-by:** —\n- **Realized by:** docs/rfc/README.md@a1b2c3, .github/workflows/deploy-testnet.yml'
    );
    expect(parseAdrHeaderFields(header).realizedByLocators).toEqual([
      { path: 'docs/rfc/README.md', hash: 'a1b2c3' },
      { path: '.github/workflows/deploy-testnet.yml', hash: null },
    ]);
  });
});

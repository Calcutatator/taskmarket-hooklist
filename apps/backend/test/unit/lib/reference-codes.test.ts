/**
 * Reference codes are the public name of a submission or task.
 *
 * Verifies: ADR-0098
 *
 * These are the properties a user actually depends on, rather than restatements of the
 * implementation: a code survives being read aloud and typed back, a code that names one kind of
 * thing never resolves to the other, and a prefixless code is reported as prefixless rather than
 * guessed at. The uniformity check exists because the draw masks bits rather than dividing, so a
 * future edit to the alphabet could introduce a bias that nothing else here would notice.
 */

import { describe, expect, it } from 'vitest';

import {
  REFERENCE_CODE_ALPHABET,
  formatReferenceCode,
  mintReferenceCode,
  normalizeReferenceCode,
  referenceCodeBody,
} from '../../../src/lib/reference-codes';

const CODE_PATTERN = /^(SUB|TSK)-[0-9A-HJKMNP-TV-Z]{8}$/;

describe('mintReferenceCode', () => {
  it('mints codes in the canonical prefixed form', () => {
    expect(mintReferenceCode('submission')).toMatch(CODE_PATTERN);
    expect(mintReferenceCode('task')).toMatch(CODE_PATTERN);
    expect(mintReferenceCode('submission').startsWith('SUB-')).toBe(true);
    expect(mintReferenceCode('task').startsWith('TSK-')).toBe(true);
  });

  it('never emits a character that is confusable on screen or in speech', () => {
    // The whole reason for Crockford's alphabet. If any of these appear, a code read off a
    // screenshot stops round-tripping.
    for (let index = 0; index < 5_000; index += 1) {
      expect(referenceCodeBody(mintReferenceCode('submission'))).not.toMatch(/[ILOU]/);
    }
  });

  it('does not collide across a large draw', () => {
    const codes = new Set<string>();
    for (let index = 0; index < 100_000; index += 1) {
      codes.add(mintReferenceCode('submission'));
    }
    // 32^8 is ~1.1e12, so 100k draws should collide with probability under 1e-2. A collision here
    // would mean the draw is not actually uniform over the alphabet.
    expect(codes.size).toBe(100_000);
  });

  it('draws every alphabet symbol with roughly equal frequency', () => {
    const counts = new Map<string, number>();
    const draws = 20_000;
    for (let index = 0; index < draws; index += 1) {
      for (const character of referenceCodeBody(mintReferenceCode('task'))) {
        counts.set(character, (counts.get(character) ?? 0) + 1);
      }
    }

    expect(counts.size).toBe(REFERENCE_CODE_ALPHABET.length);
    const expected = (draws * 8) / REFERENCE_CODE_ALPHABET.length;
    for (const [, count] of counts) {
      // Generous bound -- this is a bias check, not a statistics exam. A byte-modulo over a
      // 33-symbol alphabet would skew the first symbol by ~3%, well inside this; a genuinely
      // broken draw skews far more.
      expect(count).toBeGreaterThan(expected * 0.85);
      expect(count).toBeLessThan(expected * 1.15);
    }
  });
});

describe('normalizeReferenceCode', () => {
  it('accepts the canonical form unchanged', () => {
    expect(normalizeReferenceCode('SUB-7K2QA9XF')).toEqual({
      code: 'SUB-7K2QA9XF',
      entity: 'submission',
    });
    expect(normalizeReferenceCode('TSK-4M0BXQ2E')).toEqual({
      code: 'TSK-4M0BXQ2E',
      entity: 'task',
    });
  });

  it('accepts the forms a code actually arrives in', () => {
    // Lower case from a chat client, stray whitespace from a copy-paste, and mixed case from
    // someone typing it back.
    for (const input of ['sub-7k2qa9xf', '  SUB-7K2QA9XF  ', 'Sub-7k2Qa9Xf']) {
      expect(normalizeReferenceCode(input)).toEqual({
        code: 'SUB-7K2QA9XF',
        entity: 'submission',
      });
    }
  });

  it("applies Crockford's substitutions so a code survives being read aloud", () => {
    // Someone hears "oh" and writes O; hears "one" and writes I or L.
    expect(normalizeReferenceCode('SUB-7K2QA9XF'.replace('0', 'O'))).toEqual({
      code: 'SUB-7K2QA9XF',
      entity: 'submission',
    });
    expect(normalizeReferenceCode('TSK-4MOBXQ2E')).toEqual({
      code: 'TSK-4M0BXQ2E',
      entity: 'task',
    });
    expect(normalizeReferenceCode('TSK-4M0BXQ2I')?.code).toBe('TSK-4M0BXQ21');
    expect(normalizeReferenceCode('TSK-4M0BXQ2L')?.code).toBe('TSK-4M0BXQ21');
  });

  it('reports a prefixless code as prefixless rather than guessing an entity', () => {
    expect(normalizeReferenceCode('7K2QA9XF')).toEqual({ code: '7K2QA9XF', entity: null });
    expect(normalizeReferenceCode('7k2qa9xf')).toEqual({ code: '7K2QA9XF', entity: null });
  });

  it('keeps a prefixed code bound to the entity its prefix named', () => {
    // A TSK- code must never resolve against submissions, however it is written.
    expect(normalizeReferenceCode('tsk-4m0bxq2e')?.entity).toBe('task');
    expect(normalizeReferenceCode('SUB-4M0BXQ2E')?.entity).toBe('submission');
  });

  it('rejects an unrecognised prefix rather than treating it as prefixless', () => {
    // Reading `AGT-7K2QA9XF` as bare `7K2QA9XF` would resolve a code for something this scheme
    // does not cover onto an unrelated submission or task.
    expect(normalizeReferenceCode('AGT-7K2QA9XF')).toBeNull();
    expect(normalizeReferenceCode('-7K2QA9XF')).toBeNull();
  });

  it('rejects anything that is not a code, without throwing', () => {
    for (const input of [
      '',
      '   ',
      '7K2QA9X', // too short
      '7K2QA9XFF', // too long
      'SUB-7K2QA9X', // right prefix, wrong length
      '7K2QA9X!', // not in the alphabet
      'SUB-UUUUUUUU', // U is excluded, and substitution does not rescue it
      'https://example.com/s/SUB-7K2QA9XF',
    ]) {
      expect(normalizeReferenceCode(input)).toBeNull();
    }
  });

  it('round-trips every minted code', () => {
    for (const entity of ['submission', 'task'] as const) {
      for (let index = 0; index < 2_000; index += 1) {
        const minted = mintReferenceCode(entity);
        expect(normalizeReferenceCode(minted)).toEqual({ code: minted, entity });
        // And prefixless, as a user would paste just the distinctive part.
        expect(normalizeReferenceCode(referenceCodeBody(minted))).toEqual({
          code: referenceCodeBody(minted),
          entity: null,
        });
      }
    }
  });
});

describe('formatReferenceCode / referenceCodeBody', () => {
  it('are inverses of each other', () => {
    expect(formatReferenceCode('submission', '7K2QA9XF')).toBe('SUB-7K2QA9XF');
    expect(referenceCodeBody('SUB-7K2QA9XF')).toBe('7K2QA9XF');
    expect(referenceCodeBody(formatReferenceCode('task', '4M0BXQ2E'))).toBe('4M0BXQ2E');
  });

  it('treats an unprefixed body as already stripped', () => {
    expect(referenceCodeBody('7K2QA9XF')).toBe('7K2QA9XF');
  });
});

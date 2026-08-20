// Implements: ADR-0098. A submission's or task's primary key is not a name a person can use.
// `submissions.id` is a SHA-256 digest reshaped as a UUID and `tasks.id` is chain-derived; neither
// can be read over a call or typed from a screenshot. A reference code is the public name, minted
// randomly and stored, so it stays valid no matter how the ids are derived later.

import { randomBytes } from 'node:crypto';

/**
 * Crockford's base32 alphabet. The exclusions are the point: no `I`, `L` or `O` (indistinguishable
 * from `1`, `1` and `0` in most fonts, which is exactly how a code transcribed from a screen goes
 * wrong) and no `U` (which removes most accidentally-generated profanity).
 */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const CODE_LENGTH = 8;

export type ReferenceEntity = 'submission' | 'task';

const PREFIXES = {
  submission: 'SUB',
  task: 'TSK',
} as const satisfies Record<ReferenceEntity, string>;

const ENTITY_BY_PREFIX = new Map<string, ReferenceEntity>(
  Object.entries(PREFIXES).map(([entity, prefix]) => [prefix, entity as ReferenceEntity])
);

export type NormalizedReferenceCode = {
  /** Canonical, storable form -- always prefixed and uppercase, e.g. `SUB-7K2QA9XF`. */
  code: string;
  /**
   * The entity the prefix named, or null when the input carried no prefix. A null entity means the
   * caller must resolve against every table and decide what an ambiguous hit means; this module
   * deliberately does not guess.
   */
  entity: ReferenceEntity | null;
};

/**
 * Draw `CODE_LENGTH` characters uniformly from the alphabet.
 *
 * The alphabet has 32 symbols, so each character consumes exactly 5 bits with no remainder and a
 * plain byte-modulo would still be uniform. Masking the low 5 bits says that intent directly rather
 * than relying on 256 happening to be a multiple of 32, which stops the draw from silently
 * developing a bias if the alphabet is ever edited.
 */
function drawCode(): string {
  const bytes = randomBytes(CODE_LENGTH);
  let code = '';
  for (const byte of bytes) {
    code += ALPHABET[byte & 0b11111];
  }
  return code;
}

/** Mint a fresh reference code for an entity, e.g. `SUB-7K2QA9XF`. */
export function mintReferenceCode(entity: ReferenceEntity): string {
  return `${PREFIXES[entity]}-${drawCode()}`;
}

/**
 * Parse user-supplied text into a canonical reference code.
 *
 * Lookup is forgiving and storage is not: a code read aloud and typed back arrives with the wrong
 * case, sometimes without its prefix, and with Crockford's confusable characters substituted the
 * wrong way round. All of that resolves; anything else returns null rather than throwing, because
 * every caller here is handling untrusted input (a search box, a URL segment).
 */
export function normalizeReferenceCode(input: string): NormalizedReferenceCode | null {
  const trimmed = input.trim().toUpperCase();
  if (!trimmed) return null;

  let entity: ReferenceEntity | null = null;
  let body = trimmed;

  const separator = trimmed.indexOf('-');
  if (separator !== -1) {
    const candidate = ENTITY_BY_PREFIX.get(trimmed.slice(0, separator));
    // An unrecognised prefix is a rejection, not a prefixless code: `AGT-7K2QA9XF` names something
    // this scheme does not cover, and treating it as bare `7K2QA9XF` would resolve it to an
    // unrelated submission or task.
    if (!candidate) return null;
    entity = candidate;
    body = trimmed.slice(separator + 1);
  }

  // Crockford's documented decoding substitutions. Applied only to the body: the prefixes are
  // already fixed literals and `TSK` contains no confusable characters.
  const decoded = body.replaceAll('I', '1').replaceAll('L', '1').replaceAll('O', '0');

  if (decoded.length !== CODE_LENGTH) return null;
  for (const character of decoded) {
    if (!ALPHABET.includes(character)) return null;
  }

  return {
    code: entity ? `${PREFIXES[entity]}-${decoded}` : decoded,
    entity,
  };
}

/** Build the canonical stored form for an entity from an already-normalized body. */
export function formatReferenceCode(entity: ReferenceEntity, body: string): string {
  return `${PREFIXES[entity]}-${body}`;
}

/** Strip the prefix from a canonical code, e.g. `SUB-7K2QA9XF` -> `7K2QA9XF`. */
export function referenceCodeBody(code: string): string {
  const separator = code.indexOf('-');
  return separator === -1 ? code : code.slice(separator + 1);
}

export const REFERENCE_CODE_ALPHABET = ALPHABET;
export const REFERENCE_CODE_LENGTH = CODE_LENGTH;
export const REFERENCE_CODE_PREFIXES = PREFIXES;

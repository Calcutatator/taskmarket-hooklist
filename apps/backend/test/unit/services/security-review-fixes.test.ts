/**
 * Regressions for the confirmed findings of the 2026-08-09 security review of this branch.
 *
 * Verifies: ADR-0045
 * Verifies: ADR-0067
 * Verifies: ADR-0077
 *
 * Each block names the finding it pins and the property that was violated, because the fixes are
 * small and their reasons are not self-evident from the diff -- a later reader deleting a
 * `continue` or relaxing a regex would reintroduce a specific, reasoned defect.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { stubServerEnvironment } from '../../helpers/server-environment';

const restoreServerEnvironment = stubServerEnvironment();

const { derivedIdempotencyKey, isEncodableAuthorizationPair, sponsoredIdempotencyKey } =
  await import('../../../src/services/relayed-intents');

afterAll(restoreServerEnvironment);

describe('finding 1: an EIP-3009 pair that could never name an authorization', () => {
  // The columns are written from an attacker-supplied header BEFORE the facilitator verifies
  // anything -- deliberately, since the write-ahead record is what survives a crash mid-settle
  // (ADR-0067). Both are `text`, so nothing but this check stops junk being persisted, and junk
  // made the sweep throw on every pass forever, disabling the safety net that surfaces a payment
  // which settled but never attached.
  it('accepts a well-formed pair', () => {
    expect(isEncodableAuthorizationPair(`0x${'a'.repeat(40)}`, `0x${'b'.repeat(64)}`)).toBe(true);
  });

  it.each([
    ['a non-address payer', 'attacker', `0x${'b'.repeat(64)}`],
    ['a non-hex nonce', `0x${'a'.repeat(40)}`, 'zz'],
    ['an empty pair', '', ''],
    ['a payer of the wrong length', `0x${'a'.repeat(39)}`, `0x${'b'.repeat(64)}`],
    ['a nonce of the wrong length', `0x${'a'.repeat(40)}`, `0x${'b'.repeat(63)}`],
    ['a payer with no 0x prefix', 'a'.repeat(40), `0x${'b'.repeat(64)}`],
  ])('rejects %s', (_label, payer, nonce) => {
    expect(isEncodableAuthorizationPair(payer, nonce)).toBe(false);
  });
});

describe('findings 2/3: a sponsored key must not be computable from public inputs', () => {
  const scope = '0x1111111111111111111111111111111111111111:identity.register';

  it('does not equal the unkeyed digest of the same scope', () => {
    // The whole attack was computing this value offline from a public address. If these two ever
    // agree again, the key is derivable off-platform and the mint is deniable for any wallet.
    expect(sponsoredIdempotencyKey(scope)).not.toBe(derivedIdempotencyKey(scope));
  });

  it('is still shaped like a v4 UUID, so it satisfies the key pattern', () => {
    // The HMAC has to remain acceptable as an idempotency key; a fix that produced a value the
    // pattern rejects would swap a security bug for an outage.
    expect(sponsoredIdempotencyKey(scope)).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    );
  });

  it('is stable for one scope, and different across scopes', () => {
    // Stability is the property the derivation exists for: a second device registration for one
    // wallet must join the in-flight mint rather than start another.
    const other = '0x2222222222222222222222222222222222222222:identity.register';
    expect(sponsoredIdempotencyKey(scope)).toBe(sponsoredIdempotencyKey(scope));
    expect(sponsoredIdempotencyKey(scope)).not.toBe(sponsoredIdempotencyKey(other));
  });
});

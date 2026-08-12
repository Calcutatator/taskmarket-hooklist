import { describe, expect, it } from 'vitest';

import { readSenderVerification } from '../../../src/lib/email-sender-verification';

/**
 * The verdict recorded against an inbound email's `fromAddress`.
 *
 * The consequential case is the last one: an SPF pass must not read as sender verification. SPF
 * authenticates the envelope sender, which a forged `From:` header need not match, so treating it
 * as a verified sender would put a "verified" marker on exactly the spoofing this field exists to
 * expose.
 */
describe('readSenderVerification', () => {
  it('treats a missing header as unverified', () => {
    // Inbound mail is accepted from any unauthenticated sender, so no header is the common case
    // and it is not an error -- it means nobody checked.
    expect(readSenderVerification(undefined)).toBe('unverified');
    expect(readSenderVerification(null)).toBe('unverified');
    expect(readSenderVerification('')).toBe('unverified');
  });

  it('reads a DMARC pass as verified', () => {
    expect(readSenderVerification('mx.example.com; spf=pass; dkim=pass; dmarc=pass')).toBe('pass');
  });

  it('reads a DKIM pass as verified', () => {
    expect(readSenderVerification('mx.example.com; dkim=pass header.d=example.com')).toBe('pass');
  });

  it('reads a failure as a failure even when other mechanisms pass', () => {
    // A partial pass is not a pass. DMARC failing while SPF passes is a classic forged-From
    // signature, and resolving it optimistically would be worse than not checking at all.
    expect(readSenderVerification('mx.example.com; spf=pass; dmarc=fail')).toBe('fail');
    expect(readSenderVerification('mx.example.com; dkim=fail; spf=pass')).toBe('fail');
  });

  it('does not accept SPF alone as sender verification', () => {
    // The whole point. SPF authenticates the envelope sender, not the visible `From:` header, so
    // an SPF pass says nothing about whether `fromAddress` is genuine.
    expect(readSenderVerification('mx.example.com; spf=pass smtp.mailfrom=attacker.example')).toBe(
      'unverified'
    );
  });

  it('is case-insensitive, since MTAs disagree on casing', () => {
    expect(readSenderVerification('MX.EXAMPLE.COM; DMARC=PASS')).toBe('pass');
  });

  it('reports unverified for a header it cannot interpret', () => {
    // Failing closed: an unrecognised header is not evidence of anything.
    expect(readSenderVerification('something entirely unexpected')).toBe('unverified');
  });
});

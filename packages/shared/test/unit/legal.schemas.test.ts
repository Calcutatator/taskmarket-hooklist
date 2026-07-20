import { describe, expect, it } from 'vitest';

import {
  LegalAcceptanceResponseSchema,
  LegalBundleSchema,
  LegalChallengeResponseSchema,
  LegalWalletAcceptanceInputSchema,
  LegalStatusResponseSchema,
} from '../../src/schemas/legal.schemas';

const bundle = {
  acceptanceAvailable: true,
  acceptanceStatement: 'I agree to the policies.',
  bundleDigest: `sha256:${'a'.repeat(64)}`,
  documents: [
    {
      contentHash: `sha256:${'b'.repeat(64)}`,
      slug: 'terms',
      summary: 'Marketplace terms.',
      title: 'Terms of Service',
      type: 'terms_of_service',
      url: 'https://api.taskmarket.dev/legal-documents/2026-07/terms/hash',
      version: '2026-07',
    },
  ],
  effectiveAt: '2026-07-15T00:00:00.000Z',
  enforcementEnabled: true,
  privyAppId: 'taskmarket-privy-app',
  publishedAt: '2026-07-01T00:00:00.000Z',
  status: 'approved',
  version: '2026-07',
};

describe('legal API schemas', () => {
  it('accepts a versioned bundle and rejects a malformed evidence digest', () => {
    expect(LegalBundleSchema.parse(bundle)).toEqual(bundle);
    expect(() => LegalBundleSchema.parse({ ...bundle, bundleDigest: 'sha256:not-a-digest' })).toThrow();
  });

  it('validates legal status responses before clients persist a receipt', () => {
    expect(
      LegalStatusResponseSchema.parse({
        accepted: true,
        bundle,
        receipt: 'tmlegal_receipt',
        subjectType: 'wallet',
      })
    ).toMatchObject({ accepted: true, receipt: 'tmlegal_receipt', subjectType: 'wallet' });
    expect(() =>
      LegalStatusResponseSchema.parse({ accepted: true, bundle, subjectType: 'unknown' })
    ).toThrow();
  });

  it('binds wallet acceptance to a challenge and requires every explicit affirmation', () => {
    const challenge = LegalChallengeResponseSchema.parse({
      bundle,
      expiresAt: '2026-07-15T00:10:00.000Z',
      issuedAt: '2026-07-15T00:00:00.000Z',
      message: 'Review and accept the Taskmarket legal bundle.',
      nonce: '123e4567-e89b-42d3-a456-426614174000',
      walletAddress: '0x1111111111111111111111111111111111111111',
    });
    const input = {
      acknowledgedRisk: true,
      agreedToAcceptableUse: true,
      agreedToTerms: true,
      bundleDigest: bundle.bundleDigest,
      bundleVersion: bundle.version,
      nonce: challenge.nonce,
      receivedPrivacyNotice: true,
      signature: `0x${'1'.repeat(130)}`,
      walletAddress: challenge.walletAddress,
    } as const;

    expect(LegalWalletAcceptanceInputSchema.parse(input)).toEqual(input);
    expect(() =>
      LegalWalletAcceptanceInputSchema.parse({ ...input, agreedToTerms: false })
    ).toThrow();
    expect(
      LegalAcceptanceResponseSchema.parse({
        acceptedAt: '2026-07-15T00:00:01.000Z',
        bundleDigest: bundle.bundleDigest,
        bundleVersion: bundle.version,
        receipt: 'tmlegal_receipt',
      })
    ).toMatchObject({ bundleVersion: bundle.version, receipt: 'tmlegal_receipt' });
  });
});

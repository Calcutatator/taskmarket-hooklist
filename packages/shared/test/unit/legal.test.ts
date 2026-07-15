import { describe, expect, it } from 'vitest';

import {
  CURRENT_LEGAL_BUNDLE,
  LEGAL_ACCEPTANCE_STATEMENT,
  buildWalletLegalAcceptanceMessage,
  getCurrentLegalBundleActivationIssues,
  isCurrentLegalBundleActivationReady,
} from '../../src/legal';

describe('legal bundle', () => {
  it('contains the four independently versioned policies required for assent', () => {
    expect(CURRENT_LEGAL_BUNDLE.status).toBe('draft');
    expect(CURRENT_LEGAL_BUNDLE.documents.map((document) => document.type)).toEqual([
      'terms_of_service',
      'privacy_policy',
      'risk_disclosure',
      'acceptable_use_policy',
    ]);
    expect(new Set(CURRENT_LEGAL_BUNDLE.documents.map((document) => document.version)).size).toBe(
      1
    );
  });

  it('cannot activate while approval fields and counsel placeholders remain', () => {
    expect(isCurrentLegalBundleActivationReady()).toBe(false);
    expect(getCurrentLegalBundleActivationIssues()).toEqual(
      expect.arrayContaining([
        'bundle status is not approved',
        'effective date is missing',
        'bundle version is still marked draft',
        'contracting entity details contain placeholders',
        'policy copy still contains draft markers',
        'policy copy contains counsel or product placeholders',
      ])
    );
  });

  it('builds a deterministic wallet message that binds every document hash', () => {
    const message = buildWalletLegalAcceptanceMessage({
      bundleVersion: '2026-07-draft-1',
      documents: [
        {
          contentHash: 'sha256:aaa',
          title: 'Terms of Service',
          type: 'terms_of_service',
          version: '2026-07-draft-1',
        },
        {
          contentHash: 'sha256:bbb',
          title: 'Privacy Policy',
          type: 'privacy_policy',
          version: '2026-07-draft-1',
        },
      ],
      expiresAt: '2026-07-15T01:10:00.000Z',
      issuedAt: '2026-07-15T01:00:00.000Z',
      nonce: 'nonce-1',
      walletAddress: '0x1111111111111111111111111111111111111111',
    });

    expect(message).toBe(`Taskmarket legal acceptance\n\nWallet: 0x1111111111111111111111111111111111111111\nBundle: 2026-07-draft-1\nIssued at: 2026-07-15T01:00:00.000Z\nExpires at: 2026-07-15T01:10:00.000Z\nNonce: nonce-1\n\nDocuments:\n- Terms of Service (2026-07-draft-1): sha256:aaa\n- Privacy Policy (2026-07-draft-1): sha256:bbb\n\n${LEGAL_ACCEPTANCE_STATEMENT}`);
  });
});

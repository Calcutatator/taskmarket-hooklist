import { describe, expect, it } from 'vitest';

import {
  CURRENT_LEGAL_BUNDLE,
  LEGAL_ACCEPTANCE_STATEMENT,
  buildWalletLegalAcceptanceMessage,
  getCurrentLegalBundleActivationIssues,
  getLegalBundleActivationIssues,
  isCurrentLegalBundleActivationReady,
} from '../../src/legal';

describe('legal bundle', () => {
  function getPolicyMarkdown(
    type: (typeof CURRENT_LEGAL_BUNDLE.documents)[number]['type']
  ): string {
    const document = CURRENT_LEGAL_BUNDLE.documents.find((candidate) => candidate.type === type);
    expect(document).toBeDefined();
    return document?.markdown ?? '';
  }

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

  it('covers the platform operating model and preserves mandatory participant rights', () => {
    const terms = getPolicyMarkdown('terms_of_service');

    expect(terms).toContain('## 3. Task records and participant contracts');
    expect(terms).toContain('direct contract between the requester and each worker');
    expect(terms).toContain('does not determine the regulatory classification');
    expect(terms).toContain('mandatory consumer, small-business, worker, or contractor rights');
    expect(terms).toContain('screen, reject, delay, freeze, block, or report');
  });

  it('requires operational privacy, sanctions, and marketplace safeguards', () => {
    const privacy = getPolicyMarkdown('privacy_policy');
    const acceptableUse = getPolicyMarkdown('acceptable_use_policy');

    expect(privacy).toContain('documented retention schedule');
    expect(privacy).toContain('collection notice');
    expect(privacy).toContain('eligible data breach');
    expect(privacy).toContain('service-provider register');
    expect(acceptableUse).toContain('wallet or counterparty screening');
    expect(acceptableUse).toContain('notice and appeal process');
    expect(acceptableUse).toContain('intellectual-property complaint');
  });

  it('rejects a malformed effective date even when the bundle is marked approved', () => {
    const issues = getLegalBundleActivationIssues({
      ...CURRENT_LEGAL_BUNDLE,
      effectiveAt: 'not-a-date',
      status: 'approved',
    });

    expect(issues).toContain('effective date is invalid');
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

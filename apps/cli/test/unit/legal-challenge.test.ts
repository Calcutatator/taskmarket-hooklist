import { describe, expect, it } from 'vitest';
import { buildWalletLegalAcceptanceMessage } from '@taskmarket/shared';

import {
  type LegalBundle,
  type LegalChallenge,
  validateLegalChallenge,
} from '../../src/commands/legal/index.js';

const walletAddress = '0x1111111111111111111111111111111111111111';
const bundle: LegalBundle = {
  acceptanceAvailable: true,
  acceptanceStatement: 'I agree to the reviewed policies.',
  bundleDigest: `sha256:${'a'.repeat(64)}`,
  documents: [
    {
      contentHash: 'sha256:aaa',
      title: 'Terms of Service',
      type: 'terms_of_service',
      url: 'https://taskmarket.example/legal/terms',
      version: '2026-07-1',
    },
  ],
  enforcementEnabled: true,
  status: 'approved',
  version: '2026-07-1',
};

function challenge(): LegalChallenge {
  const value: LegalChallenge = {
    bundle,
    expiresAt: '2026-07-15T01:10:00.000Z',
    issuedAt: '2026-07-15T01:00:00.000Z',
    message: '',
    nonce: 'nonce-1',
    walletAddress,
  };
  value.message = buildWalletLegalAcceptanceMessage({
    bundleVersion: bundle.version,
    documents: bundle.documents,
    expiresAt: value.expiresAt,
    issuedAt: value.issuedAt,
    nonce: value.nonce,
    walletAddress,
  });
  return value;
}

describe('legal CLI challenge validation', () => {
  it('accepts the canonical message for the exact bundle the operator reviewed', () => {
    expect(() => validateLegalChallenge(bundle, challenge(), walletAddress)).not.toThrow();
  });

  it('refuses to sign an unexpected message even if its bundle version matches', () => {
    const changed = challenge();
    changed.message += '\nUnexpected instruction';

    expect(() => validateLegalChallenge(bundle, changed, walletAddress)).toThrow(
      'does not match the reviewed bundle'
    );
  });
});

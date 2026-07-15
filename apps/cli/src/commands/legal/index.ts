import { Command } from 'commander';
import { createInterface } from 'node:readline/promises';
import { buildWalletLegalAcceptanceMessage, type LegalDocumentEvidence } from '@taskmarket/shared';

import { apiGet, apiPost } from '../../lib/api.js';
import { loadKeystore, saveKeystore } from '../../lib/keystore.js';
import { printResult } from '../../lib/output.js';
import { signMessage } from '../../lib/signer.js';

export type LegalBundle = {
  acceptanceAvailable: boolean;
  acceptanceStatement: string;
  documents: Array<{
    contentHash: string;
    title: string;
    type: LegalDocumentEvidence['type'];
    url: string;
    version: string;
  }>;
  enforcementEnabled: boolean;
  status: 'draft' | 'approved';
  version: string;
};

export type LegalChallenge = {
  bundle: LegalBundle;
  expiresAt: string;
  issuedAt: string;
  message: string;
  nonce: string;
  walletAddress: string;
};

type LegalStatus = {
  accepted: boolean;
  bundle: LegalBundle;
  receipt?: string;
};

const affirmations = {
  acknowledgedRisk: true,
  agreedToAcceptableUse: true,
  agreedToTerms: true,
  receivedPrivacyNotice: true,
} as const;

async function confirmAcceptance(bundle: LegalBundle, assumeYes: boolean): Promise<void> {
  const documentList = bundle.documents
    .map(
      (document) =>
        `- ${document.title} (${document.version})\n  ${document.url}\n  ${document.contentHash}`
    )
    .join('\n');
  process.stderr.write(
    `\nReview the Taskmarket legal bundle before accepting:\n${documentList}\n\n${bundle.acceptanceStatement}\n\n`
  );

  if (assumeYes) return;
  if (!process.stdin.isTTY) {
    throw new Error('Interactive confirmation is unavailable. Re-run with --yes after review.');
  }

  const prompt = createInterface({ input: process.stdin, output: process.stderr });
  try {
    const answer = await prompt.question('Type I AGREE to sign this acceptance: ');
    if (answer.trim() !== 'I AGREE') {
      throw new Error('Legal acceptance was not confirmed');
    }
  } finally {
    prompt.close();
  }
}

function bundleEvidence(bundle: LegalBundle): string {
  return JSON.stringify({
    acceptanceStatement: bundle.acceptanceStatement,
    documents: bundle.documents.map(({ contentHash, title, type, version }) => ({
      contentHash,
      title,
      type,
      version,
    })),
    version: bundle.version,
  });
}

export function validateLegalChallenge(
  reviewedBundle: LegalBundle,
  challenge: LegalChallenge,
  expectedWalletAddress: string
): void {
  if (
    challenge.bundle.version !== reviewedBundle.version ||
    bundleEvidence(challenge.bundle) !== bundleEvidence(reviewedBundle)
  ) {
    throw new Error('The legal bundle changed while acceptance was in progress. Review it again.');
  }
  if (challenge.walletAddress.toLowerCase() !== expectedWalletAddress.toLowerCase()) {
    throw new Error('The legal acceptance challenge is for a different wallet.');
  }

  const expectedMessage = buildWalletLegalAcceptanceMessage({
    bundleVersion: challenge.bundle.version,
    documents: challenge.bundle.documents,
    expiresAt: challenge.expiresAt,
    issuedAt: challenge.issuedAt,
    nonce: challenge.nonce,
    walletAddress: challenge.walletAddress,
  });
  if (challenge.message !== expectedMessage) {
    throw new Error('The legal acceptance challenge does not match the reviewed bundle.');
  }
}

const statusCommand = new Command('status')
  .description('Show whether this CLI has accepted the current legal bundle')
  .action(async () => {
    const keystore = await loadKeystore();
    const status = (await apiGet('/api/legal/status')) as LegalStatus;
    if (status.receipt) {
      await saveKeystore({
        ...keystore,
        legalAcceptanceBundleVersion: status.bundle.version,
        legalAcceptanceReceipt: status.receipt,
      });
    }
    printResult({
      accepted: status.accepted,
      bundleVersion: status.bundle.version,
      enforcementEnabled: status.bundle.enforcementEnabled,
      status: status.bundle.status,
      documents: status.bundle.documents.map(({ title, url, version }) => ({
        title,
        url,
        version,
      })),
    });
  });

const acceptCommand = new Command('accept')
  .description('Review and sign the current Taskmarket legal bundle')
  .option(
    '--yes',
    'Confirm acceptance non-interactively after the operator has reviewed every policy'
  )
  .action(async (options: { yes?: boolean }) => {
    const keystore = await loadKeystore();
    const bundle = (await apiGet('/api/legal/current')) as LegalBundle;
    if (!bundle.acceptanceAvailable) {
      throw new Error('The current legal bundle is a counsel-review draft and cannot be accepted.');
    }

    await confirmAcceptance(bundle, Boolean(options.yes));
    const challenge = (await apiPost('/api/legal/challenge', {
      walletAddress: keystore.walletAddress,
    })) as LegalChallenge;
    validateLegalChallenge(bundle, challenge, keystore.walletAddress);

    const signature = await signMessage(challenge.message, keystore);
    const result = (await apiPost('/api/legal/accept/wallet', {
      ...affirmations,
      bundleVersion: bundle.version,
      nonce: challenge.nonce,
      signature,
      walletAddress: keystore.walletAddress,
    })) as { acceptedAt: string; bundleVersion: string; receipt: string };

    await saveKeystore({
      ...keystore,
      legalAcceptanceBundleVersion: result.bundleVersion,
      legalAcceptanceReceipt: result.receipt,
    });
    printResult({
      accepted: true,
      acceptedAt: result.acceptedAt,
      bundleVersion: result.bundleVersion,
      walletAddress: keystore.walletAddress,
    });
  });

export const legalCommand = new Command('legal').description(
  'Review and manage versioned Taskmarket legal acceptance'
);

legalCommand.addCommand(statusCommand);
legalCommand.addCommand(acceptCommand);

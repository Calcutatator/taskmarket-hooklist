import { Command } from 'commander';
import { createInterface } from 'node:readline/promises';
import {
  LegalAcceptanceResponseSchema,
  LegalBundleSchema,
  LegalChallengeResponseSchema,
  LegalStatusResponseSchema,
  buildWalletLegalAcceptanceMessage,
  type LegalAcceptanceResponse,
  type LegalBundle,
  type LegalChallenge,
} from '@taskmarket/shared';

import { API_ORIGIN, apiGet, apiPost } from '../../lib/api.js';
import { loadKeystore, saveKeystore } from '../../lib/keystore.js';
import { printResult } from '../../lib/output.js';
import { signMessage as signKeystoreMessage } from '../../lib/signer.js';

export type { LegalBundle, LegalChallenge };

const affirmations = {
  acknowledgedRisk: true,
  agreedToAcceptableUse: true,
  agreedToTerms: true,
  receivedPrivacyNotice: true,
} as const;

export type LegalAcceptanceResult = LegalAcceptanceResponse;

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
    bundleDigest: bundle.bundleDigest,
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

export async function acceptLegalBundle(options: {
  assumeYes: boolean;
  bundle?: LegalBundle;
  signMessage: (message: string) => Promise<string>;
  walletAddress: string;
}): Promise<LegalAcceptanceResult> {
  const bundle = LegalBundleSchema.parse(options.bundle ?? (await apiGet('/api/legal/current')));
  if (!bundle.acceptanceAvailable) {
    throw new Error('The current legal bundle is a counsel-review draft and cannot be accepted.');
  }

  await confirmAcceptance(bundle, options.assumeYes);
  const challenge = LegalChallengeResponseSchema.parse(
    await apiPost('/api/legal/challenge', {
      walletAddress: options.walletAddress,
    })
  );
  validateLegalChallenge(bundle, challenge, options.walletAddress);

  const signature = await options.signMessage(challenge.message);
  const result = LegalAcceptanceResponseSchema.parse(
    await apiPost('/api/legal/accept/wallet', {
      ...affirmations,
      bundleDigest: bundle.bundleDigest,
      bundleVersion: bundle.version,
      nonce: challenge.nonce,
      signature,
      walletAddress: options.walletAddress,
    })
  );

  if (result.bundleDigest !== bundle.bundleDigest || result.bundleVersion !== bundle.version) {
    throw new Error('The server returned a receipt for a different legal bundle.');
  }
  return result;
}

const statusCommand = new Command('status')
  .description('Show whether this CLI has accepted the current legal bundle')
  .action(async () => {
    const keystore = await loadKeystore();
    const status = LegalStatusResponseSchema.parse(await apiGet('/api/legal/status'));
    if (status.receipt) {
      await saveKeystore({
        ...keystore,
        legalAcceptanceApiOrigin: API_ORIGIN,
        legalAcceptanceBundleVersion: status.bundle.version,
        legalAcceptanceReceipt: status.receipt,
      });
    }
    printResult({
      accepted: status.accepted,
      bundleDigest: status.bundle.bundleDigest,
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
    const result = await acceptLegalBundle({
      assumeYes: Boolean(options.yes),
      signMessage: (message) => signKeystoreMessage(message, keystore),
      walletAddress: keystore.walletAddress,
    });

    await saveKeystore({
      ...keystore,
      legalAcceptanceApiOrigin: API_ORIGIN,
      legalAcceptanceBundleVersion: result.bundleVersion,
      legalAcceptanceReceipt: result.receipt,
    });
    printResult({
      accepted: true,
      acceptedAt: result.acceptedAt,
      bundleDigest: result.bundleDigest,
      bundleVersion: result.bundleVersion,
      walletAddress: keystore.walletAddress,
    });
  });

export const legalCommand = new Command('legal').description(
  'Review and manage versioned Taskmarket legal acceptance'
);

legalCommand.addCommand(statusCommand);
legalCommand.addCommand(acceptCommand);

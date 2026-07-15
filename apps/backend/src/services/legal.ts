import { createHash, randomBytes, randomUUID } from 'crypto';
import {
  CURRENT_LEGAL_BUNDLE,
  LEGAL_ACCEPTANCE_STATEMENT,
  buildWalletLegalAcceptanceMessage,
  getCurrentLegalBundleActivationIssues,
  isCurrentLegalBundleActivationReady,
  type LegalDocumentEvidence,
} from '@taskmarket/shared';
import { and, eq, isNull } from 'drizzle-orm';
import { getAddress, recoverMessageAddress } from 'viem';

import { getServerConfig } from '../config/env';
import { db } from '../db/client';
import {
  legalAcceptanceChallenges,
  legalAcceptances,
  legalAccessReceipts,
  type LegalAcceptance,
} from '../db/schema';

export const LEGAL_RECEIPT_HEADER = 'x-taskmarket-legal-receipt';
export const LEGAL_ACCEPTANCE_REQUIRED_CODE = 'LEGAL_ACCEPTANCE_REQUIRED';
const CHALLENGE_TTL_MS = 10 * 60 * 1000;

type LegalDatabase = Pick<typeof db, 'select' | 'insert' | 'update'>;
type Database = LegalDatabase & Pick<typeof db, 'transaction'>;
type LegalSubjectType = 'privy_user' | 'wallet';
type LegalAcceptanceMethod = 'web_clickwrap' | 'wallet_signature';

export type LegalReceiptIdentity = {
  acceptanceId: string;
  subjectType: string;
  subjectId: string;
};

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function normalizeSubjectId(type: LegalSubjectType, value: string): string {
  return type === 'wallet' ? getAddress(value).toLowerCase() : value.trim();
}

function legalDocumentEvidence(): LegalDocumentEvidence[] {
  return CURRENT_LEGAL_BUNDLE.documents.map((document) => ({
    contentHash: `sha256:${sha256(document.markdown)}`,
    title: document.title,
    type: document.type,
    version: document.version,
  }));
}

function legalDocumentUrl(webAppUrl: string, slug: string): string {
  return new URL(`/legal/${slug}`, webAppUrl).toString();
}

export function getCurrentLegalBundle() {
  const config = getServerConfig();
  const evidence = legalDocumentEvidence();

  return {
    acceptanceAvailable: isCurrentLegalBundleActivationReady(),
    acceptanceStatement: LEGAL_ACCEPTANCE_STATEMENT,
    documents: CURRENT_LEGAL_BUNDLE.documents.map((document, index) => ({
      ...evidence[index],
      slug: document.slug,
      summary: document.summary,
      url: legalDocumentUrl(config.WEB_APP_URL, document.slug),
    })),
    effectiveAt: CURRENT_LEGAL_BUNDLE.effectiveAt,
    enforcementEnabled: config.LEGAL_ENFORCEMENT_ENABLED,
    publishedAt: CURRENT_LEGAL_BUNDLE.publishedAt,
    status: CURRENT_LEGAL_BUNDLE.status,
    version: CURRENT_LEGAL_BUNDLE.version,
  };
}

export function assertLegalAcceptanceAvailable(bundleVersion: string): void {
  const activationIssues = getCurrentLegalBundleActivationIssues();
  if (activationIssues.length > 0) {
    throw new Error(
      `The current legal bundle is awaiting counsel approval: ${activationIssues.join('; ')}`
    );
  }
  if (bundleVersion !== CURRENT_LEGAL_BUNDLE.version) {
    throw new Error(`Legal bundle ${bundleVersion} is not current`);
  }
}

export async function createWalletLegalChallenge(
  database: LegalDatabase,
  walletAddress: string,
  now = new Date()
) {
  assertLegalAcceptanceAvailable(CURRENT_LEGAL_BUNDLE.version);
  const normalizedWallet = normalizeSubjectId('wallet', walletAddress);
  const nonce = randomUUID();
  const expiresAt = new Date(now.getTime() + CHALLENGE_TTL_MS);
  const message = buildWalletLegalAcceptanceMessage({
    bundleVersion: CURRENT_LEGAL_BUNDLE.version,
    documents: legalDocumentEvidence(),
    expiresAt: expiresAt.toISOString(),
    issuedAt: now.toISOString(),
    nonce,
    walletAddress: normalizedWallet,
  });

  await database
    .insert(legalAcceptanceChallenges)
    .values({
      bundleVersion: CURRENT_LEGAL_BUNDLE.version,
      createdAt: now,
      expiresAt,
      message,
      nonce,
      walletAddress: normalizedWallet,
    })
    .onConflictDoUpdate({
      set: {
        bundleVersion: CURRENT_LEGAL_BUNDLE.version,
        consumedAt: null,
        createdAt: now,
        expiresAt,
        message,
        nonce,
      },
      target: legalAcceptanceChallenges.walletAddress,
    });

  return {
    bundle: getCurrentLegalBundle(),
    expiresAt: expiresAt.toISOString(),
    issuedAt: now.toISOString(),
    message,
    nonce,
    walletAddress: normalizedWallet,
  };
}

async function findAcceptance(
  database: LegalDatabase,
  subjectType: LegalSubjectType,
  subjectId: string
): Promise<LegalAcceptance | undefined> {
  const rows = await database
    .select()
    .from(legalAcceptances)
    .where(
      and(
        eq(legalAcceptances.subjectType, subjectType),
        eq(legalAcceptances.subjectId, normalizeSubjectId(subjectType, subjectId)),
        eq(legalAcceptances.bundleVersion, CURRENT_LEGAL_BUNDLE.version)
      )
    )
    .limit(1);
  return rows[0];
}

async function issueLegalReceipt(
  database: LegalDatabase,
  acceptance: LegalAcceptance
): Promise<string> {
  const receipt = `tmlegal_${randomBytes(32).toString('base64url')}`;
  await database.insert(legalAccessReceipts).values({
    acceptanceId: acceptance.id,
    bundleVersion: acceptance.bundleVersion,
    id: randomUUID(),
    subjectId: acceptance.subjectId,
    subjectType: acceptance.subjectType,
    tokenHash: sha256(receipt),
  });
  return receipt;
}

export async function recordLegalAcceptance(
  database: LegalDatabase,
  input: {
    subjectType: LegalSubjectType;
    subjectId: string;
    acceptanceMethod: LegalAcceptanceMethod;
    signature?: string;
    challenge?: string;
    sessionId?: string;
    ipAddress?: string;
    userAgent?: string;
  }
) {
  const subjectId = normalizeSubjectId(input.subjectType, input.subjectId);
  await database
    .insert(legalAcceptances)
    .values({
      acceptanceMethod: input.acceptanceMethod,
      bundleVersion: CURRENT_LEGAL_BUNDLE.version,
      challenge: input.challenge,
      documentManifest: legalDocumentEvidence(),
      id: randomUUID(),
      ipAddress: input.ipAddress,
      sessionId: input.sessionId,
      signature: input.signature,
      statementText: LEGAL_ACCEPTANCE_STATEMENT,
      subjectId,
      subjectType: input.subjectType,
      userAgent: input.userAgent?.slice(0, 1024),
    })
    .onConflictDoNothing();

  const acceptance = await findAcceptance(database, input.subjectType, subjectId);
  if (!acceptance) {
    throw new Error('Unable to persist legal acceptance');
  }

  return {
    acceptance,
    receipt: await issueLegalReceipt(database, acceptance),
  };
}

export async function acceptWalletLegalTerms(
  database: Database,
  input: {
    walletAddress: string;
    bundleVersion: string;
    nonce: string;
    signature: `0x${string}`;
    ipAddress?: string;
    userAgent?: string;
  },
  now = new Date()
) {
  assertLegalAcceptanceAvailable(input.bundleVersion);
  const walletAddress = normalizeSubjectId('wallet', input.walletAddress);
  const rows = await database
    .select()
    .from(legalAcceptanceChallenges)
    .where(eq(legalAcceptanceChallenges.nonce, input.nonce))
    .limit(1);
  const challenge = rows[0];

  if (
    !challenge ||
    challenge.walletAddress !== walletAddress ||
    challenge.bundleVersion !== input.bundleVersion ||
    challenge.consumedAt ||
    challenge.expiresAt <= now
  ) {
    throw new Error('Legal acceptance challenge is invalid or expired');
  }

  const recovered = await recoverMessageAddress({
    message: challenge.message,
    signature: input.signature,
  });
  if (recovered.toLowerCase() !== walletAddress) {
    throw new Error('Legal acceptance signature does not match the wallet');
  }

  return database.transaction(async (tx) => {
    const consumed = await tx
      .update(legalAcceptanceChallenges)
      .set({ consumedAt: now })
      .where(
        and(
          eq(legalAcceptanceChallenges.nonce, input.nonce),
          isNull(legalAcceptanceChallenges.consumedAt)
        )
      )
      .returning({ nonce: legalAcceptanceChallenges.nonce });
    if (!consumed[0]) {
      throw new Error('Legal acceptance challenge has already been used');
    }

    return recordLegalAcceptance(tx, {
      acceptanceMethod: 'wallet_signature',
      challenge: challenge.message,
      ipAddress: input.ipAddress,
      signature: input.signature,
      subjectId: walletAddress,
      subjectType: 'wallet',
      userAgent: input.userAgent,
    });
  });
}

export async function getLegalAcceptanceForSubject(
  database: LegalDatabase,
  subjectType: LegalSubjectType,
  subjectId: string
) {
  return findAcceptance(database, subjectType, subjectId);
}

export async function reissueLegalReceipt(database: LegalDatabase, acceptance: LegalAcceptance) {
  return issueLegalReceipt(database, acceptance);
}

export async function verifyLegalReceipt(receipt: string): Promise<LegalReceiptIdentity | null> {
  if (!receipt || receipt.length > 256) return null;
  const rows = await db
    .select()
    .from(legalAccessReceipts)
    .where(
      and(
        eq(legalAccessReceipts.tokenHash, sha256(receipt)),
        eq(legalAccessReceipts.bundleVersion, CURRENT_LEGAL_BUNDLE.version),
        isNull(legalAccessReceipts.revokedAt)
      )
    )
    .limit(1);
  const row = rows[0];
  if (!row) return null;

  await db
    .update(legalAccessReceipts)
    .set({ lastUsedAt: new Date() })
    .where(eq(legalAccessReceipts.id, row.id));

  return {
    acceptanceId: row.acceptanceId,
    subjectId: row.subjectId,
    subjectType: row.subjectType,
  };
}

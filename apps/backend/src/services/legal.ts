import { randomBytes, randomUUID } from 'crypto';
import {
  CURRENT_LEGAL_BUNDLE,
  LEGAL_BUNDLES,
  LEGAL_ACCEPTANCE_STATEMENT,
  buildWalletLegalAcceptanceMessage,
  getCurrentLegalBundleActivationIssues,
  isCurrentLegalBundleActivationReady,
  type LegalDocumentEvidence,
  type LegalPolicyBundle,
} from '@taskmarket/shared';
import { and, eq, isNull } from 'drizzle-orm';
import { getAddress } from 'viem';

import { getServerConfig } from '../config/env';
import { db } from '../db/client';
import { sha256Hex } from '../lib/hash';
import { verifySignedAddressOrThrow } from '../lib/agents';
import {
  legalAcceptanceChallenges,
  legalAcceptances,
  legalAccessReceipts,
  type LegalAcceptance,
} from '../db/schema';

export const LEGAL_ACCEPTANCE_REQUIRED_CODE = 'LEGAL_ACCEPTANCE_REQUIRED';
const CHALLENGE_TTL_MS = 10 * 60 * 1000;

type LegalDatabase = Pick<typeof db, 'select' | 'insert' | 'update'>;
type Database = LegalDatabase & Pick<typeof db, 'transaction'>;
type LegalSubjectType = 'privy_user' | 'wallet';
type LegalAcceptanceMethod = 'web_clickwrap' | 'wallet_signature';

type LegalEvidenceSnapshot = {
  acceptanceStatement: string;
  bundleDigest: string;
  documents: LegalDocumentEvidence[];
};

export type LegalReceiptIdentity = {
  acceptanceId: string;
  subjectType: string;
  subjectId: string;
};

function normalizeSubjectId(type: LegalSubjectType, value: string): string {
  return type === 'wallet' ? getAddress(value).toLowerCase() : value.trim();
}

function legalDocumentEvidence(
  bundle: LegalPolicyBundle = CURRENT_LEGAL_BUNDLE
): LegalDocumentEvidence[] {
  return bundle.documents.map((document) => ({
    contentHash: `sha256:${sha256Hex(document.markdown)}`,
    title: document.title,
    type: document.type,
    version: document.version,
  }));
}

function currentLegalEvidence(): LegalEvidenceSnapshot {
  const documents = legalDocumentEvidence();
  const digestPayload = JSON.stringify({
    acceptanceStatement: LEGAL_ACCEPTANCE_STATEMENT,
    documents,
    version: CURRENT_LEGAL_BUNDLE.version,
  });
  return {
    acceptanceStatement: LEGAL_ACCEPTANCE_STATEMENT,
    bundleDigest: `sha256:${sha256Hex(digestPayload)}`,
    documents,
  };
}

function legalDocumentUrl(
  backendUrl: string,
  version: string,
  slug: string,
  contentHash: string
): string {
  return new URL(
    `/legal-documents/${encodeURIComponent(version)}/${encodeURIComponent(slug)}/${encodeURIComponent(contentHash)}`,
    backendUrl
  ).toString();
}

export function getCurrentLegalBundle() {
  const config = getServerConfig();
  const evidence = currentLegalEvidence();

  return {
    acceptanceAvailable: isCurrentLegalBundleActivationReady(),
    acceptanceStatement: evidence.acceptanceStatement,
    bundleDigest: evidence.bundleDigest,
    documents: CURRENT_LEGAL_BUNDLE.documents.map((document, index) => ({
      ...evidence.documents[index],
      slug: document.slug,
      summary: document.summary,
      url: legalDocumentUrl(
        config.BACKEND_URL,
        CURRENT_LEGAL_BUNDLE.version,
        document.slug,
        evidence.documents[index].contentHash
      ),
    })),
    effectiveAt: CURRENT_LEGAL_BUNDLE.effectiveAt,
    enforcementEnabled: config.LEGAL_ENFORCEMENT_ENABLED,
    privyAppId: config.PRIVY_APP_ID ?? null,
    publishedAt: CURRENT_LEGAL_BUNDLE.publishedAt,
    status: CURRENT_LEGAL_BUNDLE.status,
    version: CURRENT_LEGAL_BUNDLE.version,
  };
}

export function getCurrentLegalDocument(
  version: string,
  slug: string,
  contentHash: string
): { contentHash: string; markdown: string; title: string; version: string } | null {
  const bundle = LEGAL_BUNDLES.find((item) => item.version === version);
  if (!bundle) return null;
  const documentIndex = bundle.documents.findIndex((item) => item.slug === slug);
  if (documentIndex < 0) return null;
  const document = bundle.documents[documentIndex];
  const evidence = legalDocumentEvidence(bundle)[documentIndex];
  if (contentHash !== evidence.contentHash) return null;
  return {
    contentHash: evidence.contentHash,
    markdown: document.markdown,
    title: document.title,
    version: document.version,
  };
}

export function assertLegalAcceptanceAvailable(bundleVersion: string, bundleDigest?: string): void {
  const activationIssues = getCurrentLegalBundleActivationIssues();
  if (activationIssues.length > 0) {
    throw new Error(
      `The current legal bundle is awaiting counsel approval: ${activationIssues.join('; ')}`
    );
  }
  if (bundleVersion !== CURRENT_LEGAL_BUNDLE.version) {
    throw new Error(`Legal bundle ${bundleVersion} is not current`);
  }
  if (bundleDigest && bundleDigest !== currentLegalEvidence().bundleDigest) {
    throw new Error('The legal bundle changed before acceptance was recorded');
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
  const evidence = currentLegalEvidence();
  const message = buildWalletLegalAcceptanceMessage({
    bundleVersion: CURRENT_LEGAL_BUNDLE.version,
    documents: evidence.documents,
    expiresAt: expiresAt.toISOString(),
    issuedAt: now.toISOString(),
    nonce,
    walletAddress: normalizedWallet,
  });

  await database.insert(legalAcceptanceChallenges).values({
    bundleDigest: evidence.bundleDigest,
    bundleVersion: CURRENT_LEGAL_BUNDLE.version,
    createdAt: now,
    documentManifest: evidence.documents,
    expiresAt,
    message,
    nonce,
    statementText: evidence.acceptanceStatement,
    walletAddress: normalizedWallet,
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
        eq(legalAcceptances.bundleVersion, CURRENT_LEGAL_BUNDLE.version),
        eq(legalAcceptances.bundleDigest, currentLegalEvidence().bundleDigest)
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
    bundleDigest: acceptance.bundleDigest,
    bundleVersion: acceptance.bundleVersion,
    id: randomUUID(),
    subjectId: acceptance.subjectId,
    subjectType: acceptance.subjectType,
    tokenHash: sha256Hex(receipt),
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
    evidence?: LegalEvidenceSnapshot;
  }
) {
  const subjectId = normalizeSubjectId(input.subjectType, input.subjectId);
  const evidence = input.evidence ?? currentLegalEvidence();
  assertLegalAcceptanceAvailable(CURRENT_LEGAL_BUNDLE.version, evidence.bundleDigest);
  await database
    .insert(legalAcceptances)
    .values({
      acceptanceMethod: input.acceptanceMethod,
      bundleDigest: evidence.bundleDigest,
      bundleVersion: CURRENT_LEGAL_BUNDLE.version,
      challenge: input.challenge,
      documentManifest: evidence.documents,
      id: randomUUID(),
      ipAddress: input.ipAddress,
      sessionId: input.sessionId,
      signature: input.signature,
      statementText: evidence.acceptanceStatement,
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
    bundleDigest: string;
    bundleVersion: string;
    nonce: string;
    signature: `0x${string}`;
    ipAddress?: string;
    userAgent?: string;
  },
  now = new Date()
) {
  assertLegalAcceptanceAvailable(input.bundleVersion, input.bundleDigest);
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
    challenge.bundleDigest !== input.bundleDigest ||
    challenge.bundleDigest !== currentLegalEvidence().bundleDigest ||
    challenge.consumedAt ||
    challenge.expiresAt <= now
  ) {
    throw new Error('Legal acceptance challenge is invalid or expired');
  }

  await verifySignedAddressOrThrow(challenge.message, input.signature, walletAddress, {
    invalid_signature: () => new Error('Invalid legal acceptance signature'),
    address_mismatch: () => new Error('Legal acceptance signature does not match the wallet'),
  });

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
      evidence: {
        acceptanceStatement: challenge.statementText,
        bundleDigest: challenge.bundleDigest,
        documents: challenge.documentManifest as LegalDocumentEvidence[],
      },
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
        eq(legalAccessReceipts.tokenHash, sha256Hex(receipt)),
        eq(legalAccessReceipts.bundleVersion, CURRENT_LEGAL_BUNDLE.version),
        eq(legalAccessReceipts.bundleDigest, currentLegalEvidence().bundleDigest),
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

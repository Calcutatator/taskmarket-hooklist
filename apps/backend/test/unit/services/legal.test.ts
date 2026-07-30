// Verifies: ADR-0010 (content-digest-invalidated legal acceptance)
import { createHash } from 'crypto';
import { CURRENT_LEGAL_BUNDLE } from '@taskmarket/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { privateKeyToAccount } from 'viem/accounts';

const { historicalMarkdown, historicalVersion } = vi.hoisted(() => ({
  historicalMarkdown: '# Historical Terms\n\nThese are the exact accepted terms.',
  historicalVersion: '2026-06',
}));

vi.mock('@taskmarket/shared', async () => {
  const actual = await vi.importActual<typeof import('@taskmarket/shared')>('@taskmarket/shared');
  const currentBundle = {
    ...actual.CURRENT_LEGAL_BUNDLE,
    effectiveAt: '2026-07-15T00:00:00.000Z',
    status: 'approved',
  };
  const historicalBundle = {
    ...actual.CURRENT_LEGAL_BUNDLE,
    version: historicalVersion,
    documents: actual.CURRENT_LEGAL_BUNDLE.documents.map((document) => ({
      ...document,
      markdown: document.slug === 'terms' ? historicalMarkdown : document.markdown,
      version: historicalVersion,
    })),
  };
  return {
    ...actual,
    CURRENT_LEGAL_BUNDLE: currentBundle,
    LEGAL_BUNDLES: [currentBundle, historicalBundle],
    getCurrentLegalBundleActivationIssues: () => [],
    isCurrentLegalBundleActivationReady: () => true,
  };
});

vi.mock('../../../src/config/env', () => ({
  getServerConfig: () => ({
    BACKEND_URL: 'https://api.taskmarket.example',
    LEGAL_ENFORCEMENT_ENABLED: true,
    PRIVY_APP_ID: 'server-privy-app-id',
    WEB_APP_URL: 'https://taskmarket.example',
  }),
}));

import {
  acceptWalletLegalTerms,
  assertLegalAcceptanceAvailable,
  createWalletLegalChallenge,
  getCurrentLegalBundle,
  getCurrentLegalDocument,
} from '../../../src/services/legal';
import { makeChain } from '../helpers';

const PRIVATE_KEY = `0x${'11'.repeat(32)}` as const;
const account = privateKeyToAccount(PRIVATE_KEY);

function database() {
  const db = {
    insert: vi.fn().mockReturnValue(makeChain()),
    select: vi.fn().mockReturnValue(makeChain([])),
    transaction: vi.fn(),
    update: vi.fn().mockReturnValue(makeChain([])),
  };
  db.transaction.mockImplementation(async (callback: (tx: typeof db) => Promise<unknown>) =>
    callback(db)
  );
  return db;
}

describe('wallet legal acceptance service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('serves each reviewed policy from its canonical hash-addressed backend URL', () => {
    const bundle = getCurrentLegalBundle();

    expect(bundle.privyAppId).toBe('server-privy-app-id');
    for (const document of bundle.documents) {
      const url = new URL(document.url);
      const [version, slug, contentHash] = url.pathname
        .replace('/legal-documents/', '')
        .split('/')
        .map(decodeURIComponent);
      const canonical = getCurrentLegalDocument(version, slug, contentHash);

      expect(url.origin).toBe('https://api.taskmarket.example');
      expect(canonical).toMatchObject({
        contentHash: document.contentHash,
        title: document.title,
        version: document.version,
      });
    }
  });

  it('keeps an accepted historical policy available at its canonical hash-addressed URL', () => {
    const contentHash = `sha256:${createHash('sha256').update(historicalMarkdown).digest('hex')}`;

    expect(getCurrentLegalDocument(historicalVersion, 'terms', contentHash)).toEqual({
      contentHash,
      markdown: historicalMarkdown,
      title: 'Terms of Service',
      version: historicalVersion,
    });
  });

  it('rejects a stale same-version bundle digest', () => {
    expect(() =>
      assertLegalAcceptanceAvailable(CURRENT_LEGAL_BUNDLE.version, `sha256:${'0'.repeat(64)}`)
    ).toThrow('changed before acceptance');
  });

  it('creates a short-lived challenge bound to the normalized wallet and all four documents', async () => {
    const db = database();
    const insert = makeChain();
    db.insert.mockReturnValue(insert);
    const now = new Date('2026-07-15T01:00:00.000Z');

    const challenge = await createWalletLegalChallenge(db as never, account.address, now);

    expect(challenge.walletAddress).toBe(account.address.toLowerCase());
    expect(challenge.issuedAt).toBe('2026-07-15T01:00:00.000Z');
    expect(challenge.expiresAt).toBe('2026-07-15T01:10:00.000Z');
    expect(challenge.bundle.documents).toHaveLength(4);
    expect(challenge.message).toContain(`Wallet: ${account.address.toLowerCase()}`);
    for (const document of challenge.bundle.documents) {
      expect(challenge.message).toContain(`${document.title} (${document.version})`);
      expect(challenge.message).toContain(document.contentHash);
    }
    expect(insert.values).toHaveBeenCalledWith(
      expect.objectContaining({
        bundleDigest: challenge.bundle.bundleDigest,
        documentManifest: challenge.bundle.documents.map(
          ({ contentHash, title, type, version }) => ({ contentHash, title, type, version })
        ),
        message: challenge.message,
        nonce: challenge.nonce,
        statementText: challenge.bundle.acceptanceStatement,
        walletAddress: account.address.toLowerCase(),
      })
    );
    expect(insert.onConflictDoUpdate).not.toHaveBeenCalled();
  });

  it('verifies the wallet signature, consumes the challenge once, and hashes the receipt', async () => {
    const db = database();
    const now = new Date('2026-07-15T01:00:00.000Z');
    const challengeInsert = makeChain();
    db.insert.mockReturnValueOnce(challengeInsert);
    const challenge = await createWalletLegalChallenge(db as never, account.address, now);
    const storedChallenge = {
      bundleDigest: challenge.bundle.bundleDigest,
      bundleVersion: challenge.bundle.version,
      consumedAt: null,
      documentManifest: challenge.bundle.documents,
      expiresAt: new Date(challenge.expiresAt),
      message: challenge.message,
      nonce: challenge.nonce,
      statementText: challenge.bundle.acceptanceStatement,
      walletAddress: challenge.walletAddress,
    };
    const signature = await account.signMessage({ message: challenge.message });
    const acceptance = {
      acceptanceMethod: 'wallet_signature',
      acceptedAt: now,
      bundleDigest: challenge.bundle.bundleDigest,
      bundleVersion: challenge.bundle.version,
      challenge: challenge.message,
      documentManifest: challenge.bundle.documents,
      id: 'acceptance-1',
      ipAddress: '203.0.113.10',
      sessionId: null,
      signature,
      statementText: challenge.bundle.acceptanceStatement,
      subjectId: account.address.toLowerCase(),
      subjectType: 'wallet',
      userAgent: 'taskmarket-cli',
    };

    db.select
      .mockReturnValueOnce(makeChain([storedChallenge]))
      .mockReturnValueOnce(makeChain([acceptance]));
    db.update.mockReturnValueOnce(makeChain([{ nonce: challenge.nonce }]));
    const acceptanceInsert = makeChain();
    const receiptInsert = makeChain();
    db.insert.mockReturnValueOnce(acceptanceInsert).mockReturnValueOnce(receiptInsert);

    const result = await acceptWalletLegalTerms(
      db as never,
      {
        bundleDigest: challenge.bundle.bundleDigest,
        bundleVersion: challenge.bundle.version,
        ipAddress: '203.0.113.10',
        nonce: challenge.nonce,
        signature,
        userAgent: 'taskmarket-cli',
        walletAddress: account.address,
      },
      now
    );

    expect(result.acceptance.id).toBe('acceptance-1');
    expect(result.receipt).toMatch(/^tmlegal_[A-Za-z0-9_-]{43}$/);
    expect(acceptanceInsert.values).toHaveBeenCalledWith(
      expect.objectContaining({
        challenge: challenge.message,
        signature,
        subjectId: account.address.toLowerCase(),
        subjectType: 'wallet',
      })
    );
    expect(receiptInsert.values).toHaveBeenCalledWith(
      expect.objectContaining({
        acceptanceId: 'acceptance-1',
        tokenHash: createHash('sha256').update(result.receipt).digest('hex'),
      })
    );
    expect(receiptInsert.values).not.toHaveBeenCalledWith(
      expect.objectContaining({ tokenHash: result.receipt })
    );
  });

  it('rejects a signature from a different wallet without consuming the challenge', async () => {
    const db = database();
    const now = new Date('2026-07-15T01:00:00.000Z');
    db.insert.mockReturnValueOnce(makeChain());
    const challenge = await createWalletLegalChallenge(db as never, account.address, now);
    const otherAccount = privateKeyToAccount(`0x${'22'.repeat(32)}`);
    const signature = await otherAccount.signMessage({ message: challenge.message });
    db.select.mockReturnValueOnce(
      makeChain([
        {
          bundleDigest: challenge.bundle.bundleDigest,
          bundleVersion: challenge.bundle.version,
          consumedAt: null,
          documentManifest: challenge.bundle.documents,
          expiresAt: new Date(challenge.expiresAt),
          message: challenge.message,
          nonce: challenge.nonce,
          statementText: challenge.bundle.acceptanceStatement,
          walletAddress: challenge.walletAddress,
        },
      ])
    );

    await expect(
      acceptWalletLegalTerms(
        db as never,
        {
          bundleDigest: challenge.bundle.bundleDigest,
          bundleVersion: challenge.bundle.version,
          nonce: challenge.nonce,
          signature,
          walletAddress: account.address,
        },
        now
      )
    ).rejects.toThrow('signature does not match');
    expect(db.transaction).not.toHaveBeenCalled();
    expect(db.update).not.toHaveBeenCalled();
  });

  it('rejects an expired challenge without consuming it', async () => {
    const db = database();
    const issuedAt = new Date('2026-07-15T01:00:00.000Z');
    db.insert.mockReturnValueOnce(makeChain());
    const challenge = await createWalletLegalChallenge(db as never, account.address, issuedAt);
    const signature = await account.signMessage({ message: challenge.message });
    db.select.mockReturnValueOnce(
      makeChain([
        {
          bundleDigest: challenge.bundle.bundleDigest,
          bundleVersion: challenge.bundle.version,
          consumedAt: null,
          documentManifest: challenge.bundle.documents,
          expiresAt: new Date(challenge.expiresAt),
          message: challenge.message,
          nonce: challenge.nonce,
          statementText: challenge.bundle.acceptanceStatement,
          walletAddress: challenge.walletAddress,
        },
      ])
    );

    await expect(
      acceptWalletLegalTerms(
        db as never,
        {
          bundleDigest: challenge.bundle.bundleDigest,
          bundleVersion: challenge.bundle.version,
          nonce: challenge.nonce,
          signature,
          walletAddress: account.address,
        },
        new Date(challenge.expiresAt)
      )
    ).rejects.toThrow('invalid or expired');
    expect(db.transaction).not.toHaveBeenCalled();
    expect(db.update).not.toHaveBeenCalled();
  });

  it('rejects a replay when another transaction consumed the nonce first', async () => {
    const db = database();
    const now = new Date('2026-07-15T01:00:00.000Z');
    db.insert.mockReturnValueOnce(makeChain());
    const challenge = await createWalletLegalChallenge(db as never, account.address, now);
    const signature = await account.signMessage({ message: challenge.message });
    db.select.mockReturnValueOnce(
      makeChain([
        {
          bundleDigest: challenge.bundle.bundleDigest,
          bundleVersion: challenge.bundle.version,
          consumedAt: null,
          documentManifest: challenge.bundle.documents,
          expiresAt: new Date(challenge.expiresAt),
          message: challenge.message,
          nonce: challenge.nonce,
          statementText: challenge.bundle.acceptanceStatement,
          walletAddress: challenge.walletAddress,
        },
      ])
    );
    db.update.mockReturnValueOnce(makeChain([]));

    await expect(
      acceptWalletLegalTerms(
        db as never,
        {
          bundleDigest: challenge.bundle.bundleDigest,
          bundleVersion: challenge.bundle.version,
          nonce: challenge.nonce,
          signature,
          walletAddress: account.address,
        },
        now
      )
    ).rejects.toThrow('already been used');
  });
});

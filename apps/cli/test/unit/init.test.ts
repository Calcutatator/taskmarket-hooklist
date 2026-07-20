import { buildWalletLegalAcceptanceMessage } from '@taskmarket/shared';
import { privateKeyToAccount } from 'viem/accounts';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  encryptPrivateKey: vi.fn(),
  generateKeypair: vi.fn(),
  keystoreExists: vi.fn(),
  loadKeystore: vi.fn(),
  pollAgentId: vi.fn(),
  printError: vi.fn(),
  printResult: vi.fn(),
  saveKeystore: vi.fn(),
}));

vi.mock('../../src/lib/api.js', () => ({
  API_ORIGIN: 'https://api.taskmarket.example',
  API_URL: 'https://api.taskmarket.example',
  apiGet: mocks.apiGet,
  apiPost: mocks.apiPost,
}));

vi.mock('../../src/lib/keystore.js', () => ({
  encryptPrivateKey: mocks.encryptPrivateKey,
  generateKeypair: mocks.generateKeypair,
  keystoreExists: mocks.keystoreExists,
  loadKeystore: mocks.loadKeystore,
  saveKeystore: mocks.saveKeystore,
}));

vi.mock('../../src/lib/agent.js', () => ({ pollAgentId: mocks.pollAgentId }));
vi.mock('../../src/lib/encryption.js', () => ({ deriveCompressedPublicKey: vi.fn(() => 'pub') }));
vi.mock('../../src/lib/output.js', () => ({
  printError: mocks.printError,
  printResult: mocks.printResult,
}));

import { initCommand } from '../../src/commands/init.js';
import { walletImportCommand } from '../../src/commands/wallet/import.js';

const privateKey = `0x${'1'.padStart(64, '0')}` as const;
const walletAddress = privateKeyToAccount(privateKey).address;
const bundle = {
  acceptanceAvailable: true,
  acceptanceStatement: 'I agree to the reviewed policies.',
  bundleDigest: `sha256:${'a'.repeat(64)}`,
  documents: [
    {
      contentHash: `sha256:${'b'.repeat(64)}`,
      slug: 'terms' as const,
      summary: 'Terms summary',
      title: 'Terms of Service',
      type: 'terms_of_service' as const,
      url: 'https://api.taskmarket.example/legal-documents/2026-07/terms/hash',
      version: '2026-07',
    },
  ],
  effectiveAt: '2026-07-15T00:00:00.000Z',
  enforcementEnabled: true,
  privyAppId: 'taskmarket-privy-app',
  publishedAt: '2026-07-01T00:00:00.000Z',
  status: 'approved' as const,
  version: '2026-07',
};

describe('init command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.keystoreExists.mockResolvedValue(false);
    mocks.generateKeypair.mockReturnValue({ privateKey, address: walletAddress });
    mocks.encryptPrivateKey.mockReturnValue('encrypted-key');
    mocks.pollAgentId.mockResolvedValue(null);
    mocks.apiGet.mockImplementation(async (path: string) => {
      if (path === '/api/legal/current') return bundle;
      throw new Error('unavailable');
    });
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  it('accepts the enforced legal bundle before registering a new device', async () => {
    const events: string[] = [];
    const issuedAt = '2026-07-15T01:00:00.000Z';
    const expiresAt = '2026-07-15T01:10:00.000Z';
    const nonce = '123e4567-e89b-42d3-a456-426614174000';
    const message = buildWalletLegalAcceptanceMessage({
      bundleVersion: bundle.version,
      documents: bundle.documents,
      expiresAt,
      issuedAt,
      nonce,
      walletAddress,
    });

    mocks.apiPost.mockImplementation(async (path: string, body: Record<string, unknown>) => {
      if (path === '/api/legal/challenge') {
        events.push('challenge');
        return { bundle, expiresAt, issuedAt, message, nonce, walletAddress };
      }
      if (path === '/api/legal/accept/wallet') {
        events.push('accept');
        expect(body.signature).toMatch(/^0x[0-9a-f]+$/);
        return {
          acceptedAt: issuedAt,
          bundleDigest: bundle.bundleDigest,
          bundleVersion: bundle.version,
          receipt: 'receipt-1',
        };
      }
      throw new Error(`Unexpected POST ${path}`);
    });

    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      events.push('register');
      expect(init?.redirect).toBe('error');
      expect(init?.headers).toMatchObject({
        'X-Taskmarket-Legal-Receipt': 'receipt-1',
      });
      return new Response(
        JSON.stringify({
          agentId: null,
          apiToken: 'api-token',
          deviceEncryptionKey: 'ab'.repeat(32),
          deviceId: 'device-1',
        }),
        { status: 200 }
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    await initCommand.parseAsync(['node', 'init', '--yes'], { from: 'node' });

    expect(events).toEqual(['challenge', 'accept', 'register']);
    expect(mocks.saveKeystore).toHaveBeenCalledWith(
      expect.objectContaining({
        legalAcceptanceApiOrigin: 'https://api.taskmarket.example',
        legalAcceptanceBundleVersion: bundle.version,
        legalAcceptanceReceipt: 'receipt-1',
      })
    );
  });
});

describe('wallet import command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.keystoreExists.mockResolvedValue(false);
    mocks.encryptPrivateKey.mockReturnValue('encrypted-key');
    mocks.pollAgentId.mockResolvedValue(null);
    mocks.apiGet.mockImplementation(async (path: string) => {
      if (path === '/api/legal/current') return bundle;
      throw new Error('unavailable');
    });
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  it('accepts the enforced legal bundle before registering an imported wallet', async () => {
    const events: string[] = [];
    const issuedAt = '2026-07-15T01:00:00.000Z';
    const expiresAt = '2026-07-15T01:10:00.000Z';
    const nonce = '123e4567-e89b-42d3-a456-426614174000';
    const message = buildWalletLegalAcceptanceMessage({
      bundleVersion: bundle.version,
      documents: bundle.documents,
      expiresAt,
      issuedAt,
      nonce,
      walletAddress,
    });

    mocks.apiPost.mockImplementation(async (path: string, body: Record<string, unknown>) => {
      if (path === '/api/legal/challenge') {
        events.push('challenge');
        return { bundle, expiresAt, issuedAt, message, nonce, walletAddress };
      }
      if (path === '/api/legal/accept/wallet') {
        events.push('accept');
        expect(body.signature).toMatch(/^0x[0-9a-f]+$/);
        return {
          acceptedAt: issuedAt,
          bundleDigest: bundle.bundleDigest,
          bundleVersion: bundle.version,
          receipt: 'receipt-1',
        };
      }
      throw new Error(`Unexpected POST ${path}`);
    });

    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
        events.push('register');
        expect(init?.redirect).toBe('error');
        expect(init?.headers).toMatchObject({
          'X-Taskmarket-Legal-Receipt': 'receipt-1',
        });
        return new Response(
          JSON.stringify({
            agentId: null,
            apiToken: 'api-token',
            deviceEncryptionKey: 'ab'.repeat(32),
            deviceId: 'device-1',
          }),
          { status: 200 }
        );
      })
    );

    await walletImportCommand.parseAsync(['node', 'import', '--key', privateKey, '--yes'], {
      from: 'node',
    });

    expect(events).toEqual(['challenge', 'accept', 'register']);
    expect(mocks.saveKeystore).toHaveBeenCalledWith(
      expect.objectContaining({
        legalAcceptanceApiOrigin: 'https://api.taskmarket.example',
        legalAcceptanceBundleVersion: bundle.version,
        legalAcceptanceReceipt: 'receipt-1',
      })
    );
  });
});

// Verifies: ADR-0018 (devices.register requires signature proof of address ownership)
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHash } from 'crypto';
import { createMockCtx, makeChain } from '../helpers';

vi.mock('../../../src/services/contract', () => ({
  contractRegisterIdentity: vi.fn().mockResolvedValue(42n),
}));

vi.mock('../../../src/config/env', () => ({
  getServerConfig: vi.fn().mockReturnValue({
    PLATFORM_MASTER_KEY: 'a'.repeat(64),
    NODE_ENV: 'test',
    ERC8004_IDENTITY_REGISTRY: '0x8004A818BFB912233c491871b3d84c89A494BD9e',
    CHAIN_ID: 84532,
  }),
  DEFAULT_PLATFORM_MASTER_KEY: '0'.repeat(64),
}));

vi.mock('viem', async (importOriginal) => {
  const actual = await importOriginal<typeof import('viem')>();
  return {
    ...actual,
    recoverMessageAddress: vi.fn(),
  };
});

import { devicesRouter } from '../../../src/routers/devices.router';
import { contractRegisterIdentity } from '../../../src/services/contract';
import { recoverMessageAddress } from 'viem';
import { getServerConfig } from '../../../src/config/env';

function sha256Hex(data: string): string {
  return createHash('sha256').update(data).digest('hex');
}

const WALLET = '0xWallet0000000000000000000000000000000001';
const SIGNATURE = '0xsignature';

function mockValidSignature() {
  vi.mocked(recoverMessageAddress).mockResolvedValueOnce(WALLET as `0x${string}`);
}

function makeDevice(overrides: Record<string, unknown> = {}) {
  return {
    id: 'test-device-id',
    apiTokenHash: sha256Hex('test-token'),
    walletAddress: WALLET,
    createdAt: new Date(),
    revokedAt: null,
    ...overrides,
  };
}

describe('devices router', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('register', () => {
    it('throws when signature is invalid', async () => {
      const ctx = createMockCtx();
      const caller = devicesRouter.createCaller(ctx);
      vi.mocked(recoverMessageAddress).mockRejectedValueOnce(new Error('invalid sig'));

      await expect(
        caller.register({ walletAddress: WALLET, signature: SIGNATURE })
      ).rejects.toThrow('Invalid signature');
    });

    it('throws when signature is from a different address', async () => {
      const ctx = createMockCtx();
      const caller = devicesRouter.createCaller(ctx);
      vi.mocked(recoverMessageAddress).mockResolvedValueOnce(
        '0xSomeoneElse0000000000000000000000000001' as `0x${string}`
      );

      await expect(
        caller.register({ walletAddress: WALLET, signature: SIGNATURE })
      ).rejects.toThrow('Signature does not match wallet address');
    });

    it('returns deviceId, apiToken, deviceEncryptionKey, and null agentId (registration is async)', async () => {
      const ctx = createMockCtx();
      // agents lookup returns empty (new wallet)
      ctx.db.select.mockReturnValueOnce(makeChain([]));
      const caller = devicesRouter.createCaller(ctx);
      mockValidSignature();

      const result = await caller.register({ walletAddress: WALLET, signature: SIGNATURE });

      expect(typeof result.deviceId).toBe('string');
      expect(result.deviceId).toHaveLength(36);
      expect(typeof result.apiToken).toBe('string');
      expect(result.apiToken).toHaveLength(64);
      expect(typeof result.deviceEncryptionKey).toBe('string');
      expect(result.deviceEncryptionKey).toHaveLength(64);
      // agentId is null on return — background job writes it asynchronously
      expect(result.agentId).toBeNull();
    });

    it('inserts device and registers new identity when wallet is new', async () => {
      const ctx = createMockCtx();
      ctx.db.select.mockReturnValueOnce(makeChain([]));
      const caller = devicesRouter.createCaller(ctx);
      mockValidSignature();

      await caller.register({ walletAddress: WALLET, signature: SIGNATURE });
      // Flush microtasks so the background .then() completes
      await Promise.resolve();

      // 3 inserts: devices, agent placeholder, agent update from background job
      expect(ctx.db.insert).toHaveBeenCalledTimes(3);
      expect(contractRegisterIdentity).toHaveBeenCalledOnce();
    });

    it('returns existing agentId without re-registering when wallet already has identity', async () => {
      const ctx = createMockCtx();
      // agents lookup returns existing agent
      ctx.db.select.mockReturnValueOnce(makeChain([{ agentId: '99' }]));
      const caller = devicesRouter.createCaller(ctx);
      mockValidSignature();

      const result = await caller.register({ walletAddress: WALLET, signature: SIGNATURE });

      expect(result.agentId).toBe('99');
      expect(contractRegisterIdentity).not.toHaveBeenCalled();
      expect(ctx.db.insert).toHaveBeenCalledTimes(1); // only devices, not agents
    });

    it('generates unique deviceId and apiToken on each call', async () => {
      const ctx = createMockCtx();
      ctx.db.select.mockReturnValueOnce(makeChain([])).mockReturnValueOnce(makeChain([]));
      const caller = devicesRouter.createCaller(ctx);
      const input = { walletAddress: WALLET, signature: SIGNATURE };
      mockValidSignature();
      mockValidSignature();

      const r1 = await caller.register(input);
      const r2 = await caller.register(input);

      expect(r1.apiToken).not.toBe(r2.apiToken);
      expect(r1.deviceId).not.toBe(r2.deviceId);
    });
  });

  describe('key', () => {
    it('throws when device is not found', async () => {
      const ctx = createMockCtx();
      ctx.db.select.mockReturnValueOnce(makeChain([]));
      const caller = devicesRouter.createCaller(ctx);

      await expect(caller.key({ deviceId: 'missing-id', apiToken: 'any-token' })).rejects.toThrow(
        'Device not found'
      );
    });

    it('throws when apiToken hash does not match', async () => {
      const ctx = createMockCtx();
      ctx.db.select.mockReturnValueOnce(makeChain([makeDevice({ apiTokenHash: 'wrong-hash' })]));
      const caller = devicesRouter.createCaller(ctx);

      await expect(
        caller.key({ deviceId: 'test-device-id', apiToken: 'test-token' })
      ).rejects.toThrow('Invalid token');
    });

    it('throws when device is revoked', async () => {
      const ctx = createMockCtx();
      ctx.db.select.mockReturnValueOnce(makeChain([makeDevice({ revokedAt: new Date() })]));
      const caller = devicesRouter.createCaller(ctx);

      await expect(
        caller.key({ deviceId: 'test-device-id', apiToken: 'test-token' })
      ).rejects.toThrow('Device has been revoked');
    });

    it('returns deviceEncryptionKey on valid token', async () => {
      const token = 'test-token';
      const ctx = createMockCtx();
      ctx.db.select.mockReturnValueOnce(
        makeChain([makeDevice({ apiTokenHash: sha256Hex(token) })])
      );
      const caller = devicesRouter.createCaller(ctx);

      const result = await caller.key({ deviceId: 'test-device-id', apiToken: token });

      expect(typeof result.deviceEncryptionKey).toBe('string');
      expect(result.deviceEncryptionKey).toHaveLength(64);
    });

    it('returns deterministic DEK for same deviceId', async () => {
      const token = 'test-token';
      const deviceId = 'test-device-id';
      const ctx1 = createMockCtx();
      const ctx2 = createMockCtx();
      ctx1.db.select.mockReturnValueOnce(
        makeChain([makeDevice({ apiTokenHash: sha256Hex(token) })])
      );
      ctx2.db.select.mockReturnValueOnce(
        makeChain([makeDevice({ apiTokenHash: sha256Hex(token) })])
      );

      const r1 = await devicesRouter.createCaller(ctx1).key({ deviceId, apiToken: token });
      const r2 = await devicesRouter.createCaller(ctx2).key({ deviceId, apiToken: token });

      expect(r1.deviceEncryptionKey).toBe(r2.deviceEncryptionKey);
    });

    it('refuses to derive a device encryption key from the default zero master key, regardless of NODE_ENV', async () => {
      // Simulates a self-hosted/staging deployment that never set PLATFORM_MASTER_KEY --
      // getServerConfig()'s own startup validation only rejects this for
      // NODE_ENV === 'production', so this guard must not depend on NODE_ENV at all.
      vi.mocked(getServerConfig).mockReturnValueOnce({
        PLATFORM_MASTER_KEY: '0'.repeat(64),
        NODE_ENV: 'development',
        ERC8004_IDENTITY_REGISTRY: '0x8004A818BFB912233c491871b3d84c89A494BD9e',
        CHAIN_ID: 84532,
      } as ReturnType<typeof getServerConfig>);
      const token = 'test-token';
      const ctx = createMockCtx();
      ctx.db.select.mockReturnValueOnce(
        makeChain([makeDevice({ apiTokenHash: sha256Hex(token) })])
      );
      const caller = devicesRouter.createCaller(ctx);

      await expect(
        caller.key({ deviceId: 'test-device-id', apiToken: token })
      ).rejects.toThrow('PLATFORM_MASTER_KEY is still the default zero key');
    });
  });

  describe('status', () => {
    it('throws when device is not found', async () => {
      const ctx = createMockCtx();
      ctx.db.select.mockReturnValueOnce(makeChain([]));
      const caller = devicesRouter.createCaller(ctx);

      await expect(
        caller.status({ deviceId: 'missing-id', apiToken: 'any-token' })
      ).rejects.toThrow('Device not found');
    });

    it('throws when apiToken does not match', async () => {
      const ctx = createMockCtx();
      ctx.db.select.mockReturnValueOnce(makeChain([makeDevice({ apiTokenHash: 'wrong-hash' })]));
      const caller = devicesRouter.createCaller(ctx);

      await expect(
        caller.status({ deviceId: 'test-device-id', apiToken: 'test-token' })
      ).rejects.toThrow('Invalid token');
    });

    it('returns active=true for non-revoked device', async () => {
      const token = 'test-token';
      const ctx = createMockCtx();
      ctx.db.select.mockReturnValueOnce(
        makeChain([makeDevice({ apiTokenHash: sha256Hex(token), revokedAt: null })])
      );
      const caller = devicesRouter.createCaller(ctx);

      const result = await caller.status({ deviceId: 'test-device-id', apiToken: token });

      expect(result.active).toBe(true);
      expect(result.walletAddress).toBe(WALLET);
    });

    it('returns active=false for revoked device', async () => {
      const token = 'test-token';
      const ctx = createMockCtx();
      ctx.db.select.mockReturnValueOnce(
        makeChain([makeDevice({ apiTokenHash: sha256Hex(token), revokedAt: new Date() })])
      );
      const caller = devicesRouter.createCaller(ctx);

      const result = await caller.status({ deviceId: 'test-device-id', apiToken: token });

      expect(result.active).toBe(false);
    });
  });
});

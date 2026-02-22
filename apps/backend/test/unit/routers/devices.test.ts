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
  }),
}));

import { devicesRouter } from '../../../src/routers/devices.router';
import { contractRegisterIdentity } from '../../../src/services/contract';

function sha256Hex(data: string): string {
  return createHash('sha256').update(data).digest('hex');
}

const WALLET = '0xWallet0000000000000000000000000000000001';

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
    it('returns deviceId, apiToken, deviceEncryptionKey, and agentId', async () => {
      const ctx = createMockCtx();
      // agents lookup returns empty (new wallet)
      ctx.db.select.mockReturnValueOnce(makeChain([]));
      const caller = devicesRouter.createCaller(ctx);

      const result = await caller.register({ walletAddress: WALLET });

      expect(typeof result.deviceId).toBe('string');
      expect(result.deviceId).toHaveLength(36);
      expect(typeof result.apiToken).toBe('string');
      expect(result.apiToken).toHaveLength(64);
      expect(typeof result.deviceEncryptionKey).toBe('string');
      expect(result.deviceEncryptionKey).toHaveLength(64);
      expect(result.agentId).toBe('42');
    });

    it('inserts device and registers new identity when wallet is new', async () => {
      const ctx = createMockCtx();
      ctx.db.select.mockReturnValueOnce(makeChain([]));
      const caller = devicesRouter.createCaller(ctx);

      await caller.register({ walletAddress: WALLET });

      expect(ctx.db.insert).toHaveBeenCalledTimes(2); // devices + agents
      expect(contractRegisterIdentity).toHaveBeenCalledOnce();
    });

    it('returns existing agentId without re-registering when wallet already has identity', async () => {
      const ctx = createMockCtx();
      // agents lookup returns existing agent
      ctx.db.select.mockReturnValueOnce(makeChain([{ agentId: '99' }]));
      const caller = devicesRouter.createCaller(ctx);

      const result = await caller.register({ walletAddress: WALLET });

      expect(result.agentId).toBe('99');
      expect(contractRegisterIdentity).not.toHaveBeenCalled();
      expect(ctx.db.insert).toHaveBeenCalledTimes(1); // only devices, not agents
    });

    it('generates unique deviceId and apiToken on each call', async () => {
      const ctx = createMockCtx();
      ctx.db.select
        .mockReturnValueOnce(makeChain([]))
        .mockReturnValueOnce(makeChain([]));
      const caller = devicesRouter.createCaller(ctx);
      const input = { walletAddress: WALLET };

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

      await expect(
        caller.key({ deviceId: 'missing-id', apiToken: 'any-token' })
      ).rejects.toThrow('Device not found');
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
      ctx.db.select.mockReturnValueOnce(
        makeChain([makeDevice({ revokedAt: new Date() })])
      );
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
      ctx1.db.select.mockReturnValueOnce(makeChain([makeDevice({ apiTokenHash: sha256Hex(token) })]));
      ctx2.db.select.mockReturnValueOnce(makeChain([makeDevice({ apiTokenHash: sha256Hex(token) })]));

      const r1 = await devicesRouter.createCaller(ctx1).key({ deviceId, apiToken: token });
      const r2 = await devicesRouter.createCaller(ctx2).key({ deviceId, apiToken: token });

      expect(r1.deviceEncryptionKey).toBe(r2.deviceEncryptionKey);
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

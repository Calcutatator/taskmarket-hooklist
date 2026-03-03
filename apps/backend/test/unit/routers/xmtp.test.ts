import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHash } from 'crypto';
import { createMockCtx, makeChain } from '../helpers';

vi.mock('../../../src/config/env', () => ({
  getServerConfig: vi.fn().mockReturnValue({
    XMTP_ENABLED: true,
    XMTP_POLICY_DEFAULT: 'allowlist',
    XMTP_STALE_INSTALLATION_MINUTES: 60,
    NODE_ENV: 'test',
    PLATFORM_MASTER_KEY: 'a'.repeat(64),
  }),
}));

import { xmtpRouter } from '../../../src/routers/xmtp.router';

function sha256Hex(data: string): string {
  return createHash('sha256').update(data).digest('hex');
}

const WALLET = '0x1111111111111111111111111111111111111111';
const DEVICE_ID = 'device-1';
const API_TOKEN = 'token-1';

function makeDevice(overrides: Record<string, unknown> = {}) {
  return {
    id: DEVICE_ID,
    apiTokenHash: sha256Hex(API_TOKEN),
    walletAddress: WALLET,
    createdAt: new Date(),
    revokedAt: null,
    ...overrides,
  };
}

describe('xmtp router', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('bootstraps XMTP metadata for a device', async () => {
    const ctx = createMockCtx();
    ctx.db.select.mockReturnValueOnce(makeChain([makeDevice()]));
    ctx.db.update.mockReturnValueOnce(makeChain([{ address: WALLET }]));

    const caller = xmtpRouter.createCaller(ctx);
    const result = await caller.bootstrap({
      deviceId: DEVICE_ID,
      apiToken: API_TOKEN,
      inboxId: 'inbox-1',
      installationId: 'install-1',
      dbPath: '/tmp/xmtp.db',
      clientVersion: '0.1.0',
    });

    expect(result.inboxId).toBe('inbox-1');
    expect(result.policyMode).toBe('allowlist');
    expect(ctx.db.insert).toHaveBeenCalled();
  });

  it('rejects bootstrap when existing inboxId mismatches', async () => {
    const ctx = createMockCtx();
    ctx.db.select.mockReturnValueOnce(makeChain([makeDevice()]));
    ctx.db.update.mockReturnValueOnce(makeChain([]));

    const caller = xmtpRouter.createCaller(ctx);

    await expect(
      caller.bootstrap({
        deviceId: DEVICE_ID,
        apiToken: API_TOKEN,
        inboxId: 'inbox-1',
        installationId: 'install-1',
      })
    ).rejects.toThrow('XMTP inbox mismatch');
  });

  it('rejects bootstrap when installationId belongs to another device/agent', async () => {
    const ctx = createMockCtx();
    ctx.db.select
      .mockReturnValueOnce(makeChain([makeDevice()]))
      .mockReturnValueOnce(
        makeChain([
          {
            installationId: 'install-1',
            agentAddress: '0x2222222222222222222222222222222222222222',
            deviceId: 'device-2',
            inboxId: 'inbox-foreign',
          },
        ])
      );
    ctx.db.update.mockReturnValueOnce(makeChain([{ address: WALLET }]));

    const caller = xmtpRouter.createCaller(ctx);

    await expect(
      caller.bootstrap({
        deviceId: DEVICE_ID,
        apiToken: API_TOKEN,
        inboxId: 'inbox-1',
        installationId: 'install-1',
      })
    ).rejects.toThrow('XMTP installation mismatch');
  });

  it('updates heartbeat for active installation', async () => {
    const ctx = createMockCtx();
    ctx.db.select.mockReturnValueOnce(makeChain([makeDevice()]));
    ctx.db.update
      .mockReturnValueOnce(makeChain([{ installationId: 'install-1' }]))
      .mockReturnValueOnce(makeChain([]));

    const caller = xmtpRouter.createCaller(ctx);
    const result = await caller.heartbeat({
      deviceId: DEVICE_ID,
      apiToken: API_TOKEN,
      installationId: 'install-1',
    });

    expect(result.ok).toBe(true);
    expect(ctx.db.update).toHaveBeenCalledTimes(2);
  });

  it('rejects heartbeat when installation does not belong to authenticated device', async () => {
    const ctx = createMockCtx();
    ctx.db.select.mockReturnValueOnce(makeChain([makeDevice()]));
    ctx.db.update.mockReturnValueOnce(makeChain([]));

    const caller = xmtpRouter.createCaller(ctx);

    await expect(
      caller.heartbeat({
        deviceId: DEVICE_ID,
        apiToken: API_TOKEN,
        installationId: 'install-foreign',
      })
    ).rejects.toThrow('Installation not found');
  });

  it('upserts and lists peer policies', async () => {
    const ctx = createMockCtx();
    ctx.db.select
      .mockReturnValueOnce(makeChain([makeDevice()]))
      .mockReturnValueOnce(makeChain([makeDevice()]))
      .mockReturnValueOnce(
        makeChain([
          {
            peerInboxId: 'peer-1',
            policy: 'allow',
            reason: null,
            updatedAt: new Date('2026-03-03T00:00:00.000Z'),
          },
        ])
      );

    const caller = xmtpRouter.createCaller(ctx);
    const upserted = await caller.setPeerPolicy({
      deviceId: DEVICE_ID,
      apiToken: API_TOKEN,
      peerInboxId: 'peer-1',
      policy: 'allow',
    });

    const listed = await caller.listPeerPolicies({
      deviceId: DEVICE_ID,
      apiToken: API_TOKEN,
    });

    expect(upserted.ok).toBe(true);
    expect(listed.policies).toHaveLength(1);
    expect(listed.policies[0].peerInboxId).toBe('peer-1');
  });

  it('status returns only active installations', async () => {
    const ctx = createMockCtx();
    ctx.req = { headers: { 'x-taskmarket-api-token': API_TOKEN } } as any;
    ctx.db.select
      .mockReturnValueOnce(makeChain([makeDevice()]))
      .mockReturnValueOnce(
        makeChain([
          {
            xmtpInboxId: 'inbox-1',
            xmtpEnabled: 1,
            xmtpLastSeenAt: new Date('2026-03-03T00:00:00.000Z'),
          },
        ])
      )
      .mockReturnValueOnce(
        makeChain([
          {
            installationId: 'install-active',
            status: 'active',
            lastSeenAt: new Date('2026-03-03T00:00:00.000Z'),
          },
          {
            installationId: 'install-revoked',
            status: 'revoked',
            lastSeenAt: new Date('2026-03-03T00:00:00.000Z'),
          },
        ])
      );

    const caller = xmtpRouter.createCaller(ctx);
    const result = await caller.status({ deviceId: DEVICE_ID });

    expect(result.activeInstallations).toHaveLength(1);
    expect(result.activeInstallations[0]?.installationId).toBe('install-active');
  });

  it('accepts api token from header for status query', async () => {
    const ctx = createMockCtx();
    ctx.req = { headers: { 'x-taskmarket-api-token': API_TOKEN } } as any;
    ctx.db.select
      .mockReturnValueOnce(makeChain([makeDevice()]))
      .mockReturnValueOnce(
        makeChain([
          {
            xmtpInboxId: 'inbox-1',
            xmtpEnabled: 1,
            xmtpLastSeenAt: new Date('2026-03-03T00:00:00.000Z'),
          },
        ])
      )
      .mockReturnValueOnce(makeChain([]));

    const caller = xmtpRouter.createCaller(ctx);
    const result = await caller.status({ deviceId: DEVICE_ID });

    expect(result.inboxId).toBe('inbox-1');
    expect(result.enabled).toBe(true);
  });

  it('resolves peer by address and by agentId', async () => {
    const ctx = createMockCtx();
    ctx.db.select
      .mockReturnValueOnce(makeChain([{ address: WALLET, xmtpInboxId: 'inbox-by-address' }]))
      .mockReturnValueOnce(makeChain([{ address: WALLET, xmtpInboxId: 'inbox-by-agent' }]));

    const caller = xmtpRouter.createCaller(ctx);

    const byAddress = await caller.resolvePeer({ address: WALLET });
    const byAgentId = await caller.resolvePeer({ agentId: '123' });

    expect(byAddress.inboxId).toBe('inbox-by-address');
    expect(byAgentId.inboxId).toBe('inbox-by-agent');
  });
});

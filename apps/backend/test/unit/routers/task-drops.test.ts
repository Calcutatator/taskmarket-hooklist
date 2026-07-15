import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TRPCError } from '@trpc/server';

vi.mock('../../../src/services/task-drops-email', () => ({
  sendOfficialTaskDropsWelcome: vi.fn().mockResolvedValue(undefined),
  sendTaskDropsWelcome: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../src/services/task-drop-announcements', () => ({
  announceOfficialTaskDrop: vi.fn().mockResolvedValue({
    announcedAt: new Date('2026-07-15T00:00:00.000Z'),
    alreadyAnnounced: false,
    failed: 0,
    pending: 0,
    sent: 2,
    total: 2,
  }),
}));

vi.mock('../../../src/services/task-drop-subscribe-rate-limit', () => ({
  enforceTaskDropSubscribeRateLimit: vi.fn().mockResolvedValue(undefined),
}));

const { OFFICIAL_WALLET } = vi.hoisted(() => ({
  OFFICIAL_WALLET: '0x2222222222222222222222222222222222222222',
}));

vi.mock('../../../src/config/env', () => ({
  getServerConfig: vi.fn().mockReturnValue({
    ADMIN_SECRET: 'test-admin-secret',
    OFFICIAL_TASK_DROP_OWNER_ADDRESSES: [OFFICIAL_WALLET],
  }),
}));

vi.mock('../../../src/lib/logger', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), http: vi.fn() },
}));

import { taskDropsRouter } from '../../../src/routers/task-drops.router';
import { announceOfficialTaskDrop } from '../../../src/services/task-drop-announcements';
import { enforceTaskDropSubscribeRateLimit } from '../../../src/services/task-drop-subscribe-rate-limit';
import {
  sendOfficialTaskDropsWelcome,
  sendTaskDropsWelcome,
} from '../../../src/services/task-drops-email';
import { createMockCtx, makeChain } from '../helpers';

const EMAIL = 'alice@example.com';
const WALLET = '0x1111111111111111111111111111111111111111';
const DROP_ID = 'drop-1';

function subscription(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sub-1',
    taskDropId: DROP_ID,
    email: EMAIL,
    walletAddress: null,
    agentAddress: null,
    scope: 'drop',
    source: 'first_run_panel',
    status: 'active',
    consentedAt: new Date('2026-01-01T00:00:00Z'),
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    unsubscribedAt: null,
    ...overrides,
  };
}

describe('taskDrops router', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('lists serialized drops owned by a wallet', async () => {
    const ctx = createMockCtx();
    ctx.db.select.mockReturnValueOnce(
      makeChain([
        {
          createdAt: new Date('2026-07-01T00:00:00.000Z'),
          announcedAt: null,
          description: 'Monthly growth work.',
          id: DROP_ID,
          name: 'Growth',
          ownerAddress: WALLET,
        },
      ])
    );

    const result = await taskDropsRouter.createCaller(ctx).listByOwner({ ownerAddress: WALLET });

    expect(result).toEqual([
      {
        createdAt: '2026-07-01T00:00:00.000Z',
        announcedAt: null,
        description: 'Monthly growth work.',
        id: DROP_ID,
        isOfficial: false,
        name: 'Growth',
        officialWalletAddress: WALLET,
        ownerAddress: WALLET,
      },
    ]);
  });

  it('gets a serialized drop and its tasks', async () => {
    const ctx = createMockCtx();
    ctx.db.select
      .mockReturnValueOnce(
        makeChain([
          {
            createdAt: new Date('2026-07-01T00:00:00.000Z'),
            announcedAt: null,
            description: null,
            id: DROP_ID,
            name: 'Growth',
            ownerAddress: WALLET,
          },
        ])
      )
      .mockReturnValueOnce(
        makeChain([
          {
            createdAt: new Date('2026-07-02T00:00:00.000Z'),
            description: 'Ship the onboarding flow',
            expiryTime: new Date('2026-07-09T00:00:00.000Z'),
            id: 'task-1',
            mode: 'bounty',
            reward: 1000000n,
            status: 'open',
            tags: ['frontend'],
          },
        ])
      );

    const result = await taskDropsRouter.createCaller(ctx).get({ taskDropId: DROP_ID });

    expect(result).toMatchObject({
      drop: { id: DROP_ID, name: 'Growth', officialWalletAddress: WALLET },
      tasks: [
        {
          createdAt: '2026-07-02T00:00:00.000Z',
          expiryTime: '2026-07-09T00:00:00.000Z',
          id: 'task-1',
          reward: '1000000',
        },
      ],
    });
  });

  it('marks drops owned by the configured publisher wallet as official', async () => {
    const ctx = createMockCtx();
    ctx.db.select.mockReturnValueOnce(
      makeChain([
        {
          announcedAt: new Date('2026-07-15T00:00:00.000Z'),
          createdAt: new Date('2026-07-01T00:00:00.000Z'),
          description: null,
          id: 'official-drop',
          name: 'Cosmos',
          ownerAddress: OFFICIAL_WALLET,
        },
      ])
    );

    const [drop] = await taskDropsRouter
      .createCaller(ctx)
      .listByOwner({ ownerAddress: OFFICIAL_WALLET });

    expect(drop).toMatchObject({
      announcedAt: '2026-07-15T00:00:00.000Z',
      isOfficial: true,
      officialWalletAddress: OFFICIAL_WALLET,
    });
  });

  it('returns null when a drop does not exist', async () => {
    const ctx = createMockCtx();
    ctx.db.select.mockReturnValueOnce(makeChain([]));

    await expect(taskDropsRouter.createCaller(ctx).get({ taskDropId: 'missing' })).resolves.toBeNull();
  });

  it('subscribes a new email address', async () => {
    const ctx = createMockCtx();
    ctx.db.select
      .mockReturnValueOnce(makeChain([{ id: DROP_ID, ownerAddress: WALLET }]))
      .mockReturnValueOnce(makeChain([]));
    ctx.db.insert.mockReturnValueOnce(makeChain());

    const result = await taskDropsRouter.createCaller(ctx).subscribe({
      taskDropId: DROP_ID,
      email: '  ALICE@Example.COM ',
      walletAddress: WALLET,
      source: 'drop_page',
    });

    expect(result).toEqual({
      alreadySubscribed: false,
      email: EMAIL,
      subscribed: true,
      scope: 'drop',
      taskDropId: DROP_ID,
    });
    expect(ctx.db.insert).toHaveBeenCalledTimes(1);
    expect(sendTaskDropsWelcome).toHaveBeenCalledWith(
      expect.objectContaining({
        db: ctx.db,
        subscription: expect.objectContaining({ email: EMAIL, status: 'active' }),
        taskDropId: DROP_ID,
      })
    );
  });

  it('treats an existing active subscription as idempotent success', async () => {
    const ctx = createMockCtx();
    ctx.db.select
      .mockReturnValueOnce(makeChain([{ id: DROP_ID, ownerAddress: WALLET }]))
      .mockReturnValueOnce(makeChain([subscription()]));

    const result = await taskDropsRouter.createCaller(ctx).subscribe({
      taskDropId: DROP_ID,
      email: EMAIL,
      source: 'agent_setup',
    });

    expect(result.alreadySubscribed).toBe(true);
    expect(result.subscribed).toBe(true);
    expect(result.taskDropId).toBe(DROP_ID);
    expect(ctx.db.insert).not.toHaveBeenCalled();
    expect(ctx.db.update).not.toHaveBeenCalled();
    expect(sendTaskDropsWelcome).not.toHaveBeenCalled();
  });

  it('treats a concurrent unique insert as idempotent success', async () => {
    const ctx = createMockCtx();
    ctx.db.select
      .mockReturnValueOnce(makeChain([{ id: DROP_ID, ownerAddress: WALLET }]))
      .mockReturnValueOnce(makeChain([]))
      .mockReturnValueOnce(makeChain([subscription()]));
    const conflict = Object.assign(new Error('duplicate key value'), { code: '23505' });
    ctx.db.insert.mockReturnValueOnce({
      values: vi.fn().mockRejectedValue(conflict),
    });

    const result = await taskDropsRouter.createCaller(ctx).subscribe({
      taskDropId: DROP_ID,
      email: EMAIL,
    });

    expect(result).toEqual({
      alreadySubscribed: true,
      email: EMAIL,
      subscribed: true,
      scope: 'drop',
      taskDropId: DROP_ID,
    });
    expect(sendTaskDropsWelcome).not.toHaveBeenCalled();
  });

  it('reactivates an unsubscribed email address', async () => {
    const ctx = createMockCtx();
    ctx.db.select
      .mockReturnValueOnce(makeChain([{ id: DROP_ID, ownerAddress: WALLET }]))
      .mockReturnValueOnce(
        makeChain([subscription({ status: 'unsubscribed', unsubscribedAt: new Date() })])
      );
    ctx.db.update.mockReturnValueOnce(makeChain());

    const result = await taskDropsRouter.createCaller(ctx).subscribe({
      taskDropId: DROP_ID,
      email: EMAIL,
      source: 'account',
    });

    expect(result.alreadySubscribed).toBe(false);
    expect(result.subscribed).toBe(true);
    expect(ctx.db.update).toHaveBeenCalledTimes(1);
    expect(sendTaskDropsWelcome).toHaveBeenCalledWith(
      expect.objectContaining({
        db: ctx.db,
        subscription: expect.objectContaining({ id: 'sub-1', status: 'active' }),
        taskDropId: DROP_ID,
      })
    );
  });

  it('rejects exact subscription to an official drop', async () => {
    const ctx = createMockCtx();
    ctx.db.select.mockReturnValueOnce(
      makeChain([{ id: DROP_ID, ownerAddress: OFFICIAL_WALLET }])
    );

    await expect(
      taskDropsRouter.createCaller(ctx).subscribe({ taskDropId: DROP_ID, email: EMAIL })
    ).rejects.toThrow('Subscribe to all official Task Drops instead');
  });

  it('subscribes to all official drops and supersedes exact official subscriptions', async () => {
    const ctx = createMockCtx();
    ctx.db.select.mockReturnValueOnce(makeChain([]));
    ctx.db.insert.mockReturnValueOnce(makeChain());
    ctx.db.update.mockReturnValueOnce(makeChain());

    const result = await taskDropsRouter.createCaller(ctx).subscribeOfficial({
      email: ' ALICE@Example.COM ',
      source: 'taskdrop_landing',
    });

    expect(result).toEqual({
      alreadySubscribed: false,
      email: EMAIL,
      scope: 'official',
      subscribed: true,
    });
    expect(ctx.db.transaction).toHaveBeenCalledTimes(1);
    expect(ctx.db.update).toHaveBeenCalledTimes(1);
    expect(sendOfficialTaskDropsWelcome).toHaveBeenCalledWith(
      expect.objectContaining({
        db: ctx.db,
        subscription: expect.objectContaining({ email: EMAIL, scope: 'official' }),
      })
    );
  });

  it('returns official-list status by exact email', async () => {
    const ctx = createMockCtx();
    ctx.db.select.mockReturnValueOnce(makeChain([subscription({ scope: 'official', taskDropId: null })]));

    const result = await taskDropsRouter.createCaller(ctx).officialStatus({ email: EMAIL });

    expect(result).toEqual({ scope: 'official', subscribed: true });
  });

  it('treats an active official subscription as idempotent success', async () => {
    const ctx = createMockCtx();
    ctx.db.select.mockReturnValueOnce(
      makeChain([subscription({ scope: 'official', taskDropId: null })])
    );

    const result = await taskDropsRouter.createCaller(ctx).subscribeOfficial({ email: EMAIL });

    expect(result).toEqual({
      alreadySubscribed: true,
      email: EMAIL,
      scope: 'official',
      subscribed: true,
    });
    expect(ctx.db.transaction).not.toHaveBeenCalled();
    expect(sendOfficialTaskDropsWelcome).not.toHaveBeenCalled();
  });

  it('reactivates an unsubscribed official-list subscription', async () => {
    const ctx = createMockCtx();
    const inactive = subscription({
      scope: 'official',
      status: 'unsubscribed',
      taskDropId: null,
      unsubscribedAt: new Date(),
    });
    ctx.db.select
      .mockReturnValueOnce(makeChain([inactive]))
      .mockReturnValueOnce(makeChain([inactive]));

    const result = await taskDropsRouter.createCaller(ctx).subscribeOfficial({ email: EMAIL });

    expect(result.alreadySubscribed).toBe(false);
    expect(ctx.db.transaction).toHaveBeenCalledOnce();
    expect(ctx.db.update).toHaveBeenCalledTimes(2);
    expect(sendOfficialTaskDropsWelcome).toHaveBeenCalledOnce();
  });

  it('treats a concurrent official signup as idempotent success', async () => {
    const ctx = createMockCtx();
    ctx.db.select
      .mockReturnValueOnce(makeChain([]))
      .mockReturnValueOnce(
        makeChain([subscription({ scope: 'official', taskDropId: null })])
      );
    const conflict = Object.assign(new Error('duplicate key value'), { code: '23505' });
    ctx.db.insert.mockReturnValueOnce({ values: vi.fn().mockRejectedValue(conflict) });

    const result = await taskDropsRouter.createCaller(ctx).subscribeOfficial({ email: EMAIL });

    expect(result.alreadySubscribed).toBe(true);
    expect(result.scope).toBe('official');
    expect(sendOfficialTaskDropsWelcome).not.toHaveBeenCalled();
  });

  it('announces an official drop for an authenticated admin', async () => {
    const ctx = createMockCtx();
    ctx.req.headers = { 'x-admin-secret': 'test-admin-secret' };
    ctx.db.select.mockReturnValueOnce(
      makeChain([
        {
          announcedAt: null,
          id: DROP_ID,
          ownerAddress: OFFICIAL_WALLET,
        },
      ])
    );

    const result = await taskDropsRouter.createCaller(ctx).announceOfficial({ taskDropId: DROP_ID });

    expect(result).toEqual({
      alreadyAnnounced: false,
      announcedAt: '2026-07-15T00:00:00.000Z',
      failed: 0,
      pending: 0,
      sent: 2,
      taskDropId: DROP_ID,
      total: 2,
    });
    expect(announceOfficialTaskDrop).toHaveBeenCalledWith({ db: ctx.db, taskDropId: DROP_ID });
  });

  it('rejects unauthorized and nonofficial announcement attempts', async () => {
    const unauthorizedCtx = createMockCtx();

    await expect(
      taskDropsRouter.createCaller(unauthorizedCtx).announceOfficial({ taskDropId: DROP_ID })
    ).rejects.toThrow('Invalid admin secret');

    const nonofficialCtx = createMockCtx();
    nonofficialCtx.req.headers = { 'x-admin-secret': 'test-admin-secret' };
    nonofficialCtx.db.select.mockReturnValueOnce(
      makeChain([{ announcedAt: null, id: DROP_ID, ownerAddress: WALLET }])
    );

    await expect(
      taskDropsRouter.createCaller(nonofficialCtx).announceOfficial({ taskDropId: DROP_ID })
    ).rejects.toThrow('Task drop is not official');
  });

  it('returns status by exact email', async () => {
    const ctx = createMockCtx();
    ctx.db.select.mockReturnValueOnce(makeChain([subscription()]));

    const result = await taskDropsRouter.createCaller(ctx).status({ taskDropId: DROP_ID, email: EMAIL });

    expect(result).toEqual({ scope: 'drop', subscribed: true, taskDropId: DROP_ID });
  });

  it('returns inactive status when lookup has no active subscription', async () => {
    const ctx = createMockCtx();
    ctx.db.select.mockReturnValueOnce(makeChain([]));

    const result = await taskDropsRouter.createCaller(ctx).status({
      taskDropId: DROP_ID,
      email: 'nobody@example.com',
    });

    expect(result).toEqual({ scope: null, subscribed: false, taskDropId: DROP_ID });
  });

  it('fails subscription when the drop does not exist', async () => {
    const ctx = createMockCtx();
    ctx.db.select.mockReturnValueOnce(makeChain([]));

    await expect(
      taskDropsRouter.createCaller(ctx).subscribe({
        taskDropId: 'missing-drop',
        email: EMAIL,
      })
    ).rejects.toThrow('Task drop not found');

    expect(ctx.db.insert).not.toHaveBeenCalled();
  });

  it('passes the client identity to the shared limiter before exact-drop signup', async () => {
    const ctx = createMockCtx();
    ctx.req.ip = '203.0.113.10';
    ctx.db.select
      .mockReturnValueOnce(makeChain([{ id: DROP_ID, ownerAddress: WALLET }]))
      .mockReturnValueOnce(makeChain([]));

    await taskDropsRouter.createCaller(ctx).subscribe({ taskDropId: DROP_ID, email: EMAIL });

    expect(enforceTaskDropSubscribeRateLimit).toHaveBeenCalledWith({
      clientAddress: '203.0.113.10',
      db: ctx.db,
      email: EMAIL,
    });
  });

  it('passes the client identity to the shared limiter before official-list signup', async () => {
    const ctx = createMockCtx();
    ctx.req.ip = '203.0.113.30';
    ctx.db.select.mockReturnValueOnce(makeChain([]));

    await taskDropsRouter.createCaller(ctx).subscribeOfficial({ email: 'official@example.com' });

    expect(enforceTaskDropSubscribeRateLimit).toHaveBeenCalledWith({
      clientAddress: '203.0.113.30',
      db: ctx.db,
      email: 'official@example.com',
    });
  });

  it('does not persist a subscription rejected by the shared limiter', async () => {
    vi.mocked(enforceTaskDropSubscribeRateLimit).mockRejectedValueOnce(
      new TRPCError({
        code: 'TOO_MANY_REQUESTS',
        message: 'Too many subscription attempts. Try again later.',
      })
    );
    const ctx = createMockCtx();
    ctx.req.ip = '203.0.113.20';
    ctx.db.select
      .mockReturnValueOnce(makeChain([{ id: DROP_ID, ownerAddress: WALLET }]))
      .mockReturnValueOnce(makeChain([]));

    await expect(
      taskDropsRouter.createCaller(ctx).subscribe({ taskDropId: DROP_ID, email: EMAIL })
    ).rejects.toMatchObject({ code: 'TOO_MANY_REQUESTS' });

    expect(ctx.db.insert).not.toHaveBeenCalled();
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/services/task-drops-email', () => ({
  sendTaskDropsWelcome: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../src/lib/logger', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), http: vi.fn() },
}));

import {
  _clearTaskDropSubscribeRateLimitForTests,
  taskDropsRouter,
} from '../../../src/routers/task-drops.router';
import { sendTaskDropsWelcome } from '../../../src/services/task-drops-email';
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
    source: 'first_run_panel',
    status: 'active',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    unsubscribedAt: null,
    ...overrides,
  };
}

describe('taskDrops router', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _clearTaskDropSubscribeRateLimitForTests();
  });

  it('lists serialized drops owned by a wallet', async () => {
    const ctx = createMockCtx();
    ctx.db.select.mockReturnValueOnce(
      makeChain([
        {
          createdAt: new Date('2026-07-01T00:00:00.000Z'),
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
        description: 'Monthly growth work.',
        id: DROP_ID,
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

  it('returns null when a drop does not exist', async () => {
    const ctx = createMockCtx();
    ctx.db.select.mockReturnValueOnce(makeChain([]));

    await expect(taskDropsRouter.createCaller(ctx).get({ taskDropId: 'missing' })).resolves.toBeNull();
  });

  it('subscribes a new email address', async () => {
    const ctx = createMockCtx();
    ctx.db.select.mockReturnValueOnce(makeChain([{ id: DROP_ID }])).mockReturnValueOnce(makeChain([]));
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
      .mockReturnValueOnce(makeChain([{ id: DROP_ID }]))
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
      .mockReturnValueOnce(makeChain([{ id: DROP_ID }]))
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
      taskDropId: DROP_ID,
    });
    expect(sendTaskDropsWelcome).not.toHaveBeenCalled();
  });

  it('reactivates an unsubscribed email address', async () => {
    const ctx = createMockCtx();
    ctx.db.select
      .mockReturnValueOnce(makeChain([{ id: DROP_ID }]))
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

  it('returns status by exact email', async () => {
    const ctx = createMockCtx();
    ctx.db.select.mockReturnValueOnce(makeChain([subscription()]));

    const result = await taskDropsRouter.createCaller(ctx).status({ taskDropId: DROP_ID, email: EMAIL });

    expect(result).toEqual({ subscribed: true, taskDropId: DROP_ID });
  });

  it('returns inactive status when lookup has no active subscription', async () => {
    const ctx = createMockCtx();
    ctx.db.select.mockReturnValueOnce(makeChain([]));

    const result = await taskDropsRouter.createCaller(ctx).status({
      taskDropId: DROP_ID,
      email: 'nobody@example.com',
    });

    expect(result).toEqual({ subscribed: false, taskDropId: DROP_ID });
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

  it('rate limits repeated subscription mail to one recipient', async () => {
    const subscribe = async (taskDropId: string) => {
      const ctx = createMockCtx();
      ctx.req.ip = '203.0.113.10';
      ctx.db.select
        .mockReturnValueOnce(makeChain([{ id: taskDropId }]))
        .mockReturnValueOnce(makeChain([]));
      ctx.db.insert.mockReturnValueOnce(makeChain());
      return taskDropsRouter.createCaller(ctx).subscribe({
        taskDropId,
        email: 'target@example.com',
      });
    };

    await subscribe('drop-rate-1');
    await subscribe('drop-rate-2');
    await subscribe('drop-rate-3');

    await expect(subscribe('drop-rate-4')).rejects.toMatchObject({ code: 'TOO_MANY_REQUESTS' });
  });

  it('rate limits subscription mail across recipients from one client', async () => {
    const subscribe = async (index: number) => {
      const ctx = createMockCtx();
      ctx.req.ip = '203.0.113.20';
      ctx.db.select
        .mockReturnValueOnce(makeChain([{ id: `drop-ip-${index}` }]))
        .mockReturnValueOnce(makeChain([]));
      ctx.db.insert.mockReturnValueOnce(makeChain());
      return taskDropsRouter.createCaller(ctx).subscribe({
        taskDropId: `drop-ip-${index}`,
        email: `target-${index}@example.com`,
      });
    };

    for (let index = 0; index < 10; index += 1) {
      await subscribe(index);
    }

    await expect(subscribe(10)).rejects.toMatchObject({ code: 'TOO_MANY_REQUESTS' });
  });
});

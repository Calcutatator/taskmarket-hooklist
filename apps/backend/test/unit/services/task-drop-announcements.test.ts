import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';

vi.mock('../../../src/services/task-drops-email', () => ({
  sendOfficialTaskDropAnnouncement: vi.fn().mockResolvedValue(undefined),
}));

import { announceOfficialTaskDrop } from '../../../src/services/task-drop-announcements';
import { sendOfficialTaskDropAnnouncement } from '../../../src/services/task-drops-email';
import { createMockCtx, makeChain } from '../helpers';

const dialect = new PgDialect();

const ANNOUNCED_AT = new Date('2026-07-15T00:00:00.000Z');
const CONSENTED_AT = new Date('2026-07-14T00:00:00.000Z');
const DROP_ID = 'drop-official';

const drop = {
  announcedAt: ANNOUNCED_AT,
  createdAt: new Date('2026-07-14T00:00:00.000Z'),
  description: 'A coordinated launch.',
  id: DROP_ID,
  name: 'Cosmos',
  ownerAddress: '0x2222222222222222222222222222222222222222',
};

function delivery(overrides: Record<string, unknown> = {}) {
  return {
    attempts: 0,
    email: 'alice@example.com',
    id: 'delivery-1',
    processingAt: null,
    scope: 'official',
    status: 'pending',
    subscriptionConsentedAt: CONSENTED_AT,
    subscriptionCurrentConsentedAt: CONSENTED_AT,
    subscriptionId: 'sub-1',
    subscriptionStatus: 'active',
    subscriptionTaskDropId: null,
    ...overrides,
  };
}

function mockClaimedDeliveryUpdates(ctx: ReturnType<typeof createMockCtx>, ids: string[]) {
  for (const id of ids) {
    ctx.db.update.mockReturnValueOnce(makeChain([{ id }])).mockReturnValueOnce(makeChain([]));
  }
}

describe('official Task Drop announcements', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('freezes the drop, snapshots active official subscribers, and sends once each', async () => {
    const ctx = createMockCtx();
    const insertChain = makeChain();
    ctx.db.select
      .mockReturnValueOnce(makeChain([{ announcedAt: null, id: DROP_ID }]))
      .mockReturnValueOnce(makeChain([]))
      .mockReturnValueOnce(
        makeChain([
          { consentedAt: new Date('2026-07-14T00:00:00.000Z'), id: 'sub-1' },
          { consentedAt: new Date('2026-07-14T00:00:00.000Z'), id: 'sub-2' },
        ])
      )
      .mockReturnValueOnce(makeChain([drop]))
      .mockReturnValueOnce(
        makeChain([{ description: 'Audit the docs', mode: 'bounty', reward: '25000000' }])
      )
      .mockReturnValueOnce(
        makeChain([
          delivery(),
          delivery({ email: 'bob@example.com', id: 'delivery-2', subscriptionId: 'sub-2' }),
        ])
      );
    ctx.db.update.mockReturnValueOnce(makeChain([{ announcedAt: ANNOUNCED_AT }]));
    mockClaimedDeliveryUpdates(ctx, ['delivery-1', 'delivery-2']);
    ctx.db.insert.mockReturnValueOnce(insertChain);

    const result = await announceOfficialTaskDrop({ db: ctx.db, taskDropId: DROP_ID });

    expect(result).toEqual({
      announcedAt: ANNOUNCED_AT,
      alreadyAnnounced: false,
      failed: 0,
      pending: 0,
      sent: 2,
      total: 2,
    });
    expect(insertChain.values).toHaveBeenCalledWith([
      expect.objectContaining({ status: 'pending', subscriptionId: 'sub-1', taskDropId: DROP_ID }),
      expect.objectContaining({ status: 'pending', subscriptionId: 'sub-2', taskDropId: DROP_ID }),
    ]);
    expect(sendOfficialTaskDropAnnouncement).toHaveBeenCalledTimes(2);
  });

  it('excludes unlisted tasks from the announcement snippet query (ADR-0014)', async () => {
    const ctx = createMockCtx();
    let taskWhereSql: SQL | undefined;
    const taskChain = makeChain([]);
    taskChain.where = vi.fn((arg: SQL) => {
      taskWhereSql = arg;
      return taskChain;
    });
    ctx.db.select
      .mockReturnValueOnce(makeChain([{ announcedAt: null, id: DROP_ID }]))
      .mockReturnValueOnce(makeChain([]))
      .mockReturnValueOnce(makeChain([]))
      .mockReturnValueOnce(makeChain([drop]))
      .mockReturnValueOnce(taskChain)
      .mockReturnValueOnce(makeChain([]));
    ctx.db.update.mockReturnValueOnce(makeChain([{ announcedAt: ANNOUNCED_AT }]));

    await announceOfficialTaskDrop({ db: ctx.db, taskDropId: DROP_ID });

    expect(taskWhereSql).toBeDefined();
    const { sql: whereSql, params } = dialect.sqlToQuery(taskWhereSql!);
    expect(whereSql).toContain('"task_visibility" not in');
    expect(params).toContain('unlisted');
    expect(params).toContain('private');
  });

  it('does not freeze a drop while a task creation is reserved', async () => {
    const ctx = createMockCtx();
    ctx.db.select
      .mockReturnValueOnce(makeChain([{ announcedAt: null, id: DROP_ID }]))
      .mockReturnValueOnce(makeChain([{ reservationId: 'reservation-pending' }]));
    ctx.db.update.mockReturnValueOnce(makeChain([{ announcedAt: ANNOUNCED_AT }]));

    await expect(announceOfficialTaskDrop({ db: ctx.db, taskDropId: DROP_ID })).rejects.toThrow(
      'Task drop has task creation in progress'
    );

    expect(sendOfficialTaskDropAnnouncement).not.toHaveBeenCalled();
  });

  it('excludes consent recorded after the announcement freeze time', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(ANNOUNCED_AT);
    try {
      const ctx = createMockCtx();
      ctx.db.select
        .mockReturnValueOnce(makeChain([{ announcedAt: null, id: DROP_ID }]))
        .mockReturnValueOnce(makeChain([]))
        .mockReturnValueOnce(
          makeChain([
            { consentedAt: new Date(ANNOUNCED_AT.getTime() + 1), id: 'late-subscription' },
          ])
        )
        .mockReturnValueOnce(makeChain([drop]))
        .mockReturnValueOnce(makeChain([]))
        .mockReturnValueOnce(makeChain([]));
      ctx.db.update.mockReturnValueOnce(makeChain([{ announcedAt: ANNOUNCED_AT }]));

      const result = await announceOfficialTaskDrop({ db: ctx.db, taskDropId: DROP_ID });

      expect(ctx.db.insert).not.toHaveBeenCalled();
      expect(sendOfficialTaskDropAnnouncement).not.toHaveBeenCalled();
      expect(result.total).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not snapshot subscribers again and retries only failed deliveries', async () => {
    const ctx = createMockCtx();
    ctx.db.select
      .mockReturnValueOnce(makeChain([{ announcedAt: ANNOUNCED_AT, id: DROP_ID }]))
      .mockReturnValueOnce(makeChain([drop]))
      .mockReturnValueOnce(makeChain([]))
      .mockReturnValueOnce(
        makeChain([
          delivery({ status: 'sent' }),
          delivery({
            attempts: 1,
            email: 'bob@example.com',
            id: 'delivery-2',
            status: 'failed',
            subscriptionId: 'sub-2',
          }),
        ])
      );
    mockClaimedDeliveryUpdates(ctx, ['delivery-2']);

    const result = await announceOfficialTaskDrop({ db: ctx.db, taskDropId: DROP_ID });

    expect(ctx.db.insert).not.toHaveBeenCalled();
    expect(sendOfficialTaskDropAnnouncement).toHaveBeenCalledOnce();
    expect(sendOfficialTaskDropAnnouncement).toHaveBeenCalledWith(
      expect.objectContaining({ subscription: expect.objectContaining({ id: 'sub-2' }) })
    );
    expect(result).toEqual({
      announcedAt: ANNOUNCED_AT,
      alreadyAnnounced: true,
      failed: 0,
      pending: 0,
      sent: 2,
      total: 2,
    });
  });

  it('skips recipients who unsubscribed after the snapshot', async () => {
    const ctx = createMockCtx();
    ctx.db.select
      .mockReturnValueOnce(makeChain([{ announcedAt: ANNOUNCED_AT, id: DROP_ID }]))
      .mockReturnValueOnce(makeChain([drop]))
      .mockReturnValueOnce(makeChain([]))
      .mockReturnValueOnce(makeChain([delivery({ subscriptionStatus: 'unsubscribed' })]));
    mockClaimedDeliveryUpdates(ctx, ['delivery-1']);

    const result = await announceOfficialTaskDrop({ db: ctx.db, taskDropId: DROP_ID });

    expect(sendOfficialTaskDropAnnouncement).not.toHaveBeenCalled();
    expect(result).toEqual({
      announcedAt: ANNOUNCED_AT,
      alreadyAnnounced: true,
      failed: 0,
      pending: 0,
      sent: 0,
      total: 1,
    });
  });

  it('skips a historical delivery after the subscription is reactivated', async () => {
    const ctx = createMockCtx();
    ctx.db.select
      .mockReturnValueOnce(makeChain([{ announcedAt: ANNOUNCED_AT, id: DROP_ID }]))
      .mockReturnValueOnce(makeChain([drop]))
      .mockReturnValueOnce(makeChain([]))
      .mockReturnValueOnce(
        makeChain([
          delivery({
            subscriptionCurrentConsentedAt: new Date('2026-07-16T00:00:00.000Z'),
          }),
        ])
      );
    mockClaimedDeliveryUpdates(ctx, ['delivery-1']);

    const result = await announceOfficialTaskDrop({ db: ctx.db, taskDropId: DROP_ID });

    expect(sendOfficialTaskDropAnnouncement).not.toHaveBeenCalled();
    expect(result).toEqual({
      announcedAt: ANNOUNCED_AT,
      alreadyAnnounced: true,
      failed: 0,
      pending: 0,
      sent: 0,
      total: 1,
    });
  });

  it('records a failed delivery so a later call can retry it', async () => {
    vi.mocked(sendOfficialTaskDropAnnouncement).mockRejectedValueOnce(new Error('mailer down'));
    const ctx = createMockCtx();
    ctx.db.select
      .mockReturnValueOnce(makeChain([{ announcedAt: ANNOUNCED_AT, id: DROP_ID }]))
      .mockReturnValueOnce(makeChain([drop]))
      .mockReturnValueOnce(makeChain([]))
      .mockReturnValueOnce(makeChain([delivery({ attempts: 1, status: 'failed' })]));
    mockClaimedDeliveryUpdates(ctx, ['delivery-1']);

    const result = await announceOfficialTaskDrop({ db: ctx.db, taskDropId: DROP_ID });

    expect(result).toEqual({
      announcedAt: ANNOUNCED_AT,
      alreadyAnnounced: true,
      failed: 1,
      pending: 0,
      sent: 0,
      total: 1,
    });
  });

  it('does not send when another retry already claimed the delivery', async () => {
    const ctx = createMockCtx();
    ctx.db.select
      .mockReturnValueOnce(makeChain([{ announcedAt: ANNOUNCED_AT, id: DROP_ID }]))
      .mockReturnValueOnce(makeChain([drop]))
      .mockReturnValueOnce(makeChain([]))
      .mockReturnValueOnce(makeChain([delivery()]));
    ctx.db.update.mockReturnValueOnce(makeChain([]));

    const result = await announceOfficialTaskDrop({ db: ctx.db, taskDropId: DROP_ID });

    expect(sendOfficialTaskDropAnnouncement).not.toHaveBeenCalled();
    expect(result.pending).toBe(1);
  });
});

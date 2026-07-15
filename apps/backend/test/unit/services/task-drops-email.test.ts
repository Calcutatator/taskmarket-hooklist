import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';

vi.mock('../../../src/config/env', () => ({
  getServerConfig: vi.fn().mockReturnValue({
    BACKEND_URL: 'https://api.taskmarket.example',
    EMAIL_DOMAIN: 'mail.taskmarket.xyz',
    PLATFORM_MASTER_KEY: 'test-master-key-that-is-at-least-32-chars',
    WEB_APP_URL: 'https://market.taskmarket.example',
  }),
}));

vi.mock('../../../src/services/mailer', () => ({
  sendEmail: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../src/lib/logger', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), http: vi.fn() },
}));

import {
  buildTaskDropsUnsubscribeUrl,
  createTaskDropsUnsubscribeToken,
  getTaskDropsUnsubscribeDetails,
  notifyTaskDropSubscribers,
  sendOfficialTaskDropAnnouncement,
  sendOfficialTaskDropsWelcome,
  sendTaskDropsWelcome,
  unsubscribeTaskDropsSubscription,
} from '../../../src/services/task-drops-email';
import { sendEmail } from '../../../src/services/mailer';
import { createMockCtx, makeChain } from '../helpers';

const TASK_ID = '0x' + 'a'.repeat(64);
const DROP_ID = 'drop-1';

function subscription(overrides: Record<string, unknown> = {}) {
  return {
    agentAddress: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    email: 'alice@example.com',
    id: 'sub-1',
    scope: 'drop',
    taskDropId: DROP_ID,
    source: 'first_run_panel',
    status: 'active',
    unsubscribedAt: null,
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    walletAddress: null,
    ...overrides,
  };
}

describe('task-drops-email service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sends a styled welcome email with unsubscribe metadata', async () => {
    const ctx = createMockCtx();
    ctx.db.select.mockReturnValueOnce(makeChain([{ id: DROP_ID, name: 'Docs QA' }]));

    await sendTaskDropsWelcome({ db: ctx.db, subscription: subscription(), taskDropId: DROP_ID });

    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        bodyHtml: expect.stringContaining('Docs QA'),
        bodyText: expect.stringContaining('DOCS QA'),
        db: ctx.db,
        from: 'noreply@mail.taskmarket.xyz',
        idempotencyKey: 'task-drops-welcome-drop-1-sub-1',
        subject: 'You are following Docs QA',
        tags: expect.arrayContaining([{ name: 'type', value: 'welcome' }]),
        to: 'alice@example.com',
      })
    );
  });

  it('sends one task drop email per active subscription', async () => {
    const ctx = createMockCtx();
    const subscriptionsChain = makeChain([
      subscription(),
      subscription({ email: 'bob@example.com', id: 'sub-2' }),
    ]);
    ctx.db.select
      .mockReturnValueOnce(makeChain([{ id: DROP_ID, name: 'Docs QA' }]))
      .mockReturnValueOnce(subscriptionsChain);

    const result = await notifyTaskDropSubscribers({
      db: ctx.db,
      taskDropId: DROP_ID,
      description: 'Build a dashboard',
      mode: 'bounty',
      reward: '25000000',
      tags: ['dashboard'],
      taskId: TASK_ID,
    });

    expect(result).toEqual({ failed: 0, sent: 2, total: 2 });
    expect(sendEmail).toHaveBeenCalledTimes(2);
    const whereArg = subscriptionsChain.where.mock.calls[0][0];
    const query = new PgDialect().sqlToQuery(whereArg);
    expect(query.sql).toContain('"subscription_scope" =');
    expect(query.params).toContain('drop');
    const firstEmail = vi.mocked(sendEmail).mock.calls[0][0];
    expect(firstEmail.bodyText).toContain('DOCS QA');
    expect(firstEmail).toEqual(
      expect.objectContaining({
        bodyHtml: expect.stringContaining('Build a dashboard'),
        bodyText: expect.stringContaining('View task'),
        idempotencyKey: `task-drop-${DROP_ID}-${TASK_ID}-sub-1`,
        subject: 'Docs QA: Build a dashboard',
        tags: expect.arrayContaining([{ name: 'type', value: 'new_task' }]),
        to: 'alice@example.com',
      })
    );
  });

  it('sends an official-list welcome with list-specific consent copy', async () => {
    const ctx = createMockCtx();

    await sendOfficialTaskDropsWelcome({
      consentAt: new Date('2026-07-15T00:00:00.000Z'),
      db: ctx.db,
      subscription: subscription({ scope: 'official', taskDropId: null }),
    });

    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        bodyText: expect.stringContaining('all official Task Drops'),
        idempotencyKey: 'official-task-drops-welcome-sub-1-1784073600000',
        subject: 'You are subscribed to official Task Drops',
        tags: expect.arrayContaining([{ name: 'type', value: 'official_welcome' }]),
      })
    );
  });

  it('sends a launch summary using a stable drop-and-subscription idempotency key', async () => {
    const ctx = createMockCtx();
    const announcedAt = new Date('2026-07-15T00:00:00.000Z');

    await sendOfficialTaskDropAnnouncement({
      announcedAt,
      db: ctx.db,
      drop: {
        announcedAt,
        createdAt: new Date('2026-07-14T00:00:00.000Z'),
        description: 'A coordinated launch.',
        id: DROP_ID,
        name: 'Cosmos',
        ownerAddress: '0x2222222222222222222222222222222222222222',
      },
      subscription: subscription({ scope: 'official', taskDropId: null }),
      tasks: [{ description: 'Audit the docs', mode: 'bounty', reward: '25000000' }],
    });

    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        bodyText: expect.stringContaining('Audit the docs'),
        idempotencyKey: `official-task-drop-announcement-${DROP_ID}-sub-1`,
        subject: 'Cosmos is live on Taskmarket',
        tags: expect.arrayContaining([{ name: 'type', value: 'official_announcement' }]),
        to: 'alice@example.com',
      })
    );
  });

  it('ignores legacy null-drop subscriptions when sending scoped task email', async () => {
    const ctx = createMockCtx();
    ctx.db.select.mockReturnValueOnce(makeChain([]));

    const result = await notifyTaskDropSubscribers({
      db: ctx.db,
      taskDropId: 'missing-drop',
      description: 'Build a dashboard',
      mode: 'bounty',
      reward: '25000000',
      tags: ['dashboard'],
      taskId: TASK_ID,
    });

    expect(result).toEqual({ failed: 0, sent: 0, total: 0 });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('builds and verifies unsubscribe tokens', () => {
    const row = subscription();
    const token = createTaskDropsUnsubscribeToken(row);
    const url = new URL(buildTaskDropsUnsubscribeUrl(row));

    expect(url.pathname).toBe('/task-drops/unsubscribe');
    expect(url.searchParams.get('id')).toBe('sub-1');
    expect(url.searchParams.get('token')).toBe(token);
  });

  it('reads valid official unsubscribe scope without mutating the subscription', async () => {
    const ctx = createMockCtx();
    const row = subscription({ scope: 'official', taskDropId: null });
    ctx.db.select.mockReturnValueOnce(makeChain([row]));

    const result = await getTaskDropsUnsubscribeDetails({
      db: ctx.db,
      id: row.id,
      token: createTaskDropsUnsubscribeToken(row),
    });

    expect(result).toEqual({ email: 'alice@example.com', scope: 'official' });
    expect(ctx.db.update).not.toHaveBeenCalled();
  });

  it('unsubscribes an active subscription with a valid token', async () => {
    const ctx = createMockCtx();
    const row = subscription();
    ctx.db.select.mockReturnValueOnce(makeChain([row]));

    const result = await unsubscribeTaskDropsSubscription({
      db: ctx.db,
      id: row.id,
      token: createTaskDropsUnsubscribeToken(row),
    });

    expect(result).toEqual({ email: 'alice@example.com', scope: 'drop', unsubscribed: true });
    expect(ctx.db.update).toHaveBeenCalledTimes(1);
  });

  it('reports official-list scope when an umbrella subscription is unsubscribed', async () => {
    const ctx = createMockCtx();
    const row = subscription({ scope: 'official', taskDropId: null });
    ctx.db.select.mockReturnValueOnce(makeChain([row]));

    const result = await unsubscribeTaskDropsSubscription({
      db: ctx.db,
      id: row.id,
      token: createTaskDropsUnsubscribeToken(row),
    });

    expect(result).toEqual({ email: 'alice@example.com', scope: 'official', unsubscribed: true });
  });

  it('rejects invalid unsubscribe tokens without updating', async () => {
    const ctx = createMockCtx();
    ctx.db.select.mockReturnValueOnce(makeChain([subscription()]));

    const result = await unsubscribeTaskDropsSubscription({
      db: ctx.db,
      id: 'sub-1',
      token: 'bad-token',
    });

    expect(result).toEqual({ email: '', scope: null, unsubscribed: false });
    expect(ctx.db.update).not.toHaveBeenCalled();
  });
});

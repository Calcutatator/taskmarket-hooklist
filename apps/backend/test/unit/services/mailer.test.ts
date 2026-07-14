import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/config/env', () => ({
  getServerConfig: vi.fn().mockReturnValue({
    EMAIL_DOMAIN: 'mail.taskmarket.xyz',
    EMAIL_WEBHOOK_SECRET: 'a-very-long-secret-that-is-at-least-32-chars',
    OUTBOUND_EMAIL_WORKER_URL: 'https://worker.taskmarket.example',
  }),
}));

import { sendEmail } from '../../../src/services/mailer';
import { createMockCtx, makeChain } from '../helpers';

describe('mailer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
      })
    );
  });

  it('sends html, text, tags, and idempotency metadata to the outbound worker', async () => {
    const ctx = createMockCtx();

    await sendEmail({
      bodyHtml: '<strong>Hello</strong>',
      bodyText: 'Hello',
      db: ctx.db,
      from: 'noreply@mail.taskmarket.xyz',
      idempotencyKey: 'email-key',
      subject: 'Hello',
      tags: [{ name: 'type', value: 'welcome' }],
      to: 'alice@example.com',
    });

    expect(fetch).toHaveBeenCalledWith(
      'https://worker.taskmarket.example/send',
      expect.objectContaining({
        body: JSON.stringify({
          bodyHtml: '<strong>Hello</strong>',
          bodyText: 'Hello',
          from: 'noreply@mail.taskmarket.xyz',
          idempotencyKey: 'email-key',
          subject: 'Hello',
          tags: [{ name: 'type', value: 'welcome' }],
          to: 'alice@example.com',
        }),
      })
    );
  });

  it('stores html when routing to an internal Taskmarket address', async () => {
    const ctx = createMockCtx();
    ctx.db.select.mockReturnValueOnce(makeChain([{ address: '0xagent' }]));

    await sendEmail({
      bodyHtml: '<strong>Hello</strong>',
      bodyText: 'Hello',
      db: ctx.db,
      from: 'noreply@mail.taskmarket.xyz',
      subject: 'Hello',
      to: 'agent@mail.taskmarket.xyz',
    });

    expect(ctx.db.insert).toHaveBeenCalledTimes(1);
    const insertChain = ctx.db.insert.mock.results[0].value;
    expect(insertChain.values).toHaveBeenCalledWith(
      expect.objectContaining({
        bodyHtml: '<strong>Hello</strong>',
        bodyText: 'Hello',
      })
    );
  });

  it('deduplicates internal delivery with the supplied idempotency key', async () => {
    const ctx = createMockCtx();
    ctx.db.select.mockReturnValueOnce(makeChain([{ address: '0xagent' }]));

    await sendEmail({
      bodyText: 'Hello',
      db: ctx.db,
      from: 'noreply@mail.taskmarket.xyz',
      idempotencyKey: 'task-drop-drop-1-task-1-sub-1',
      subject: 'Hello',
      to: 'agent@mail.taskmarket.xyz',
    });

    const insertChain = ctx.db.insert.mock.results[0].value;
    expect(insertChain.values).toHaveBeenCalledWith(
      expect.objectContaining({ messageId: 'task-drop-drop-1-task-1-sub-1' })
    );
    expect(insertChain.onConflictDoNothing).toHaveBeenCalledTimes(1);
  });
});

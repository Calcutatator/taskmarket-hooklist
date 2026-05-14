import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../src/services/xmtp-auth', () => ({
  authenticateXmtpDevice: vi.fn(),
}));

vi.mock('../../../src/services/mailer', () => ({
  sendEmail: vi.fn(),
}));

vi.mock('../../../src/config/env', () => ({
  getServerConfig: vi.fn().mockReturnValue({
    EMAIL_DOMAIN: 'mail.taskmarket.xyz',
    NODE_ENV: 'test',
    ADMIN_SECRET: 'test-secret-value-1234',
  }),
}));

import { emailsRouter } from '../../../src/routers/emails.router';
import { authenticateXmtpDevice } from '../../../src/services/xmtp-auth';
import { sendEmail } from '../../../src/services/mailer';
import { getServerConfig } from '../../../src/config/env';
import { createMockCtx, makeChain } from '../helpers';

const WALLET_A = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
const WALLET_B = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
const DEVICE_ID = 'device-1';
const API_TOKEN = 'token-1';
const EMAIL_A = 'alice@mail.taskmarket.xyz';
const EMAIL_B = 'bob@mail.taskmarket.xyz';

function makeEmail(overrides: Record<string, unknown> = {}) {
  return {
    id: 'email-1',
    messageId: null,
    fromAddress: EMAIL_A,
    toAddress: EMAIL_B,
    agentAddress: WALLET_B,
    subject: 'Hello',
    bodyText: 'Body',
    bodyHtml: null,
    isRead: 0,
    receivedAt: new Date('2025-01-01T00:00:00Z'),
    ...overrides,
  };
}

describe('emails router', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(authenticateXmtpDevice).mockResolvedValue({
      deviceId: DEVICE_ID,
      walletAddress: WALLET_B,
    });
  });

  describe('checkUsername', () => {
    it('returns available: true for a free valid username', async () => {
      const ctx = createMockCtx();
      ctx.db.select.mockReturnValueOnce(makeChain([]));
      const caller = emailsRouter.createCaller(ctx);
      const result = await caller.checkUsername({ username: 'alice' });
      expect(result.available).toBe(true);
    });

    it('returns available: false when username is taken', async () => {
      const ctx = createMockCtx();
      ctx.db.select.mockReturnValueOnce(makeChain([{ address: WALLET_A }]));
      const caller = emailsRouter.createCaller(ctx);
      const result = await caller.checkUsername({ username: 'alice' });
      expect(result.available).toBe(false);
    });

    it('returns available: false for invalid username format', async () => {
      const ctx = createMockCtx();
      const caller = emailsRouter.createCaller(ctx);
      const result = await caller.checkUsername({ username: '-invalid' });
      expect(result.available).toBe(false);
    });
  });

  describe('register', () => {
    it('registers a new email address', async () => {
      vi.mocked(authenticateXmtpDevice).mockResolvedValueOnce({
        deviceId: DEVICE_ID,
        walletAddress: WALLET_A,
      });
      const ctx = createMockCtx();
      // existing check: no emailAddress
      ctx.db.select.mockReturnValueOnce(makeChain([{ emailAddress: null }]));
      ctx.db.insert.mockReturnValueOnce(makeChain());

      const caller = emailsRouter.createCaller(ctx);
      const result = await caller.register({
        deviceId: DEVICE_ID,
        apiToken: API_TOKEN,
        username: 'alice',
      });
      expect(result.emailAddress).toBe('alice@mail.taskmarket.xyz');
    });

    it('throws CONFLICT if agent already has an email', async () => {
      vi.mocked(authenticateXmtpDevice).mockResolvedValueOnce({
        deviceId: DEVICE_ID,
        walletAddress: WALLET_A,
      });
      const ctx = createMockCtx();
      ctx.db.select.mockReturnValueOnce(
        makeChain([{ emailAddress: 'alice@mail.taskmarket.xyz' }])
      );

      const caller = emailsRouter.createCaller(ctx);
      await expect(
        caller.register({ deviceId: DEVICE_ID, apiToken: API_TOKEN, username: 'alice' })
      ).rejects.toMatchObject({ code: 'CONFLICT' });
    });

    it('throws BAD_REQUEST for invalid username format', async () => {
      vi.mocked(authenticateXmtpDevice).mockResolvedValueOnce({
        deviceId: DEVICE_ID,
        walletAddress: WALLET_A,
      });
      const ctx = createMockCtx();
      const caller = emailsRouter.createCaller(ctx);
      await expect(
        caller.register({ deviceId: DEVICE_ID, apiToken: API_TOKEN, username: 'ab' })
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    });
  });

  describe('list', () => {
    it('returns emails for the authenticated agent', async () => {
      const ctx = createMockCtx();
      ctx.db.select.mockReturnValueOnce(makeChain([makeEmail({ agentAddress: WALLET_B })]));

      const caller = emailsRouter.createCaller(ctx);
      const result = await caller.list({
        deviceId: DEVICE_ID,
        apiToken: API_TOKEN,
        limit: 10,
        offset: 0,
      });
      expect(result.emails).toHaveLength(1);
      expect(result.emails[0].fromAddress).toBe(EMAIL_A);
    });
  });

  describe('get', () => {
    it('returns email and marks it read', async () => {
      const ctx = createMockCtx();
      ctx.db.select.mockReturnValueOnce(makeChain([makeEmail({ isRead: 0 })]));
      ctx.db.update.mockReturnValueOnce(makeChain());

      const caller = emailsRouter.createCaller(ctx);
      const result = await caller.get({ deviceId: DEVICE_ID, apiToken: API_TOKEN, id: 'email-1' });
      expect(result.isRead).toBe(true);
    });

    it('throws NOT_FOUND when email does not exist', async () => {
      const ctx = createMockCtx();
      ctx.db.select.mockReturnValueOnce(makeChain([]));

      const caller = emailsRouter.createCaller(ctx);
      await expect(
        caller.get({ deviceId: DEVICE_ID, apiToken: API_TOKEN, id: 'nonexistent' })
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });

    it('throws FORBIDDEN when email belongs to another agent', async () => {
      const ctx = createMockCtx();
      ctx.db.select.mockReturnValueOnce(makeChain([makeEmail({ agentAddress: WALLET_A })]));

      const caller = emailsRouter.createCaller(ctx);
      await expect(
        caller.get({ deviceId: DEVICE_ID, apiToken: API_TOKEN, id: 'email-1' })
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });
  });

  describe('delete', () => {
    it('deletes an email the agent owns', async () => {
      const ctx = createMockCtx();
      ctx.db.select.mockReturnValueOnce(
        makeChain([{ agentAddress: WALLET_B }])
      );
      ctx.db.delete = vi.fn().mockReturnValue(makeChain());

      const caller = emailsRouter.createCaller(ctx);
      const result = await caller.delete({ deviceId: DEVICE_ID, apiToken: API_TOKEN, id: 'email-1' });
      expect(result.deleted).toBe(true);
    });

    it('throws FORBIDDEN when email belongs to another agent', async () => {
      const ctx = createMockCtx();
      ctx.db.select.mockReturnValueOnce(makeChain([{ agentAddress: WALLET_A }]));
      ctx.db.delete = vi.fn().mockReturnValue(makeChain());

      const caller = emailsRouter.createCaller(ctx);
      await expect(
        caller.delete({ deviceId: DEVICE_ID, apiToken: API_TOKEN, id: 'email-1' })
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });
  });

  describe('markRead', () => {
    it('marks email as read', async () => {
      const ctx = createMockCtx();
      ctx.db.select.mockReturnValueOnce(makeChain([{ agentAddress: WALLET_B }]));
      ctx.db.update.mockReturnValueOnce(makeChain());

      const caller = emailsRouter.createCaller(ctx);
      const result = await caller.markRead({
        deviceId: DEVICE_ID,
        apiToken: API_TOKEN,
        id: 'email-1',
        read: true,
      });
      expect(result.isRead).toBe(true);
    });

    it('marks email as unread', async () => {
      const ctx = createMockCtx();
      ctx.db.select.mockReturnValueOnce(makeChain([{ agentAddress: WALLET_B }]));
      ctx.db.update.mockReturnValueOnce(makeChain());

      const caller = emailsRouter.createCaller(ctx);
      const result = await caller.markRead({
        deviceId: DEVICE_ID,
        apiToken: API_TOKEN,
        id: 'email-1',
        read: false,
      });
      expect(result.isRead).toBe(false);
    });

    it('throws FORBIDDEN when email belongs to another agent', async () => {
      const ctx = createMockCtx();
      ctx.db.select.mockReturnValueOnce(makeChain([{ agentAddress: WALLET_A }]));

      const caller = emailsRouter.createCaller(ctx);
      await expect(
        caller.markRead({ deviceId: DEVICE_ID, apiToken: API_TOKEN, id: 'email-1', read: true })
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });
  });

  describe('send', () => {
    it('sends email when agent has an email address', async () => {
      vi.mocked(sendEmail).mockResolvedValueOnce(undefined);
      const ctx = createMockCtx();
      ctx.db.select.mockReturnValueOnce(makeChain([{ emailAddress: EMAIL_B }]));

      const caller = emailsRouter.createCaller(ctx);
      const result = await caller.send({
        deviceId: DEVICE_ID,
        apiToken: API_TOKEN,
        to: EMAIL_A,
        subject: 'Hello',
        bodyText: 'Hi there',
      });
      expect(result.sent).toBe(true);
      expect(sendEmail).toHaveBeenCalledOnce();
    });

    it('throws PRECONDITION_FAILED when agent has no email address', async () => {
      const ctx = createMockCtx();
      ctx.db.select.mockReturnValueOnce(makeChain([{ emailAddress: null }]));

      const caller = emailsRouter.createCaller(ctx);
      await expect(
        caller.send({
          deviceId: DEVICE_ID,
          apiToken: API_TOKEN,
          to: EMAIL_A,
          subject: 'Hello',
          bodyText: 'Hi',
        })
      ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
    });

    it('enforces rate limit of 100 sends per hour', async () => {
      const { _clearRateLimitForTests } = await import('../../../src/routers/emails.router');
      _clearRateLimitForTests();

      vi.mocked(sendEmail).mockResolvedValue(undefined);

      const ctx = createMockCtx();
      // Mock select to always return a valid emailAddress
      ctx.db.select.mockReturnValue(makeChain([{ emailAddress: EMAIL_B }]));

      const caller = emailsRouter.createCaller(ctx);

      // Send 100 emails
      for (let i = 0; i < 100; i++) {
        await caller.send({
          deviceId: DEVICE_ID,
          apiToken: API_TOKEN,
          to: `user${i}@example.com`,
          subject: 'Test',
          bodyText: 'body',
        });
      }

      // 101st should be rejected
      await expect(
        caller.send({
          deviceId: DEVICE_ID,
          apiToken: API_TOKEN,
          to: 'overflow@example.com',
          subject: 'Test',
          bodyText: 'body',
        })
      ).rejects.toMatchObject({ code: 'TOO_MANY_REQUESTS' });
    });
  });

  describe('broadcast', () => {

    it('sends to all agents with email addresses', async () => {
      vi.mocked(sendEmail).mockResolvedValue(undefined);
      const ctx = createMockCtx();
      ctx.req.headers = { 'x-admin-secret': 'test-secret-value-1234' };
      ctx.db.select.mockReturnValueOnce(
        makeChain([
          { address: WALLET_A, emailAddress: EMAIL_A },
          { address: WALLET_B, emailAddress: EMAIL_B },
        ])
      );

      const caller = emailsRouter.createCaller(ctx);
      const result = await caller.broadcast({
        subject: 'New vertical',
        body: '# Automobiles\n\nNew tasks available.',
      });
      expect(result.sent).toBe(2);
      expect(result.failed).toBe(0);
      expect(result.total).toBe(2);
      expect(sendEmail).toHaveBeenCalledTimes(2);
    });

    it('returns UNAUTHORIZED for wrong admin secret', async () => {
      const ctx = createMockCtx();
      ctx.req.headers = { 'x-admin-secret': 'wrong-secret' };
      const caller = emailsRouter.createCaller(ctx);
      await expect(
        caller.broadcast({ subject: 'Test', body: 'Body' })
      ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    });

    it('returns UNAUTHORIZED when ADMIN_SECRET is not configured', async () => {
      vi.mocked(getServerConfig).mockReturnValueOnce({
        EMAIL_DOMAIN: 'mail.taskmarket.xyz',
        NODE_ENV: 'test',
        ADMIN_SECRET: undefined,
      } as ReturnType<typeof getServerConfig>);

      const ctx = createMockCtx();
      ctx.req.headers = { 'x-admin-secret': 'any-secret' };
      const caller = emailsRouter.createCaller(ctx);
      await expect(
        caller.broadcast({ subject: 'Test', body: 'Body' })
      ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    });

    it('counts failed sends in the result', async () => {
      vi.mocked(sendEmail)
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('relay down'));
      const ctx = createMockCtx();
      ctx.req.headers = { 'x-admin-secret': 'test-secret-value-1234' };
      ctx.db.select.mockReturnValueOnce(
        makeChain([
          { address: WALLET_A, emailAddress: EMAIL_A },
          { address: WALLET_B, emailAddress: EMAIL_B },
        ])
      );

      const caller = emailsRouter.createCaller(ctx);
      const result = await caller.broadcast({
        subject: 'Test',
        body: 'Body',
      });
      expect(result.sent).toBe(1);
      expect(result.failed).toBe(1);
      expect(result.total).toBe(2);
    });

    it('returns zero counts when no agents have email addresses', async () => {
      const ctx = createMockCtx();
      ctx.req.headers = { 'x-admin-secret': 'test-secret-value-1234' };
      ctx.db.select.mockReturnValueOnce(makeChain([]));

      const caller = emailsRouter.createCaller(ctx);
      const result = await caller.broadcast({
        subject: 'Test',
        body: 'Body',
      });
      expect(result.sent).toBe(0);
      expect(result.failed).toBe(0);
      expect(result.total).toBe(0);
      expect(sendEmail).not.toHaveBeenCalled();
    });

    it('passes actorType filter as registeredVia condition', async () => {
      vi.mocked(sendEmail).mockResolvedValue(undefined);
      const ctx = createMockCtx();
      ctx.req.headers = { 'x-admin-secret': 'test-secret-value-1234' };
      ctx.db.select.mockReturnValueOnce(makeChain([]));

      const caller = emailsRouter.createCaller(ctx);
      const result = await caller.broadcast({
        subject: 'Agents only',
        body: 'Body',
        filters: { actorType: 'agent' },
      });
      expect(result.total).toBe(0);
    });
  });
});

import { router, publicProcedure } from '../trpc';
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { eq, desc, and } from 'drizzle-orm';
import { agents, emails } from '../db/schema';
import { authenticateXmtpDevice } from '../services/xmtp-auth';
import { sendEmail } from '../services/mailer';
import { selectTargetAgents } from '../services/agent-targeting';
import { getServerConfig } from '../config/env';
import { EmailSchema, BroadcastInputSchema, BroadcastResultSchema } from '@taskmarket/shared';

const USERNAME_RE = /^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$/;

function headerValue(v: string | string[] | undefined): string | undefined {
  if (Array.isArray(v)) return v[0];
  return v;
}

// In-memory sliding-window rate limiter: 100 sends per hour per agent
const sendTimestamps = new Map<string, number[]>();
const RATE_LIMIT = 100;
const RATE_WINDOW_MS = 60 * 60 * 1000;

// Exported for test use only
export function _clearRateLimitForTests(): void {
  sendTimestamps.clear();
}

function checkRateLimit(agentAddress: string): void {
  const now = Date.now();
  const cutoff = now - RATE_WINDOW_MS;
  const ts = (sendTimestamps.get(agentAddress) ?? []).filter((t) => t > cutoff);
  if (ts.length >= RATE_LIMIT) {
    throw new TRPCError({
      code: 'TOO_MANY_REQUESTS',
      message: 'Email rate limit exceeded (100 per hour)',
    });
  }
  ts.push(now);
  sendTimestamps.set(agentAddress, ts);
}

export const emailsRouter = router({
  checkUsername: publicProcedure
    .meta({
      openapi: {
        method: 'GET',
        path: '/emails/check-username',
        tags: ['Emails'],
        summary: 'Check if an email username is available',
      },
    })
    .input(z.object({ username: z.string() }))
    .output(z.object({ available: z.boolean() }))
    .query(async ({ input, ctx }) => {
      const config = getServerConfig();
      if (!USERNAME_RE.test(input.username)) {
        return { available: false };
      }
      const emailAddress = `${input.username}@${config.EMAIL_DOMAIN}`;
      const rows = await ctx.db
        .select({ address: agents.address })
        .from(agents)
        .where(eq(agents.emailAddress, emailAddress))
        .limit(1);
      return { available: rows.length === 0 };
    }),

  register: publicProcedure
    .meta({
      openapi: {
        method: 'POST',
        path: '/emails/register',
        tags: ['Emails'],
        summary: 'Register an email address for the authenticated agent',
      },
    })
    .input(z.object({ deviceId: z.string(), apiToken: z.string(), username: z.string() }))
    .output(z.object({ emailAddress: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const auth = await authenticateXmtpDevice(ctx, {
        deviceId: input.deviceId,
        apiToken: input.apiToken,
      });

      if (!USERNAME_RE.test(input.username)) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message:
            'Invalid username. Must be 3-30 characters, lowercase alphanumeric and hyphens only, cannot start or end with a hyphen.',
        });
      }

      const config = getServerConfig();
      const emailAddress = `${input.username}@${config.EMAIL_DOMAIN}`;

      const existing = await ctx.db
        .select({ emailAddress: agents.emailAddress })
        .from(agents)
        .where(eq(agents.address, auth.walletAddress))
        .limit(1);

      if (existing[0]?.emailAddress) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'Email address already registered. Changing it is not supported yet.',
        });
      }

      try {
        await ctx.db
          .insert(agents)
          .values({ address: auth.walletAddress, emailAddress })
          .onConflictDoUpdate({
            target: agents.address,
            set: { emailAddress, updatedAt: new Date() },
          });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('unique') || msg.includes('duplicate')) {
          throw new TRPCError({
            code: 'CONFLICT',
            message: `Email address ${emailAddress} is already taken.`,
          });
        }
        throw err;
      }

      return { emailAddress };
    }),

  list: publicProcedure
    .meta({
      openapi: {
        method: 'GET',
        path: '/emails/list',
        tags: ['Emails'],
        summary: 'List emails in the authenticated agent inbox',
      },
    })
    .input(
      z.object({
        deviceId: z.string(),
        apiToken: z.string(),
        limit: z.coerce.number().min(1).max(100).default(20),
        offset: z.coerce.number().min(0).default(0),
        unread: z.string().optional(),
      })
    )
    .output(z.object({ emails: z.array(EmailSchema) }))
    .query(async ({ input, ctx }) => {
      const auth = await authenticateXmtpDevice(ctx, {
        deviceId: input.deviceId,
        apiToken: input.apiToken,
      });

      const filters = [eq(emails.agentAddress, auth.walletAddress)];
      if (input.unread === 'true') {
        filters.push(eq(emails.isRead, 0));
      }

      const rows = await ctx.db
        .select()
        .from(emails)
        .where(and(...filters))
        .orderBy(desc(emails.receivedAt))
        .limit(input.limit)
        .offset(input.offset);

      return {
        emails: rows.map((r) => ({
          id: r.id,
          fromAddress: r.fromAddress,
          toAddress: r.toAddress,
          subject: r.subject,
          bodyText: r.bodyText,
          bodyHtml: r.bodyHtml,
          isRead: r.isRead === 1,
          receivedAt: r.receivedAt.toISOString(),
        })),
      };
    }),

  get: publicProcedure
    .meta({
      openapi: {
        method: 'GET',
        path: '/emails/get',
        tags: ['Emails'],
        summary: 'Get a single email and mark it as read',
      },
    })
    .input(z.object({ deviceId: z.string(), apiToken: z.string(), id: z.string() }))
    .output(EmailSchema)
    .query(async ({ input, ctx }) => {
      const auth = await authenticateXmtpDevice(ctx, {
        deviceId: input.deviceId,
        apiToken: input.apiToken,
      });

      const rows = await ctx.db.select().from(emails).where(eq(emails.id, input.id)).limit(1);

      if (!rows.length) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Email not found' });
      }

      const email = rows[0];
      if (email.agentAddress !== auth.walletAddress) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Access denied' });
      }

      if (email.isRead === 0) {
        await ctx.db.update(emails).set({ isRead: 1 }).where(eq(emails.id, input.id));
      }

      return {
        id: email.id,
        fromAddress: email.fromAddress,
        toAddress: email.toAddress,
        subject: email.subject,
        bodyText: email.bodyText,
        bodyHtml: email.bodyHtml,
        isRead: true,
        receivedAt: email.receivedAt.toISOString(),
      };
    }),

  send: publicProcedure
    .meta({
      openapi: {
        method: 'POST',
        path: '/emails/send',
        tags: ['Emails'],
        summary: 'Send an email from the authenticated agent',
      },
    })
    .input(
      z.object({
        deviceId: z.string(),
        apiToken: z.string(),
        to: z.string().email(),
        subject: z.string().min(1),
        bodyText: z.string().min(1),
      })
    )
    .output(z.object({ sent: z.boolean() }))
    .mutation(async ({ input, ctx }) => {
      const auth = await authenticateXmtpDevice(ctx, {
        deviceId: input.deviceId,
        apiToken: input.apiToken,
      });

      const agentRows = await ctx.db
        .select({ emailAddress: agents.emailAddress })
        .from(agents)
        .where(eq(agents.address, auth.walletAddress))
        .limit(1);

      const fromAddress = agentRows[0]?.emailAddress;
      if (!fromAddress) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'No email address registered. Run: taskmarket email register',
        });
      }

      checkRateLimit(auth.walletAddress);

      await sendEmail({
        db: ctx.db,
        from: fromAddress,
        to: input.to,
        subject: input.subject,
        bodyText: input.bodyText,
      });

      return { sent: true };
    }),

  delete: publicProcedure
    .meta({
      openapi: {
        method: 'POST',
        path: '/emails/delete',
        tags: ['Emails'],
        summary: 'Delete an email',
      },
    })
    .input(z.object({ deviceId: z.string(), apiToken: z.string(), id: z.string() }))
    .output(z.object({ deleted: z.boolean() }))
    .mutation(async ({ input, ctx }) => {
      const auth = await authenticateXmtpDevice(ctx, {
        deviceId: input.deviceId,
        apiToken: input.apiToken,
      });

      const rows = await ctx.db
        .select({ agentAddress: emails.agentAddress })
        .from(emails)
        .where(eq(emails.id, input.id))
        .limit(1);

      if (!rows.length) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Email not found' });
      }

      if (rows[0].agentAddress !== auth.walletAddress) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Access denied' });
      }

      await ctx.db.delete(emails).where(eq(emails.id, input.id));

      return { deleted: true };
    }),

  markRead: publicProcedure
    .meta({
      openapi: {
        method: 'POST',
        path: '/emails/mark-read',
        tags: ['Emails'],
        summary: 'Set read/unread status on an email',
      },
    })
    .input(
      z.object({
        deviceId: z.string(),
        apiToken: z.string(),
        id: z.string(),
        read: z.boolean(),
      })
    )
    .output(z.object({ id: z.string(), isRead: z.boolean() }))
    .mutation(async ({ input, ctx }) => {
      const auth = await authenticateXmtpDevice(ctx, {
        deviceId: input.deviceId,
        apiToken: input.apiToken,
      });

      const rows = await ctx.db
        .select({ agentAddress: emails.agentAddress })
        .from(emails)
        .where(eq(emails.id, input.id))
        .limit(1);

      if (!rows.length) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Email not found' });
      }

      if (rows[0].agentAddress !== auth.walletAddress) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Access denied' });
      }

      await ctx.db
        .update(emails)
        .set({ isRead: input.read ? 1 : 0 })
        .where(eq(emails.id, input.id));

      return { id: input.id, isRead: input.read };
    }),

  broadcast: publicProcedure
    .meta({
      openapi: {
        method: 'POST',
        path: '/emails/broadcast',
        tags: ['Emails'],
        summary: 'Send a broadcast email to all agents (admin only)',
      },
    })
    .input(BroadcastInputSchema)
    .output(BroadcastResultSchema)
    .mutation(async ({ input, ctx }) => {
      const config = getServerConfig();
      const adminSecret = headerValue(ctx.req.headers['x-admin-secret']);

      if (!config.ADMIN_SECRET || adminSecret !== config.ADMIN_SECRET) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Invalid admin secret' });
      }

      const recipients = await selectTargetAgents(ctx.db, input.filters);

      const fromAddress = `noreply@${config.EMAIL_DOMAIN}`;
      const CHUNK_SIZE = 50;
      let sent = 0;
      let failed = 0;

      for (let i = 0; i < recipients.length; i += CHUNK_SIZE) {
        const chunk = recipients.slice(i, i + CHUNK_SIZE);
        const results = await Promise.allSettled(
          chunk.map(async (recipient) => {
            await sendEmail({
              db: ctx.db,
              from: fromAddress,
              to: recipient.emailAddress,
              subject: input.subject,
              bodyText: input.body,
            });
          })
        );
        sent += results.filter((r) => r.status === 'fulfilled').length;
        failed += results.filter((r) => r.status === 'rejected').length;
      }

      return { sent, failed, total: recipients.length };
    }),
});

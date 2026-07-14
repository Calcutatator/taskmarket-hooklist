import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import { agents, emails } from '../db/schema';
import { getServerConfig } from '../config/env';
import { TRPCError } from '@trpc/server';
import type { db as DbType } from '../db/client';

type Db = typeof DbType;

export interface EmailTag {
  name: string;
  value: string;
}

export interface SendEmailOptions {
  db: Db;
  from: string;
  to: string;
  subject: string;
  bodyText: string;
  bodyHtml?: string;
  idempotencyKey?: string;
  tags?: EmailTag[];
}

export async function sendEmail(opts: SendEmailOptions): Promise<void> {
  const config = getServerConfig();
  const { bodyHtml, bodyText, db, from, idempotencyKey, subject, tags, to } = opts;

  const toNormalized = to.toLowerCase();

  if (toNormalized.endsWith(`@${config.EMAIL_DOMAIN}`)) {
    // Agent-to-agent: route directly via DB
    const agentRows = await db
      .select({ address: agents.address })
      .from(agents)
      .where(eq(agents.emailAddress, toNormalized))
      .limit(1);

    if (!agentRows.length) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: `No agent found with email address: ${to}`,
      });
    }

    const insert = db.insert(emails).values({
      id: randomUUID(),
      messageId: idempotencyKey ?? null,
      fromAddress: from,
      toAddress: toNormalized,
      agentAddress: agentRows[0].address,
      subject,
      bodyText,
      bodyHtml: bodyHtml ?? null,
      isRead: 0,
      receivedAt: new Date(),
    });

    if (idempotencyKey) {
      await insert.onConflictDoNothing();
    } else {
      await insert;
    }
    return;
  }

  // External: relay via Cloudflare Email Worker
  if (!config.OUTBOUND_EMAIL_WORKER_URL) {
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message: 'Outbound email is not configured. Set OUTBOUND_EMAIL_WORKER_URL.',
    });
  }

  const res = await fetch(`${config.OUTBOUND_EMAIL_WORKER_URL}/send`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Webhook-Secret': config.EMAIL_WEBHOOK_SECRET ?? '',
    },
    body: JSON.stringify({ bodyHtml, bodyText, from, idempotencyKey, subject, tags, to }),
  });

  if (!res.ok) {
    throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to send email' });
  }
}

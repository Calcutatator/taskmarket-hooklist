import nodemailer from 'nodemailer';
import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import { agents, emails } from '../db/schema';
import { getServerConfig, type Env } from '../config/env';
import { TRPCError } from '@trpc/server';
import type { db as DbType } from '../db/client';

type Db = typeof DbType;

let _transporter: nodemailer.Transporter | null = null;

function getTransporter(config: Env): nodemailer.Transporter {
  if (!_transporter) {
    _transporter = nodemailer.createTransport({
      host: config.SMTP_RELAY_HOST!,
      port: config.SMTP_RELAY_PORT,
      secure: false,
      auth:
        config.SMTP_RELAY_USER && config.SMTP_RELAY_PASS
          ? { user: config.SMTP_RELAY_USER, pass: config.SMTP_RELAY_PASS }
          : undefined,
    });
  }
  return _transporter;
}

export interface SendEmailOptions {
  db: Db;
  from: string;
  to: string;
  subject: string;
  bodyText: string;
}

export async function sendEmail(opts: SendEmailOptions): Promise<void> {
  const config = getServerConfig();
  const { db, from, to, subject, bodyText } = opts;

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

    await db.insert(emails).values({
      id: randomUUID(),
      messageId: null,
      fromAddress: from,
      toAddress: toNormalized,
      agentAddress: agentRows[0].address,
      subject,
      bodyText,
      bodyHtml: null,
      isRead: 0,
      receivedAt: new Date(),
    });
    return;
  }

  // External: relay via nodemailer
  if (!config.SMTP_RELAY_HOST) {
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message: 'Outbound SMTP relay is not configured. Set SMTP_RELAY_HOST to send external email.',
    });
  }

  const transporter = getTransporter(config);

  await transporter.sendMail({
    from,
    to,
    subject,
    text: bodyText,
  });
}

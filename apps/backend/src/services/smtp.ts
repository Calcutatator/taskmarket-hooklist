import { readFileSync } from 'fs';
import { SMTPServer, type SMTPServerOptions } from 'smtp-server';
import { simpleParser } from 'mailparser';
import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import { agents, emails } from '../db/schema';
import { logger } from '../lib/logger';
import { getServerConfig } from '../config/env';
import type { db as DbType } from '../db/client';

type Db = typeof DbType;

export function startSmtpServer(db: Db): void {
  const config = getServerConfig();

  const serverOptions: SMTPServerOptions = {
    secure: false,
    authOptional: true,
    disabledCommands: ['AUTH'],
    size: 10 * 1024 * 1024,
    onData(stream, session, callback) {
      let rawEmail = '';
      stream.on('data', (chunk: Buffer) => {
        rawEmail += chunk.toString();
      });
      stream.on('end', () => {
        handleInbound(db, rawEmail, session)
          .then(() => callback())
          .catch((err) => {
            logger.error('[smtp] inbound handler error', err);
            callback(err);
          });
      });
    },
  };

  if (config.SMTP_TLS_CERT && config.SMTP_TLS_KEY) {
    serverOptions.cert = readFileSync(config.SMTP_TLS_CERT);
    serverOptions.key = readFileSync(config.SMTP_TLS_KEY);
  }

  const server = new SMTPServer(serverOptions);

  server.listen(config.SMTP_PORT, () => {
    logger.info(`SMTP server listening on port ${config.SMTP_PORT}`);
  });

  server.on('error', (err) => {
    logger.error('[smtp] listen error', err);
  });
}

async function handleInbound(
  db: Db,
  rawEmail: string,
  session: { envelope: { rcptTo: Array<{ address: string }> } }
): Promise<void> {
  const parsed = await simpleParser(rawEmail);

  const messageId = typeof parsed.messageId === 'string' ? parsed.messageId : null;

  const fromAddress = parsed.from?.value?.[0]?.address ?? parsed.from?.text ?? '';

  for (const rcpt of session.envelope.rcptTo) {
    const toAddress = rcpt.address.toLowerCase();

    const agentRows = await db
      .select({ address: agents.address })
      .from(agents)
      .where(eq(agents.emailAddress, toAddress))
      .limit(1);

    if (!agentRows.length) {
      // Unknown recipient — silently skip
      continue;
    }

    await db
      .insert(emails)
      .values({
        id: randomUUID(),
        messageId: messageId ?? undefined,
        fromAddress,
        toAddress,
        agentAddress: agentRows[0].address,
        subject: parsed.subject ?? null,
        bodyText: parsed.text ?? null,
        bodyHtml: typeof parsed.html === 'string' ? parsed.html : null,
        isRead: 0,
        receivedAt: new Date(),
      })
      .onConflictDoNothing();
  }
}

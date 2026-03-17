import { timingSafeEqual } from 'crypto';
import type { Request, Response } from 'express';
import { EmailInboundHeadersSchema } from '@taskmarket/shared';
import { storeInboundEmail } from '../services/smtp';
import { getServerConfig } from '../config/env';
import { db } from '../db/client';
import { logger } from '../lib/logger';

export async function emailInboundHandler(req: Request, res: Response): Promise<void> {
  const parsed = EmailInboundHeadersSchema.safeParse(req.headers);
  if (!parsed.success) {
    res.status(400).json({ ok: false, error: 'Missing required headers' });
    return;
  }

  const config = getServerConfig();
  const secret = config.EMAIL_WEBHOOK_SECRET;
  const provided = parsed.data['x-webhook-secret'];
  let secretValid = false;
  if (secret && provided) {
    const secretBuf = Buffer.from(secret, 'utf8');
    const providedBuf = Buffer.from(provided, 'utf8');
    secretValid =
      secretBuf.length === providedBuf.length && timingSafeEqual(secretBuf, providedBuf);
  }
  if (!secretValid) {
    res.status(401).json({ ok: false, error: 'Invalid webhook secret' });
    return;
  }

  try {
    await storeInboundEmail(db, req.body as Buffer, [parsed.data['x-email-to']]);
  } catch (err) {
    logger.error('[emailInbound] storeInboundEmail error', err);
    res.status(500).json({ ok: false, error: 'Internal server error' });
    return;
  }

  res.json({ ok: true });
}

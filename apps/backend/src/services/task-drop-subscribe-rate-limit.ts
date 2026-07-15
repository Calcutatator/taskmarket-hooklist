import { createHash } from 'node:crypto';
import { TRPCError } from '@trpc/server';
import { sql } from 'drizzle-orm';

import type { db as DbType } from '../db/client';
import { taskDropSubscribeRateLimits } from '../db/schema';

type Db = typeof DbType;

const LIMIT_PER_EMAIL = 3;
const LIMIT_PER_CLIENT = 10;

function rateLimitKey(kind: 'client' | 'email', value: string): string {
  return createHash('sha256').update(`${kind}:${value.trim().toLowerCase()}`).digest('hex');
}

export async function enforceTaskDropSubscribeRateLimit(input: {
  clientAddress: string;
  db: Db;
  email: string;
}): Promise<void> {
  const now = new Date();

  await input.db.transaction(async (tx) => {
    const consume = async (key: string): Promise<number> => {
      const rows = await tx
        .insert(taskDropSubscribeRateLimits)
        .values({ attempts: 1, key, updatedAt: now, windowStartedAt: now })
        .onConflictDoUpdate({
          target: taskDropSubscribeRateLimits.key,
          set: {
            attempts: sql`CASE
              WHEN ${taskDropSubscribeRateLimits.windowStartedAt} <= CURRENT_TIMESTAMP - INTERVAL '1 hour' THEN 1
              ELSE ${taskDropSubscribeRateLimits.attempts} + 1
            END`,
            updatedAt: now,
            windowStartedAt: sql`CASE
              WHEN ${taskDropSubscribeRateLimits.windowStartedAt} <= CURRENT_TIMESTAMP - INTERVAL '1 hour'
                THEN CURRENT_TIMESTAMP
              ELSE ${taskDropSubscribeRateLimits.windowStartedAt}
            END`,
          },
        })
        .returning({ attempts: taskDropSubscribeRateLimits.attempts });

      if (!rows[0]) throw new Error('Subscription rate limit could not be recorded');
      return rows[0].attempts;
    };

    const emailAttempts = await consume(rateLimitKey('email', input.email));
    if (emailAttempts > LIMIT_PER_EMAIL) {
      throw new TRPCError({
        code: 'TOO_MANY_REQUESTS',
        message: 'Too many subscription attempts. Try again later.',
      });
    }

    const clientAttempts = await consume(rateLimitKey('client', input.clientAddress));
    if (clientAttempts > LIMIT_PER_CLIENT) {
      throw new TRPCError({
        code: 'TOO_MANY_REQUESTS',
        message: 'Too many subscription attempts. Try again later.',
      });
    }
  });
}

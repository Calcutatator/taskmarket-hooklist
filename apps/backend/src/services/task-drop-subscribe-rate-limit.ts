import { createHash } from 'node:crypto';
import { TRPCError } from '@trpc/server';

import type { db as DbType } from '../db/client';
import { taskDropSubscribeRateLimits } from '../db/schema';
import { SlidingWindowRecordError, consumeSlidingWindowAttempt } from '../lib/rate-limit';

type Db = typeof DbType;

const LIMIT_PER_EMAIL = 3;
const LIMIT_PER_CLIENT = 10;
const WINDOW_SECONDS = 60 * 60;

function rateLimitKey(kind: 'client' | 'email', value: string): string {
  return createHash('sha256').update(`${kind}:${value.trim().toLowerCase()}`).digest('hex');
}

/**
 * Implements: ADR-0038
 * Migrated onto the shared `consumeSlidingWindowAttempt` (apps/backend/src/lib/rate-limit.ts)
 * -- same table, same 1-hour window, same per-key limits, same error shape as before. Only
 * the SQL construction is now shared rather than duplicated; see
 * docs/specs/submission-tier-2-hard-ceiling.md "Migrating the existing rate limiters".
 */
export async function enforceTaskDropSubscribeRateLimit(input: {
  clientAddress: string;
  db: Db;
  email: string;
}): Promise<void> {
  await input.db.transaction(async (tx) => {
    const consume = async (key: string, limit: number): Promise<number> => {
      try {
        const { attempts } = await consumeSlidingWindowAttempt(tx, {
          table: taskDropSubscribeRateLimits,
          key,
          windowSeconds: WINDOW_SECONDS,
          limit,
        });
        return attempts;
      } catch (err) {
        if (err instanceof SlidingWindowRecordError) {
          throw new Error('Subscription rate limit could not be recorded');
        }
        throw err;
      }
    };

    const emailAttempts = await consume(rateLimitKey('email', input.email), LIMIT_PER_EMAIL);
    if (emailAttempts > LIMIT_PER_EMAIL) {
      throw new TRPCError({
        code: 'TOO_MANY_REQUESTS',
        message: 'Too many subscription attempts. Try again later.',
      });
    }

    const clientAttempts = await consume(
      rateLimitKey('client', input.clientAddress),
      LIMIT_PER_CLIENT
    );
    if (clientAttempts > LIMIT_PER_CLIENT) {
      throw new TRPCError({
        code: 'TOO_MANY_REQUESTS',
        message: 'Too many subscription attempts. Try again later.',
      });
    }
  });
}

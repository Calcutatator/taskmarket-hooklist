import { router, publicProcedure } from '../trpc';
import { z } from 'zod';
import { HealthResponseSchema } from '@taskmarket/shared';
import { getServerConfig } from '../config/env';
import { getFreeSubmissionAllowance, getHardSubmissionCeiling } from '../config/payments';
import { db } from '../db/client';
import { logger } from '../lib/logger';
import { countStaleNonTerminalIntents } from '../services/relayed-intents';

/**
 * The stuck-intent count, or `undefined` if it could not be computed.
 *
 * Health is the endpoint that says the service is up, so a failure here must never turn into a
 * 500 -- a database hiccup that hid one number would otherwise read as the whole backend being
 * down. The failure is logged so it is still findable (ADR-0053) and the field is dropped.
 */
async function readStaleIntentCount(): Promise<number | undefined> {
  try {
    return await countStaleNonTerminalIntents({ db });
  } catch (error) {
    logger.warn('health: stale relayed-intent count unavailable', { error });
    return undefined;
  }
}

export const healthRouter = router({
  check: publicProcedure
    .meta({
      openapi: {
        method: 'GET',
        path: '/health',
        tags: ['Health'],
        summary: 'Get backend health status',
      },
    })
    .input(z.object({}))
    .output(HealthResponseSchema)
    .query(async () => {
      const config = getServerConfig();
      const staleNonTerminal = await readStaleIntentCount();
      return {
        status: 'ok' as const,
        timestamp: new Date().toISOString(),
        environment: config.NODE_ENV,
        // The effective values, after any environment override -- what this process is
        // actually enforcing, not what the source defaults say. Reported so a caller can
        // tell whether the backend agrees with what they expect, which is the check
        // smoke-rate-limit.ts had no way to make.
        limits: {
          freeSubmissionAllowance: getFreeSubmissionAllowance(),
          hardSubmissionCeiling: getHardSubmissionCeiling(),
        },
        ...(staleNonTerminal === undefined ? {} : { intents: { staleNonTerminal } }),
      };
    }),
});

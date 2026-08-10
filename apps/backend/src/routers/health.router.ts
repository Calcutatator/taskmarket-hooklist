import { router, publicProcedure } from '../trpc';
import { z } from 'zod';
import { HealthResponseSchema } from '@taskmarket/shared';
import { getServerConfig } from '../config/env';
import { getFreeSubmissionAllowance, getHardSubmissionCeiling } from '../config/payments';
import { readStaleIntentSnapshot } from '../services/intent-health-snapshot';

/**
 * Health does no database work, and that is a requirement rather than an accident.
 *
 * This route is public, unauthenticated and polled continuously -- by load balancers, uptime
 * checks, smoke tests and anyone who finds it. A query on the request path turns each of those
 * cheap requests into work for us, which is an amplification vector pointed at the one endpoint
 * that has to keep answering while the service is under strain: the moment the database is the
 * thing in trouble, health would queue behind it and report nothing at all.
 *
 * So the stale-intent count is read from a value the relayed-intent worker publishes at the end
 * of each of its passes (`intent-health-snapshot.ts`), not computed here. The cost of the count
 * is bounded by the sweep interval no matter how hard this route is hit, and health itself is a
 * pure function of process state.
 */
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
    .query(() => {
      const config = getServerConfig();
      const intents = readStaleIntentSnapshot();
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
        // Omitted until a sweep has published one, and omitted for good in a process that does
        // not run the worker. Absence is the established way this response says "no answer",
        // and it is the honest one here: reporting a zero before anything had counted would be
        // inventing the reassuring answer.
        ...(intents === undefined ? {} : { intents }),
      };
    }),
});

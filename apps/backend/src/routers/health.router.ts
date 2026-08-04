import { router, publicProcedure } from '../trpc';
import { z } from 'zod';
import { HealthResponseSchema } from '@taskmarket/shared';
import { getServerConfig } from '../config/env';
import { getFreeSubmissionAllowance, getHardSubmissionCeiling } from '../config/payments';

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
      };
    }),
});

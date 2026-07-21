import { router, publicProcedure } from '../trpc';
import { z } from 'zod';
import { HealthResponseSchema } from '@taskmarket/shared';
import { getServerConfig } from '../config/env';

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
      };
    }),
});

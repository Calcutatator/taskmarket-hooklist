import { router, publicProcedure } from '../trpc';
import { HealthResponseSchema } from '@taskmarket/shared';
import { getServerConfig } from '../config/env';

export const healthRouter = router({
  check: publicProcedure.output(HealthResponseSchema).query(async () => {
    const config = getServerConfig();
    return {
      status: 'ok' as const,
      timestamp: new Date().toISOString(),
      environment: config.NODE_ENV,
    };
  }),
});

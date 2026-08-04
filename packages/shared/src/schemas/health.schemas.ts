import { z } from 'zod';

export const HealthResponseSchema = z.object({
  status: z.literal('ok'),
  timestamp: z.string(),
  environment: z.string(),
  /**
   * The submission limits this process is actually enforcing, after any environment
   * override. Reported because a limit a caller cannot observe is a limit a test can only
   * guess at: smoke-rate-limit.ts asserted against its own copy of the ceiling and had no
   * way to notice the backend was started with a different one, so it failed with a
   * confusing boundary error instead of saying the two disagreed.
   */
  limits: z.object({
    freeSubmissionAllowance: z.number().int().positive(),
    hardSubmissionCeiling: z.number().int().positive(),
  }),
});

export type HealthResponse = z.infer<typeof HealthResponseSchema>;

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
  /**
   * Relayed-intent facts a caller can poll for, in the same spirit as `limits`: a queryable
   * number, not an alert (ADR-0053).
   *
   * Optional because health is what tells you the service is up. If no count is available the
   * object is omitted rather than reported as a sentinel -- absence under an optional field is
   * unambiguous, whereas a `-1` or an `"unknown"` string is a value every consumer has to learn
   * not to plot, and it is also exactly how this endpoint already reads to a caller running
   * against a build from before the field existed.
   *
   * Absent means "no answer here", and it covers a process whose sweep has not run yet as well
   * as one that does not sweep at all. It never means zero.
   */
  intents: z
    .object({
      /**
       * When the count below was computed, not when it was served.
       *
       * These numbers come from a periodic sweep rather than from the request, so the response
       * is a cache and says so. Without this a consumer cannot tell a live zero from a zero
       * left behind by a worker that stopped running -- and the second is the more urgent of
       * the two, because a sweep that is not running is a queue nothing is draining.
       */
      measuredAt: z.string(),
      /**
       * Intents that are neither completed nor failed and have not been touched for well past
       * normal settlement. A count only -- the endpoint is public.
       */
      staleNonTerminal: z.number().int().nonnegative(),
    })
    .optional(),
});

export type HealthResponse = z.infer<typeof HealthResponseSchema>;

// Implements: ADR-0058
import { type Request, type Response, type NextFunction } from 'express';
import { type ZodIssue, type ZodTypeAny } from 'zod';

import { apiErrorBody } from '../lib/api-error';

/**
 * One issue, named. `path` is what a raw-REST caller has no other way to recover.
 *
 * The envelope has no field for it -- `ApiErrorEnvelopeSchema` carries `intentId`, `operation`,
 * `idempotencyKey`, `txHash` and `intentStatus`, and inventing a sixth for this would be adding
 * shape to a shared contract for one middleware's convenience. So the field name goes where it
 * has always belonged and never was: in the message. `"Number must be less than or equal to
 * 10000"` names no field at all; `"evaluatorFeeBps: Number must be less than or equal to 10000"`
 * is the same sentence about something.
 */
function describeIssue(issue: ZodIssue): string {
  return issue.path.length > 0 ? `${issue.path.join('.')}: ${issue.message}` : issue.message;
}

/**
 * Reject a request whose body does not parse, with the discriminator every other error carries.
 *
 * **Why `payment_preflight_rejected` and not `unclassified`.** The reason is defined as "a
 * pre-settlement check on the request's own inputs or on task state rejected it", and that is
 * exactly and only what this is: these routes mount `validateBody` ahead of the x402 middleware,
 * so a body that fails here is refused before the 402 challenge and nothing is charged. That is
 * the single most useful thing a caller can learn from a refusal on a paid route, and
 * `unclassified` -- which `trpc.ts` hands out when nobody knew better -- would withhold it while
 * still technically satisfying "every error carries a reason". The reason exists; using it costs
 * nothing and telling a caller "no idea" when we do know is its own small untruth (ADR-0070).
 *
 * This path never reached the `errorFormatter` in `trpc.ts`, which is the only place the envelope
 * was applied, so raw-REST validation failures answered with a bare `{ error }` and no
 * discriminator at all. `trpc.ts` states why that matters: a discriminator "is only worth
 * anything if it has no exceptions -- a caller that has to test whether the field is present
 * before branching on it is back to reading the message when it is absent."
 */
export function validateBody(schema: ZodTypeAny) {
  return (req: Request, res: Response, next: NextFunction) => {
    // Merge path params so OpenAPI clients that supply e.g. taskId via the URL
    // path rather than the JSON body are not incorrectly rejected.
    const result = schema.safeParse({ ...req.params, ...req.body });
    if (!result.success) {
      const issues = result.error.issues.map(describeIssue).join('; ');
      res.status(400).json(apiErrorBody({ reason: 'payment_preflight_rejected', message: issues }));
      return;
    }
    req.body = result.data;
    next();
  };
}

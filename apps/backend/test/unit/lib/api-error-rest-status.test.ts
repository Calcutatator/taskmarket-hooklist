/**
 * What a REST caller actually receives when a procedure throws `ApiError`.
 *
 * Verifies: ADR-0049
 * Verifies: ADR-0058
 * Verifies: ADR-0074
 *
 * `api-error.test.ts` covers the mapping from reason to code, and it passed throughout the period
 * this file exists to close: every REST answer on the OpenAPI surface was a generic 500 with the
 * code and the envelope discarded, because `trpc-to-openapi` decides whether to keep a thrown
 * error by reading `cause.name === 'TRPCError'` rather than by `instanceof`, and `ApiError` had
 * set `name = 'ApiError'`. A unit test of the mapping cannot see that -- the substitution happens
 * in the transport, one layer below where the code is chosen, and the replacement inherits the
 * original stack so even the logs read as though the real error had been sent.
 *
 * So these drive the real Express adapter the app mounts in `app.ts` and assert on the wire
 * bytes. An assertion on `ApiError.name` alone would restate the fix rather than test it; this
 * fails for any future change -- ours or the library's -- that breaks the same path by another
 * route.
 */
import express from 'express';
import request from 'supertest';
import { initTRPC } from '@trpc/server';
import { createOpenApiExpressMiddleware, type OpenApiMeta } from 'trpc-to-openapi';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { apiError, envelopeForError } from '../../../src/lib/api-error';

/**
 * A router carrying the same two pieces of app wiring that decide this outcome: the OpenAPI meta
 * that puts a procedure on the REST surface, and the `errorFormatter` that publishes the envelope.
 * Kept minimal deliberately -- routing the real router here would drag in a database and test
 * the app's surface rather than the boundary.
 */
const t = initTRPC.meta<OpenApiMeta>().create({
  errorFormatter({ error, shape }) {
    return { ...shape, data: { ...shape.data, taskmarket: envelopeForError(error) } };
  },
});

function handlerFor(thrown: Error) {
  const router = t.router({
    throwing: t.procedure
      .meta({ openapi: { method: 'POST', path: '/throwing' } })
      .input(z.object({}).passthrough())
      .output(z.object({ ok: z.boolean() }))
      .mutation(() => {
        throw thrown;
      }),
  });

  const app = express();
  app.use(express.json());
  app.use(
    createOpenApiExpressMiddleware({ router, createContext: () => ({}), onError: undefined })
  );
  return app;
}

describe('an ApiError thrown inside a procedure, as a REST caller sees it', () => {
  it('answers intent_in_flight with 409 and not a 5xx', async () => {
    // The failure this pins cost real money in a sandbox run: the write had landed, and the
    // caller was told 500 -- which every generic retrying client reads as "send it again", i.e.
    // a second paid submission of live work.
    const response = await request(
      handlerFor(
        apiError({
          reason: 'intent_in_flight',
          intentStatus: 'broadcast',
          message: 'poll the intent rather than resubmitting',
        })
      )
    )
      .post('/throwing')
      .send({});

    expect(response.status).toBe(409);
    expect(response.status).toBeLessThan(500);
  });

  it('carries the envelope through to the body', async () => {
    const response = await request(
      handlerFor(
        apiError({
          reason: 'intent_in_flight',
          intentStatus: 'broadcast',
          message: 'poll the intent rather than resubmitting',
        })
      )
    )
      .post('/throwing')
      .send({});

    expect(response.body?.data?.taskmarket?.reason).toBe('intent_in_flight');
    expect(response.body?.data?.taskmarket?.intentStatus).toBe('broadcast');
  });

  it('keeps the human message rather than replacing it with a generic one', async () => {
    const response = await request(
      handlerFor(
        apiError({
          reason: 'intent_in_flight',
          intentStatus: 'broadcast',
          message: 'poll the intent rather than resubmitting',
        })
      )
    )
      .post('/throwing')
      .send({});

    expect(response.body?.message).toContain('poll the intent');
    expect(response.body?.message).not.toBe('Internal server error');
  });

  // The same substitution hit every reason, not only the in-flight one -- `wallet.withdraw`'s
  // idempotency error was masked to 500 by the identical path. A reason whose own status is a
  // 4xx is the general case, so it is asserted rather than assumed.
  it.each([
    ['idempotency_key_required', 400],
    ['intent_not_found', 404],
    ['payment_payer_mismatch', 403],
  ] as const)('answers %s with %i', async (reason, status) => {
    const response = await request(
      handlerFor(apiError({ reason, message: `${reason} raised from a procedure` }))
    )
      .post('/throwing')
      .send({});

    expect(response.status).toBe(status);
    expect(response.body?.data?.taskmarket?.reason).toBe(reason);
  });

  it('still answers 500 for an ordinary error, which must not be reclassified', async () => {
    // The guard cuts both ways: an unclassified throw is a genuine server fault and has to stay
    // one. A "fix" that made everything a 4xx would pass every assertion above.
    const response = await request(handlerFor(new Error('something genuinely broke')))
      .post('/throwing')
      .send({});

    expect(response.status).toBe(500);
  });
});

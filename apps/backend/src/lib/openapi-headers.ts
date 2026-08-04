// Implements: ADR-0052
import { z } from 'zod';
import { IDEMPOTENCY_KEY_HEADER } from '@taskmarket/shared';

/**
 * The request headers a relayed write requires, declared so the OpenAPI spec says so.
 *
 * ADR-0052 made `Idempotency-Key` mandatory on every relayed write and enforced it before the 402
 * challenge -- a request without one is a 400 and is never charged. The spec did not mention the
 * header at all, so a raw-REST caller reading the machine-readable contract saw no such
 * requirement, sent no such header, got a 400, and had nothing in the document telling them why.
 * A breaking change absent from the contract is indistinguishable from a broken endpoint.
 *
 * Declared once and attached per procedure rather than blanket-applied to every mutation, because
 * it is not true of every mutation: only writes that go through `runRelayedIntent` require it.
 * `test/unit/config/api-error-envelope-usage.test.ts` checks that the two sets match, so a new
 * relayed write cannot ship with the requirement enforced and undocumented.
 */
export const RELAYED_WRITE_REQUEST_HEADERS = z.object({
  [IDEMPOTENCY_KEY_HEADER]: z
    .string()
    .uuid()
    .describe(
      'A UUID you generate naming this one logical operation. Required. Send the same value ' +
        'when retrying the same operation, and a fresh one for a new operation. A repeat is ' +
        'answered 409 with reason `idempotency_key_reused` and is neither charged nor submitted ' +
        'again; read the outcome from GET /intents.'
    ),
});

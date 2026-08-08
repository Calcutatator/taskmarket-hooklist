// Implements: ADR-0049
import { TRPCError } from '@trpc/server';
import {
  type ApiErrorEnvelope,
  type ApiErrorIntentStatus,
  type ApiErrorReason,
  ApiErrorEnvelopeSchema,
  ApiErrorIntentStatusSchema,
  apiErrorEnvelopeOf,
} from '@taskmarket/shared';

/**
 * The intent status a `relayed_intents` row carries, parsed rather than asserted.
 *
 * The column is `text` with a database CHECK constraint, so TypeScript only knows it as `string`
 * and `status as ApiErrorEnvelope['intentStatus']` is a claim nothing verifies. A value outside
 * the five would travel unchallenged to a client that branches on it. Parsing makes that loud and
 * local instead: unreachable while the constraint holds, and an error at the producer rather than
 * a lie on the wire if it ever does not (ADR-0070).
 */
export function intentStatusOf(status: string): ApiErrorIntentStatus {
  return ApiErrorIntentStatusSchema.parse(status);
}

/**
 * The one way this backend produces an error a client is expected to branch on.
 *
 * ADR-0049 point 3 required "in flight" and "failed" to be structurally different answers, and a
 * caller to distinguish them "by a field, never by string-matching a message". Nothing built that
 * field, so the web app grew four literal substrings copied out of backend prose and the CLI grew
 * nothing at all -- it renders every failure identically, which is why `docs/CLI_GUIDE.md` has to
 * tell script authors never to auto-retry a paid command.
 *
 * `ApiError` closes that by construction. It carries an `ApiErrorEnvelope` alongside the message,
 * the `errorFormatter` in `trpc.ts` publishes it at `error.data.taskmarket`, and
 * `test/unit/config/api-error-envelope-usage.test.ts` fails the build if a relayed-write path
 * throws anything else. The message stays, and stays human -- it is just no longer the only thing
 * in the response.
 */
export class ApiError extends TRPCError {
  readonly envelope: ApiErrorEnvelope;

  constructor(input: { code: TRPCError['code']; message: string; envelope: ApiErrorEnvelope }) {
    super({ code: input.code, message: input.message });
    // `name` stays exactly `'TRPCError'`, inherited. It is not cosmetic on this class: the REST
    // transport decides whether to keep a thrown error by reading the string rather than by
    // `instanceof` -- `getErrorFromUnknown` in `trpc-to-openapi/adapters/node-http/errors.js`:
    //
    //     if (cause instanceof Error && cause.name === 'TRPCError') return cause;
    //     ... new TRPCError({ message: 'Internal server error', code: 'INTERNAL_SERVER_ERROR' })
    //     if (stack) error.stack = stack;
    //
    // Setting it to `'ApiError'` failed that test, so every throw from inside a procedure reached
    // REST callers as a generic 500 with the code and the envelope both discarded -- and the
    // replacement inherits the original stack, so the logs still read `ApiError: ...` under a
    // message of `Internal server error` and the substitution is invisible. That turned
    // `intent_in_flight` into the 5xx the mapping below exists to avoid: a retrying client
    // resubmits a paid write that already landed. `api-error-rest-status.test.ts` pins it.
    this.envelope = input.envelope;
  }
}

/**
 * The HTTP shape each reason answers with, decided once rather than at each throw site.
 *
 * `Record<ApiErrorReason, ...>` is doing real work: adding a reason to the shared union without
 * choosing its status here is a type error, so a new reason cannot reach a client as whatever
 * status the nearest throw happened to use.
 *
 * **Why `intent_in_flight` is a 409 and not a 500.** ADR-0049 asked only that it not be "a
 * generic 500 whose prose must be parsed"; the status was left open. 5xx is wrong on its face --
 * nothing malfunctioned, and every generic retrying HTTP client in existence reads 5xx as "try
 * that again", which here means paying twice. 409 says the request conflicts with the current
 * state of the resource, which is exactly true: an intent already owns this operation's outcome.
 * It also puts the two doors onto the same fact -- a write that went in flight, and a repeat of
 * that write arriving on its idempotency key -- behind one status, distinguished by `reason`.
 */
const REASON_CODES: Record<ApiErrorReason, TRPCError['code']> = {
  intent_in_flight: 'CONFLICT',
  idempotency_key_reused: 'CONFLICT',
  idempotency_key_required: 'BAD_REQUEST',
  idempotency_key_conflict: 'CONFLICT',
  idempotency_key_payload_mismatch: 'CONFLICT',
  payment_already_spent: 'CONFLICT',
  // No tRPC code maps to 503. The path that raises this answers Express directly with a 503, so
  // this mapping only covers the case where it is ever raised from inside a procedure.
  idempotency_check_unavailable: 'INTERNAL_SERVER_ERROR',
  // The chain call landed and the work happened; only the recording is outstanding. It is a
  // server-side loose end, not something the caller did or can fix, so 5xx is honest here.
  intent_completion_deferred: 'INTERNAL_SERVER_ERROR',
  intent_not_found: 'NOT_FOUND',
  payment_rejected: 'BAD_REQUEST',
  payment_preflight_rejected: 'BAD_REQUEST',
  // The caller is identified and the request is well-formed; what they are not is entitled to
  // have this payment stand for this write. FORBIDDEN, the same status the sibling paid routes
  // answer their own payer/actor mismatch with.
  payment_payer_mismatch: 'FORBIDDEN',
  unclassified: 'INTERNAL_SERVER_ERROR',
};

/** The tRPC code a reason answers with. Exported so the guard test can assert totality. */
export function codeForReason(reason: ApiErrorReason): TRPCError['code'] {
  return REASON_CODES[reason];
}

/**
 * What a throw site provides: the envelope itself, plus the human message and an optional status
 * override. Typed off `ApiErrorEnvelope` rather than restating its fields, so the union's own
 * rules apply at the throw site -- `idempotency_key_reused` without an `intentStatus` does not
 * compile, and does not reach the parse below (ADR-0070).
 */
export type ApiErrorInput = ApiErrorEnvelope & {
  message: string;
  code?: TRPCError['code'];
};

/**
 * Build a classified error. The status follows from the reason, so a throw site chooses the fact
 * and never the transport detail.
 *
 * `code` may be overridden for the cases where one reason legitimately answers with two statuses
 * -- a preflight rejection is a 400, a 403 or a 404 depending on what it checked -- but the
 * reason is what a client branches on either way.
 */
export function apiError(input: ApiErrorInput): ApiError {
  const { message, code, ...envelopeInput } = input;
  const { reason, ...rest } = envelopeInput;
  const envelope = ApiErrorEnvelopeSchema.parse({
    reason,
    // `undefined` entries are dropped rather than serialised as null, so a client can test
    // presence rather than having to test presence and non-null.
    ...Object.fromEntries(Object.entries(rest).filter(([, value]) => value !== undefined)),
  });
  return new ApiError({ code: code ?? codeForReason(reason), message, envelope });
}

/**
 * The envelope for any error at all, classified or not.
 *
 * Every error is published with an envelope, including ones nobody classified -- a client's
 * switch on `reason` is then total, and "this backend told me nothing" is a value it can see
 * rather than the absence of a field it has to test for. The guard test is what keeps
 * `unclassified` from becoming the answer on the paths where it would cost money.
 */
export function envelopeForError(error: unknown): ApiErrorEnvelope {
  if (error instanceof ApiError) return error.envelope;
  // tRPC wraps a non-TRPCError throw and hangs the original off `cause`, so an ApiError raised
  // from a service reached by something other than a procedure still publishes its envelope.
  const cause = error instanceof Error ? error.cause : undefined;
  if (cause instanceof ApiError) return cause.envelope;
  return apiErrorEnvelopeOf(error) ?? { reason: 'unclassified' };
}

/**
 * The JSON body an Express handler outside tRPC answers with.
 *
 * The x402 middleware runs before tRPC and replies to `res` itself, so its failures never pass
 * through the `errorFormatter`. They carry the same envelope under the same key regardless, so a
 * client has one reader for both -- which is the whole point of a discriminator that a paid write
 * can be refused at either layer.
 */
export function apiErrorBody(input: ApiErrorEnvelope & { message: string }): {
  error: string;
  taskmarket: ApiErrorEnvelope;
} {
  const { message, ...envelopeInput } = input;
  return { error: message, taskmarket: apiError({ ...envelopeInput, message }).envelope };
}

import { z } from 'zod';

/**
 * The machine-readable reason a write did not return its result (ADR-0049 point 3, ADR-0058).
 *
 * ADR-0049 decided that "in flight" and "failed" must be structurally different answers, and
 * that a caller distinguishes them "by a field, never by string-matching a message". This is
 * that field. It exists because the alternative was measured: the web app carried four literal
 * substrings copied out of backend prose to decide whether a failure was still landing, and the
 * cost of getting that wrong is a user paying for the same write twice.
 *
 * The values are a closed set on purpose. A caller may branch on any of them and may treat an
 * unrecognised one as `unclassified`, but the backend may not invent one at a throw site: every
 * reason is declared here, mapped to a tRPC code in one place, and enforced by
 * `apps/backend/test/unit/config/api-error-envelope-usage.test.ts`.
 */
export const API_ERROR_REASONS = [
  /**
   * No terminal outcome has been established. The write is owned by the settlement path and
   * may still succeed. **This is not a failure and not a success**, and it makes no claim about
   * whether the payment moved (ADR-0049 point 3). Never resubmit; poll `intents.get`.
   */
  'intent_in_flight',
  /**
   * A write carrying this idempotency key already exists, and this request neither charged the
   * caller nor submitted anything a second time. Idempotency working, reported as a conflict --
   * see ADR-0058 for why this is not a 200 carrying the original result.
   */
  'idempotency_key_reused',
  /**
   * The request arrived with no `X-Taskmarket-Idempotency-Key` header (the value of
   * `IDEMPOTENCY_KEY_HEADER`), or one that is not a UUID. Rejected before the 402 challenge,
   * so nothing was charged (ADR-0052).
   */
  'idempotency_key_required',
  /**
   * The key is already bound to a *different* operation, or to a different caller's write. Not
   * the benign repeat: nothing here can be waited on, and the caller must generate a fresh key.
   * Distinguished from `idempotency_key_reused` because the correct client response is opposite
   * -- poll there, resubmit under a new key here.
   */
  'idempotency_key_conflict',
  /**
   * The key names the *same* operation by the *same* caller, but with different arguments. One
   * level finer than `idempotency_key_conflict`, and a distinct reason because the caller's
   * mistake is distinct: they reused a key while changing what they were asking for, so the
   * write they just described never happened and the one the key already names is not it
   * (ADR-0061). Re-send the original arguments to retry the original write, or generate a fresh
   * key for the new one.
   */
  'idempotency_key_payload_mismatch',
  /**
   * The settled payment behind this request has already funded another intent. A retry that
   * failed to reuse its key, or a replayed payment. The money is spent and this write did not
   * happen; the caller reads the intent that did consume it from `intents.get`.
   */
  'payment_already_spent',
  /**
   * The idempotency precondition could not be read, so the request was refused rather than
   * risking a double charge on an unverified assumption. Safe to retry with the same key.
   */
  'idempotency_check_unavailable',
  /**
   * The chain call is confirmed and the work happened, but recording it did not finish. There
   * is nothing to refund and nothing to resubmit; the intent is retried automatically.
   */
  'intent_completion_deferred',
  /**
   * No intent answers to that id or key *for this caller*. Deliberately one reason for both "no
   * such intent" and "not yours": telling them apart would make this surface an oracle for which
   * intent ids and idempotency keys exist (ADR-0049 point 6).
   */
  'intent_not_found',
  /** The x402 exchange did not produce a settled payment. Nothing was charged. */
  'payment_rejected',
  /** A pre-settlement check on the request's own inputs or on task state rejected it. */
  'payment_preflight_rejected',
  /**
   * The settled payment came from an address other than the one the request is authenticated as
   * acting for. The write was refused; the payment had already settled when the mismatch was
   * seen, so the fee is not returned by this path.
   */
  'payment_payer_mismatch',
  /**
   * The error carries no more specific classification. Present so that every error has a
   * reason field and a client's switch is total; not a licence to leave one here.
   */
  'unclassified',
] as const;

export const ApiErrorReasonSchema = z.enum(API_ERROR_REASONS);
export type ApiErrorReason = (typeof API_ERROR_REASONS)[number];

/**
 * The envelope every API error carries: under `error.data.taskmarket` on a tRPC response, and
 * as a sibling of `error` on the raw-REST and x402 middleware bodies.
 *
 * Every field beyond `reason` is optional because not every reason has one -- a rejected payment
 * has no intent, and an intent rejected before broadcast has no transaction hash. What is not
 * optional is that a caller can branch without reading `message`.
 */
export const ApiErrorEnvelopeSchema = z.object({
  reason: ApiErrorReasonSchema,
  /** The durable handle to the write, where one was recorded. Key on this, not on `txHash`. */
  intentId: z.string().optional(),
  /** The intent's status at the moment this answer was produced. */
  intentStatus: z.enum(['reserved', 'recorded', 'broadcast', 'completed', 'failed']).optional(),
  /** The operation the intent stands for, e.g. `tasks.create`. */
  operation: z.string().optional(),
  /** The caller's own key for the operation, echoed so a dropped response is still traceable. */
  idempotencyKey: z.string().optional(),
  /**
   * Known once something has been broadcast, and explicitly not the handle: the reconciler may
   * land a replacement at the same nonce, which is a different hash for the same intent.
   */
  txHash: z.string().optional(),
});

export type ApiErrorEnvelope = z.infer<typeof ApiErrorEnvelopeSchema>;

/**
 * Reasons whose meaning is "this is still happening, do not pay again".
 *
 * Exported from shared so the web app and the CLI branch on the same set rather than each
 * deciding for itself which reasons are non-terminal -- the mistake the substring matching made
 * structurally possible.
 *
 * The question this set asks is only ever "is something still landing", never "was anything
 * charged". That is why `payment_already_spent`, `payment_payer_mismatch` and
 * `idempotency_key_payload_mismatch` all stay out of it despite naming a settled payment: in
 * each of those the write the caller described provably did not happen and nothing is on its way
 * -- what is outstanding is a refund, which `reason` reports and this predicate does not.
 * `intent_completion_deferred` is the opposite case and belongs here: its chain call is
 * confirmed, so the work *did* happen and only the recording of it is outstanding.
 */
const IN_FLIGHT_REASONS: ReadonlySet<ApiErrorReason> = new Set([
  'intent_in_flight',
  'idempotency_key_reused',
  // Not "may still succeed" but "already succeeded, still being written down". Both are
  // answered the same way -- poll, never resubmit -- and reporting this one as settled told a
  // script following the documented rule that re-running it was an ordinary retry. It is not:
  // the chain call is confirmed, so a re-run is a second paid action for work already done.
  'intent_completion_deferred',
]);

/**
 * True when the envelope says no terminal outcome has been established.
 *
 * `idempotency_key_reused` counts only while the intent it names is non-terminal. A reused key
 * naming a `failed` intent is a settled failure and must read as one: showing it as "still
 * confirming" is the false positive that leaves a user waiting for a write that is already
 * dead. A reused key naming a `completed` intent is likewise not in flight -- the write landed,
 * and the caller reads its result from `intents.get`.
 *
 * Those two are the *only* answers that make it terminal. Anything else -- `reserved`,
 * `recorded`, `broadcast`, a status this package is too old to recognise, or no status at all
 * -- reads as in flight. That is the opposite of the default this predicate applies elsewhere,
 * and deliberately so, because for this one reason the two errors are not symmetric. The
 * reason code itself is proof that an intent already exists under this key: that is what
 * `idempotency_key_reused` means. So "in flight" only ever tells the caller to poll
 * `intents.get`, which is correct and free whatever the intent turns out to have done, while
 * "terminal" tells them the key is spent and a fresh one is needed -- and acting on that when
 * the write is in fact still running is a second paid submission of an operation already under
 * way. An unclassified answer must not be allowed to cause a double charge, so the unknown
 * case resolves to the side that only ever costs a poll.
 */
export function isInFlightApiError(envelope: ApiErrorEnvelope | null | undefined): boolean {
  if (!envelope || !IN_FLIGHT_REASONS.has(envelope.reason)) return false;
  if (envelope.reason !== 'idempotency_key_reused') return true;
  // `reserved` is in flight in the most literal sense: another request holds this key and is
  // partway through paying for it (ADR-0067). Answering "terminal" would tell the caller to
  // start again with a fresh key, which is a second charge for the same operation.
  return envelope.intentStatus !== 'completed' && envelope.intentStatus !== 'failed';
}

/**
 * Pull the envelope out of whatever shape a transport delivered it in.
 *
 * One reader for three wire shapes: a tRPC error (`error.data.taskmarket`), a raw-REST or x402
 * middleware body (`{ error, taskmarket }`), and the envelope on its own. An unknown reason is
 * rejected rather than passed through, so a client built against an older shared package treats
 * a value it cannot interpret as no information rather than as something it will compare against
 * and get wrong.
 */
export function apiErrorEnvelopeOf(value: unknown): ApiErrorEnvelope | null {
  if (!value || typeof value !== 'object') return null;
  const at = (source: unknown, key: string): unknown =>
    source && typeof source === 'object' ? (source as Record<string, unknown>)[key] : undefined;

  // In order of how directly each transport hands it over: the raw-REST and x402 bodies put it
  // beside `error`; a tRPC client error exposes it on `.data`; a tRPC HTTP response nests it
  // under `error.data`; and the envelope may simply be the whole value.
  const candidate =
    at(value, 'taskmarket') ??
    at(at(value, 'data'), 'taskmarket') ??
    at(at(at(value, 'error'), 'data'), 'taskmarket') ??
    value;
  const parsed = ApiErrorEnvelopeSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

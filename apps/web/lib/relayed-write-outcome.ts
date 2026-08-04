// The single place in the web app that decides whether a failed write is actually in flight.
//
// ADR-0045 introduced a third outcome for a relayed write, alongside success and failure: the
// transaction is broadcast, the backend owns it, and it will settle from a durable record
// whenever the chain confirms. ADR-0049 point 3 says a caller must distinguish that outcome
// "by a field, never by string-matching a message".
//
// ADR-0058 built that field. Every API error now carries an `ApiErrorEnvelope` -- under
// `taskmarket` on a raw-REST or x402 body, under `error.data.taskmarket` on a tRPC response --
// whose `reason` says what happened, and `isInFlightApiError` in `@taskmarket/shared` is the one
// predicate that decides which reasons mean "still landing". Both clients read that same
// predicate rather than each deciding for itself.
//
// The prose markers below are kept as a *fallback only*, for a browser session talking to a
// backend deployed before the envelope existed. They are not the primary evidence any more and
// nothing should be added to them. They stay narrow for the same reason they always were: the
// two ways of being wrong are not symmetric. A false negative shows an error where an in-flight
// notice belonged -- bad, but nothing untrue is said. A false positive suppresses a real error
// and tells the user their write is safely landing when it is not.
//
// The status word is matched explicitly rather than skipped over. `recorded` and `broadcast`
// are the non-terminal statuses; `failed` produces the same sentence and must NOT match, since
// showing a settled failure as "confirming" would be the false positive this file is written
// to avoid. (`completed` never reaches here -- it returns the original result instead.)
import { apiErrorEnvelopeOf, isInFlightApiError } from '@taskmarket/shared';

const PENDING_ERROR_MARKERS = [
  'remains in flight',
  'not confirmed within the request budget',
  'is already recorded and is not submitted again',
  'is already broadcast and is not submitted again',
] as const;

export function isPendingTransactionMessage(message: string): boolean {
  const normalized = message.toLowerCase();
  return PENDING_ERROR_MARKERS.some((marker) => normalized.includes(marker));
}

/**
 * Whether an error response means the write is still landing.
 *
 * The envelope decides whenever there is one. `isInFlightApiError` is deliberately not
 * reimplemented here: it knows that `idempotency_key_reused` counts only while the intent it
 * names is `recorded` or `broadcast`, and that rule has to be identical in the web app and the
 * CLI or one of them will show a settled failure as "confirming".
 *
 * The message fallback exists only for a backend deployed before ADR-0058. It is checked second,
 * never first, so a backend that answers structurally is never second-guessed by prose.
 */
export function isPendingWriteResponse(body: unknown, message: string): boolean {
  const envelope = apiErrorEnvelopeOf(body);
  if (envelope) return isInFlightApiError(envelope);
  return isPendingTransactionMessage(message);
}

/**
 * The shape every transport's failure branch is narrowed to before the UI looks at it.
 *
 * `pending: true` means exactly one thing: no terminal outcome has been established. It is
 * not a success and not a failure, and it carries no claim about whether the payment moved.
 */
export type PendingWriteResult = {
  ok: false;
  pending: true;
  idempotencyKey: string;
  error: string;
  rejected?: false;
};

/**
 * Narrows an arbitrary write result to the in-flight outcome.
 *
 * Accepts anything with the `{ ok, pending?, idempotencyKey?, error? }` shape, so x402 results,
 * wallet-signed results, and hand-rolled fetch wrappers all share one predicate rather than
 * each re-deriving what "in flight" means.
 */
export function pendingResultOf(result: {
  ok: boolean;
  pending?: boolean;
  idempotencyKey?: string;
  error?: string;
}): PendingWriteResult | null {
  if (result.ok || !result.pending || !result.idempotencyKey) return null;
  return {
    ok: false,
    pending: true,
    idempotencyKey: result.idempotencyKey,
    error: result.error ?? 'Write is in flight',
  };
}

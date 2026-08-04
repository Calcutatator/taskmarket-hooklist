// The single place in the web app that decides whether a failed write is actually in flight.
//
// ADR-0045 introduced a third outcome for a relayed write, alongside success and failure: the
// transaction is broadcast, the backend owns it, and it will settle from a durable record
// whenever the chain confirms. ADR-0049 point 3 says a caller must distinguish that outcome
// "by a field, never by string-matching a message".
//
// That field does not exist yet. The backend rethrows `ServerTransactionPendingError` raw, so
// the outcome reaches the browser as an HTTP 500 whose *message* is the only evidence:
//
//   Server wallet transaction 0x... (nonce N) was broadcast but not confirmed within the
//   request budget; it remains in flight
//
// No discriminator, no intent id, nothing structured. Matching prose is fragile -- a backend
// reword silently breaks it -- so every transport (x402, wallet-signed, and the raw fetches in
// the create wizard) funnels through this one function rather than each carrying its own copy
// of the guess. When the structured contract lands, `isPendingTransactionMessage` is the only
// body that changes.
//
// The markers are deliberately narrow, because the two ways of being wrong are not symmetric.
// A false negative shows an error where an in-flight notice belonged: bad, but the user is
// told nothing untrue. A false positive suppresses a real error and tells the user their write
// is safely landing when it is not. So this errs toward missing rather than over-matching.
// There is a second in-flight-shaped outcome, and missing it would be worse than missing the
// first. `relayed-intent-request.ts` answers a repeated idempotency key with a 409 reading
// "<operation> for this idempotency key is already <status> and is not submitted again (intent
// ...). Poll intents.get for its outcome." That is precisely what a user who presses the button
// again during an in-flight write receives -- so if it read as a failure, the surface built to
// stop a second payment would itself present an error at the exact moment the user is deciding
// whether to pay again.
//
// The status word is matched explicitly rather than skipped over. `recorded` and `broadcast`
// are the non-terminal statuses; `failed` produces the same sentence and must NOT match, since
// showing a settled failure as "confirming" would be the false positive this file is written
// to avoid. (`completed` never reaches here -- it returns the original result instead.)
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

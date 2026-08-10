// The key a write is sent under travels with that write's outcome and nowhere else. There is no
// ambient "current key", deliberately.
//
// There was one, bound with `AsyncLocalStorage` and modelled on the backend's `withRelayEnvelope`
// (apps/backend/src/services/relay-envelope.ts). The model does not transfer, and the reason is
// worth keeping: `withRelayEnvelope` binds a value the call tree *consumes* -- a deadline, a
// receipt nonce that the contract layer needs deep inside the send. Nothing reports it, so it
// cannot name the wrong thing. A key is a value the output layer *reports*, and a reported value
// has to be right about which write it names. "The last write started in this scope" is only that
// write while exactly one write is in play, which is not the shape of a batch, a poll loop, or
// anything that writes and then keeps working. Ambient is right for the first job and wrong for
// the second.
import { randomUUID } from 'node:crypto';

import { IDEMPOTENCY_KEY_HEADER } from '@taskmarket/shared';

/**
 * A key supplied by the operator for the next write, read once from the environment. Consumed on
 * first use rather than applied to every write in the process: re-presenting an operation is a
 * single deliberate act, and a key that stayed in force would silently collapse the second and
 * third writes of a multi-write command into the first one's identity.
 */
let pendingEnvKey: string | undefined = process.env.TASKMARKET_IDEMPOTENCY_KEY?.trim() || undefined;

/**
 * The key each failed write was sent under, keyed by the error it raised.
 *
 * This is the association that cannot go stale, because it is made per error rather than per
 * scope: the error object is the thing being reported, so the key attached to it is the key of
 * the write being reported, no matter how many other writes have started or finished since. It is
 * the same move ADR-0057 made for the payment reference -- pair the two values at the one moment
 * they are certainly a pair, rather than re-deriving the pairing later from ambient state.
 *
 * A `WeakMap` rather than a property assignment because a thrown value is not necessarily an
 * `Error`, is not necessarily extensible, and is not the CLI's to mutate. Entries die with the
 * error.
 */
const keyByError = new WeakMap<object, string>();

/**
 * Record that `error` was raised by the write `key` names.
 *
 * The first recording wins. Writes nest (an outer helper may re-throw an inner write's error),
 * and the innermost write is the one that actually failed.
 */
export function rememberIdempotencyKeyFor(error: unknown, key: string): void {
  if (error === null || (typeof error !== 'object' && typeof error !== 'function')) return;
  if (keyByError.has(error as object)) return;
  keyByError.set(error as object, key);
}

/** The key of the write that raised `error`, if a write raised it. */
export function idempotencyKeyForError(error: unknown): string | undefined {
  if (error === null || (typeof error !== 'object' && typeof error !== 'function'))
    return undefined;
  return keyByError.get(error as object);
}

/**
 * A client-generated key naming one logical write. Generated before the request is sent, so it
 * is the one identifier a caller still holds when the response never arrives -- the intent id
 * the backend mints is only learnable from a response the caller may never see.
 */
export function newIdempotencyKey(): string {
  return randomUUID();
}

/**
 * Decide the key for one logical write.
 *
 * Precedence is explicit argument, then a once-only `TASKMARKET_IDEMPOTENCY_KEY`, then a fresh
 * UUID. A plain re-run of a failed command therefore mints a new key and is a new operation:
 * re-presenting the original is something the operator has to ask for on purpose.
 */
export function resolveIdempotencyKey(explicit?: string): string {
  if (explicit !== undefined) {
    return explicit;
  }
  if (pendingEnvKey !== undefined) {
    const fromEnv = pendingEnvKey;
    pendingEnvKey = undefined;
    return fromEnv;
  }
  return newIdempotencyKey();
}

/**
 * Run one relayed write under `key`, tagging anything it raises with that key on the way past.
 *
 * A write has three outcomes and the key travels with all three. Success returns it beside the
 * payload (`WriteOutcome` in lib/api.ts). A failure the backend classified carries it on the
 * `ApiError`. Anything else -- a dropped connection, a signing error, a payment the server would
 * not quote for -- is tagged here, because those failures have no response to build an `ApiError`
 * from and are exactly the ones most likely to have left a write in flight.
 *
 * Tagging is what lets a failure keep its key after the moment has passed: out of the `catch`
 * that stashed it, past every write that ran afterwards, through the wrapper that added context
 * to its message. Nothing about the report has to be inferred from when it happens.
 */
export async function withIdempotentWrite<T>(key: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    rememberIdempotencyKeyFor(error, key);
    throw error;
  }
}

/** Test seam: reset the process-level environment key this module consumes once. */
export function resetIdempotencyState(envKey?: string): void {
  pendingEnvKey = envKey?.trim() || undefined;
}

/**
 * Header block for one logical operation. Every request that belongs to that operation carries
 * the same key, including both rounds of an x402 exchange: rounds one and two are one write, and
 * a fresh key on round two would present the paid retry as a new operation.
 */
export function idempotencyHeaders(key: string): Record<string, string> {
  return { [IDEMPOTENCY_KEY_HEADER]: key };
}

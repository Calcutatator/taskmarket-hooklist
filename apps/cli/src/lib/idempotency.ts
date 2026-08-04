import { randomUUID } from 'node:crypto';

import { IDEMPOTENCY_KEY_HEADER } from '@taskmarket/shared';

/**
 * The key the most recent relayed write in this process was sent under. The transport is the
 * only place that knows it -- commands call `printError(err.message)` with a bare string, so
 * there is no parameter to thread it through -- and a CLI process runs exactly one command, so
 * "the last key minted" is the key of the write that just failed.
 */
let lastKey: string | undefined;

/**
 * A key supplied by the operator for the next write, read once from the environment. Consumed on
 * first use rather than applied to every write in the process: re-presenting an operation is a
 * single deliberate act, and a key that stayed in force would silently collapse the second and
 * third writes of a multi-write command into the first one's identity.
 */
let pendingEnvKey: string | undefined = process.env.TASKMARKET_IDEMPOTENCY_KEY?.trim() || undefined;

/**
 * A client-generated key naming one logical write. Generated before the request is sent, so it
 * is the one identifier a caller still holds when the response never arrives -- the intent id
 * the backend mints is only learnable from a response the caller may never see.
 */
export function newIdempotencyKey(): string {
  return randomUUID();
}

/**
 * Decide the key for one logical write and record it as this process's most recent.
 *
 * Precedence is explicit argument, then a once-only `TASKMARKET_IDEMPOTENCY_KEY`, then a fresh
 * UUID. A plain re-run of a failed command therefore mints a new key and is a new operation:
 * re-presenting the original is something the operator has to ask for on purpose.
 */
export function resolveIdempotencyKey(explicit?: string): string {
  if (explicit !== undefined) {
    lastKey = explicit;
    return explicit;
  }
  if (pendingEnvKey !== undefined) {
    const fromEnv = pendingEnvKey;
    pendingEnvKey = undefined;
    lastKey = fromEnv;
    return fromEnv;
  }
  lastKey = newIdempotencyKey();
  return lastKey;
}

/**
 * The key of the last write attempted, or undefined if this command attempted none. Read by the
 * output layer so a failed write leaves the operator holding the handle it was sent under.
 */
export function getLastIdempotencyKey(): string | undefined {
  return lastKey;
}

/** Test seam: reset the per-process state this module accumulates. */
export function resetIdempotencyState(envKey?: string): void {
  lastKey = undefined;
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

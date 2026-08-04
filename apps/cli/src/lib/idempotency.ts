import { AsyncLocalStorage } from 'node:async_hooks';
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
 * What one async scope knows about the writes made inside it.
 *
 * `ambiguous` latches the moment two writes in the same scope overlap in time. At that point
 * "the key of the write that just failed" has no ambient answer, and reporting the wrong one is
 * worse than reporting none: the key is the handle an operator re-presents, so a key belonging
 * to a different write matches that other operation, returns its result, and leaves the write
 * they wanted undone while telling them it succeeded. Silent and confident is exactly the
 * failure this feature exists to prevent, so an ambiguous scope reports nothing.
 */
interface Scope {
  current?: string;
  active: number;
  ambiguous: boolean;
}

const storage = new AsyncLocalStorage<Scope>();

/**
 * Bind an idempotency scope for the duration of one logical operation.
 *
 * Ambient rather than a parameter, for the same reason `withRelayEnvelope` is in the backend
 * (apps/backend/src/services/relay-envelope.ts): around a hundred and twenty-eight commands call
 * `printError` with a bare message string, and threading a key through all of them would put the
 * rule in a hundred and twenty-eight places to be forgotten in one.
 *
 * Bind one per *concurrent* unit of work, not per process. `index.ts` binds one around command
 * dispatch, which is the whole of a one-shot command. Anything that forks -- the daemon's three
 * loops, `task submit`'s per-file uploads -- binds one per branch, because two branches writing
 * at once are two operations and only the branch that failed knows which key was its own.
 *
 * Code outside any scope reports no key at all. There is deliberately no process-wide fallback:
 * a long-lived process like the daemon has no such thing as "the write that just failed", and a
 * fallback that guessed would be right most of the time and catastrophically wrong occasionally.
 */
export function withIdempotencyScope<T>(fn: () => Promise<T>): Promise<T> {
  return storage.run({ active: 0, ambiguous: false }, fn);
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
 * Run one relayed write with `key` as its scope's current key. The transport wraps its whole
 * request in this, so the key is current for exactly as long as the write it names is in flight.
 *
 * An overlap detected here latches the scope ambiguous rather than letting the later write's key
 * quietly win. That is the safety net for a fork point nobody wrapped -- including one added
 * years from now by someone who never read this file: a missing scope degrades the report to no
 * key, never to another write's key.
 */
export async function withIdempotentWrite<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const scope = storage.getStore();
  if (scope === undefined) {
    return fn();
  }
  if (scope.active > 0 && scope.current !== key) {
    scope.ambiguous = true;
  }
  scope.active += 1;
  scope.current = key;
  try {
    return await fn();
  } finally {
    scope.active -= 1;
  }
}

/**
 * The key of the write this scope was last making, or undefined when the scope made no write or
 * cannot say unambiguously which write a failure belongs to. Read by the output layer so a
 * failed write leaves the operator holding the handle it was sent under.
 */
export function getCurrentIdempotencyKey(): string | undefined {
  const scope = storage.getStore();
  if (scope === undefined || scope.ambiguous) {
    return undefined;
  }
  return scope.current;
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

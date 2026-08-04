import { IDEMPOTENCY_KEY_HEADER } from '@taskmarket/shared';

/**
 * Operation context key a caller may set to supply its own idempotency key, so a component that
 * re-issues one logical write (a user pressing the same button again after an ambiguous result)
 * presents the write the backend already has rather than a second one.
 */
export const IDEMPOTENCY_CONTEXT_KEY = 'taskmarketIdempotencyKey';

type IdempotentOperation = { context?: Record<string, unknown> };

const generatedKeys = new WeakMap<object, string>();

/**
 * A client-generated key naming one logical write. It exists before the request is sent, which
 * is what makes it a recovery handle: the intent id the backend mints is only learnable from a
 * response the caller may never receive.
 */
export function newIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * The key for one tRPC operation. A caller-supplied key wins; otherwise one is minted per
 * operation and cached against it, so every send of that same operation carries one key.
 */
export function idempotencyKeyForOperation(op: IdempotentOperation): string {
  const supplied = op.context?.[IDEMPOTENCY_CONTEXT_KEY];
  if (typeof supplied === 'string' && supplied.length > 0) {
    return supplied;
  }
  const cached = generatedKeys.get(op);
  if (cached) {
    return cached;
  }
  const key = newIdempotencyKey();
  generatedKeys.set(op, key);
  return key;
}

/** Header block carrying the key for one operation. */
export function idempotencyHeadersForOperation(op: IdempotentOperation): Record<string, string> {
  return { [IDEMPOTENCY_KEY_HEADER]: idempotencyKeyForOperation(op) };
}

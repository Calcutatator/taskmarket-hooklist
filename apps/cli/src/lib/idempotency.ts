import { randomUUID } from 'node:crypto';

import { IDEMPOTENCY_KEY_HEADER } from '@taskmarket/shared';

/**
 * A client-generated key naming one logical write. Generated before the request is sent, so it
 * is the one identifier a caller still holds when the response never arrives -- the intent id
 * the backend mints is only learnable from a response the caller may never see.
 */
export function newIdempotencyKey(): string {
  return randomUUID();
}

/**
 * Header block for one logical operation. Every request that belongs to that operation carries
 * the same key, including both rounds of an x402 exchange: rounds one and two are one write, and
 * a fresh key on round two would present the paid retry as a new operation.
 */
export function idempotencyHeaders(key: string): Record<string, string> {
  return { [IDEMPOTENCY_KEY_HEADER]: key };
}

import { sql } from 'drizzle-orm';
import { agents } from '../db/schema';

/**
 * Case-insensitive equality for agents.address. Addresses arrive from many sources
 * (X402 payer context, on-chain event data, user input) with inconsistent casing --
 * identity registration always lowercases before writing (see identity.router.ts),
 * but not every caller does, so lowering both sides here is the only match that's
 * safe regardless of what's actually stored or what casing the caller passed in.
 */
export function lowerAddressEq(address: string) {
  return sql`lower(${agents.address}) = lower(${address})`;
}

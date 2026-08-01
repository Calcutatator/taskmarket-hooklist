import type { PgColumn } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import type { db as DbType } from '../db/client';

type Database = typeof DbType;

/**
 * The transaction handle type `db.transaction(async (tx) => ...)` passes to its callback --
 * derived structurally from `Database['transaction']` rather than imported from drizzle
 * directly, so this stays correct if the concrete driver (`postgres-js` today) ever changes.
 */
export type Transaction = Parameters<Database['transaction']>[0] extends (
  tx: infer T,
  ...args: never[]
) => unknown
  ? T
  : never;

/**
 * Implements: ADR-0038
 *
 * A fixed, permanent ceiling check: read-only against an existing, already-recorded data
 * source, compared to a threshold. No new table, no owned state -- this is what
 * RFC-0006 Tier 2 (ADR-0037) uses via `isOverHardSubmissionCeiling`
 * (apps/backend/src/services/submission-allowance.ts). `database` is accepted for parity
 * with this module's other export and so callers/tests can pass it through uniformly, even
 * though this function itself never queries it directly -- `params.count` owns the actual
 * query, and callers construct that closure against whatever table/columns their fixed
 * ceiling is counting.
 */
export async function isOverFixedCeiling(
  database: Database | Transaction,
  params: {
    count: () => Promise<number>;
    ceiling: number;
  }
): Promise<boolean> {
  void database;
  const priorCount = await params.count();
  return priorCount >= params.ceiling;
}

/**
 * Structural shape shared by `taskDropSubscribeRateLimits` and
 * `taskAccessPasswordRateLimits` (apps/backend/src/db/schema.ts) -- both are
 * `{ key: text primary key, windowStartedAt: timestamp, attempts: integer, updatedAt:
 * timestamp }`. Any table matching this shape can be driven by `consumeSlidingWindowAttempt`
 * without changing its schema.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface SlidingWindowTable {
  key: PgColumn<any>;
  windowStartedAt: PgColumn<any>;
  attempts: PgColumn<any>;
  updatedAt: PgColumn<any>;
}

/**
 * Thrown by `consumeSlidingWindowAttempt` only when the upsert's `RETURNING` clause comes
 * back with no row -- practically never under real Postgres upsert semantics, but both
 * pre-existing callers defensively guarded against it with their own message. Each caller
 * catches this specific error (via `instanceof`, not a blanket catch) and rethrows its own
 * existing message, preserving its exact prior error contract and test expectations. Any
 * other error (e.g. a genuine DB failure) is left to propagate unchanged.
 */
export class SlidingWindowRecordError extends Error {}

/**
 * Implements: ADR-0038
 *
 * A generalized time-windowed (sliding-window) rate-limit check: parameterized version of
 * the CASE-WHEN reset-or-increment upsert SQL that `task-drop-subscribe-rate-limit.ts` and
 * `task-access-password.ts` previously each implemented independently against their own,
 * identically-shaped table. Takes the transaction, it does not open one -- both existing
 * callers already manage their own `db.transaction(...)` (one to check two keys inside a
 * single transaction, one to check a single key); this function is called from inside that
 * caller-owned transaction, once per key.
 *
 * Returns the raw `{ attempts, overLimit }` -- it does not throw. Each caller keeps throwing
 * its own existing, differently-shaped error (`TRPCError` vs. a plain `Error`), preserving
 * each feature's exact prior error contract and its existing tests unchanged.
 *
 * `windowSeconds` is bound as a query parameter (not string-concatenated) so it stays a safe
 * bound parameter, not a raw-SQL injection risk.
 */
export async function consumeSlidingWindowAttempt(
  tx: Transaction,
  params: {
    table: SlidingWindowTable;
    key: string;
    windowSeconds: number;
    limit: number;
  }
): Promise<{ attempts: number; overLimit: boolean }> {
  const { table, key, windowSeconds, limit } = params;
  const now = new Date();

  const rows = await (tx as unknown as Database)
    .insert(table as never)
    .values({ attempts: 1, key, updatedAt: now, windowStartedAt: now } as never)
    .onConflictDoUpdate({
      target: table.key,
      set: {
        attempts: sql`CASE
          WHEN ${table.windowStartedAt} <= CURRENT_TIMESTAMP - (${windowSeconds} || ' seconds')::interval THEN 1
          ELSE ${table.attempts} + 1
        END`,
        updatedAt: now,
        windowStartedAt: sql`CASE
          WHEN ${table.windowStartedAt} <= CURRENT_TIMESTAMP - (${windowSeconds} || ' seconds')::interval
            THEN CURRENT_TIMESTAMP
          ELSE ${table.windowStartedAt}
        END`,
      },
    } as never)
    .returning({ attempts: table.attempts } as never);

  const attempts = (rows as Array<{ attempts: number }>)[0]?.attempts;
  if (attempts === undefined) {
    throw new SlidingWindowRecordError('consumeSlidingWindowAttempt: upsert returned no row');
  }
  return { attempts, overLimit: attempts > limit };
}

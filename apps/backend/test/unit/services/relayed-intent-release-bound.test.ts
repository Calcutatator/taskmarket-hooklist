// Verifies: ADR-0067
import { PgDialect } from 'drizzle-orm/pg-core';
import { afterAll, describe, expect, it } from 'vitest';
import { stubServerEnvironment } from '../../helpers/server-environment';

const restoreServerEnvironment = stubServerEnvironment();

const { releaseUnpaidReservation } = await import('../../../src/services/relayed-intents');

afterAll(restoreServerEnvironment);

const dialect = new PgDialect();

/**
 * Captures the predicate the DELETE was built with and renders it back to SQL.
 *
 * The whole safety property of this function is in its WHERE clause -- which rows it is capable
 * of deleting -- so the rendered predicate is the thing to assert on, and it can be asserted
 * without a live Postgres.
 */
function capturingDb() {
  const captured: { params: unknown[]; sql: string }[] = [];
  const db = {
    delete: () => ({
      where: async (predicate: { getSQL: () => never }) => {
        captured.push(dialect.sqlToQuery(predicate.getSQL()));
      },
    }),
  };
  return { captured, db };
}

describe('releasing an unpaid reservation', () => {
  /**
   * The x402 middleware's catch block calls this after any failure, including ones that happen
   * after the settle call was made -- a timeout, a 502, a `success: false`. In none of those can
   * the middleware establish that no money moved, so the bound has to live here, in the query,
   * rather than in each caller's judgement about whether calling is safe.
   */
  it('cannot touch a row that names a payment authorization', async () => {
    const { captured, db } = capturingDb();

    await releaseUnpaidReservation({ db: db as never, intentId: 'intent-1' });

    expect(captured).toHaveLength(1);
    // The write-ahead record is written before the settle call, so any row whose settle call was
    // reached has a non-null `payment_auth_nonce` and falls outside this predicate. That is what
    // makes "the key stays held after a facilitator outage" a property of the code rather than a
    // hope: the delete simply matches nothing, and the row is left for the reservation sweep,
    // which can ask the token contract whether the authorization was consumed.
    expect(captured[0]?.sql).toContain('"payment_auth_nonce" is null');
    // And only a reservation: a row that has moved on to `recorded` or beyond owns real work,
    // and deleting it would strand whatever it started.
    expect(captured[0]?.params).toContain('reserved');
    expect(captured[0]?.params).toContain('intent-1');
  });
});

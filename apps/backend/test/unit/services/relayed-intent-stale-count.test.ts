import { PgDialect } from 'drizzle-orm/pg-core';
import { afterAll, describe, expect, it } from 'vitest';
import { stubServerEnvironment } from '../../helpers/server-environment';

const restoreServerEnvironment = stubServerEnvironment();

const { STALE_INTENT_AFTER_MS, countStaleNonTerminalIntents } = await import(
  '../../../src/services/relayed-intents'
);

afterAll(restoreServerEnvironment);

const dialect = new PgDialect();

/**
 * Captures the predicate the SELECT was built with and renders it back to SQL.
 *
 * Which rows this counter counts is decided entirely in the WHERE clause -- the count itself is
 * the database's answer, not the application's -- so the rendered predicate is what there is to
 * assert on without a live Postgres.
 */
function capturingDb(countValue: number) {
  const captured: { params: unknown[]; sql: string }[] = [];
  const db = {
    select: () => ({
      from: () => ({
        where: async (predicate: { getSQL: () => never }) => {
          captured.push(dialect.sqlToQuery(predicate.getSQL()));
          return [{ value: countValue }];
        },
      }),
    }),
  };
  return { captured, db };
}

const NOW = new Date('2026-08-06T12:00:00.000Z');

describe('stale non-terminal intent count', () => {
  it('counts an intent that is non-terminal and has stopped moving', async () => {
    const { captured, db } = capturingDb(3);

    const count = await countStaleNonTerminalIntents({ db: db as never, now: NOW });

    // Both halves have to be present for a stuck row to be counted at all: the status set that
    // says it can still move, and an `updated_at` older than the staleness cutoff.
    expect(count).toBe(3);
    expect(captured).toHaveLength(1);
    expect(captured[0]?.params).toEqual(
      expect.arrayContaining(['reserved', 'recorded', 'broadcast'])
    );
    expect(captured[0]?.sql).toContain('"updated_at" < ');
  });

  it('does not count an intent that was touched recently', async () => {
    const { captured, db } = capturingDb(0);

    await countStaleNonTerminalIntents({ db: db as never, now: NOW });

    // The cutoff is `now` minus the threshold and the comparison is strictly `<`, so a row
    // updated at any point since then is outside the predicate. A counter with no such bound
    // would report every intent merely in flight, which is the normal case, not a problem.
    const cutoff = new Date(NOW.getTime() - STALE_INTENT_AFTER_MS);
    const bounds = (captured[0]?.params ?? [])
      .map((param) => new Date(String(param)).getTime())
      .filter((time) => Number.isFinite(time));
    expect(bounds).toContain(cutoff.getTime());
    expect(cutoff.getTime()).toBeLessThan(NOW.getTime());
  });

  it('does not count a terminal intent', async () => {
    const { captured, db } = capturingDb(0);

    await countStaleNonTerminalIntents({ db: db as never, now: NOW });

    // Stated as a positive `IN` over the three non-terminal statuses rather than a `NOT IN` over
    // the terminal two, so a completed or failed row cannot match however old it is -- and the
    // status index stays usable on what is a frequently polled endpoint.
    expect(captured[0]?.sql).toContain('"status" in ');
    expect(captured[0]?.params).not.toContain('completed');
    expect(captured[0]?.params).not.toContain('failed');
  });
});

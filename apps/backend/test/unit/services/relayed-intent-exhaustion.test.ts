// Verifies: ADR-0050, ADR-0052
import { PgDialect } from 'drizzle-orm/pg-core';
import { afterAll, describe, expect, it } from 'vitest';
import { stubServerEnvironment } from '../../helpers/server-environment';

const restoreServerEnvironment = stubServerEnvironment();

const { listAbandonedIntents, listUnbroadcastIntents, MAX_BROADCAST_ATTEMPTS } = await import(
  '../../../src/services/relayed-intents'
);
const { RELAY_VALID_WINDOW_SECS } = await import('../../../src/services/relay-envelope');
const { INTENT_ORPHAN_GRACE_MS } = await import('../../../src/services/relayed-intent-worker');

afterAll(restoreServerEnvironment);

const dialect = new PgDialect();

/** Captures the WHERE clause a SELECT was built with and renders it back to SQL. */
function capturingSelectDb() {
  const captured: { params: unknown[]; sql: string }[] = [];
  const chain: Record<string, unknown> = {};
  Object.assign(chain, {
    from: () => chain,
    limit: async () => [],
    orderBy: () => chain,
    where: (predicate: { getSQL: () => never }) => {
      captured.push(dialect.sqlToQuery(predicate.getSQL()));
      return chain;
    },
  });
  return { captured, db: { select: () => chain } };
}

const NOW = new Date('2026-08-03T00:00:00Z');
const NOW_SECONDS = Math.floor(NOW.getTime() / 1000);

describe('retry exhaustion consults the deadline, not only the attempt cap', () => {
  it('will not rebroadcast an intent whose relay receipt has already expired', async () => {
    const { captured, db } = capturingSelectDb();

    await listUnbroadcastIntents({ cutoff: NOW, db: db as never, limit: 10, now: NOW });

    // The bound ADR-0050 says governs. Without this clause the query would happily keep
    // rebroadcasting a payload the forwarder now rejects with ReceiptExpired, burning
    // attempts on a call that cannot land whatever we do with it.
    expect(captured).toHaveLength(1);
    expect(captured[0]?.sql).toContain('"relay_valid_before"');
    expect(captured[0]?.params).toContain(NOW_SECONDS);
  });

  it('treats an expired receipt as exhausted even with attempts left in the budget', async () => {
    const { captured, db } = capturingSelectDb();

    await listAbandonedIntents({ cutoff: NOW, db: db as never, limit: 10, now: NOW });

    // Reaching settlement must not require the attempt counter to have run out. An intent
    // whose deadline passed after two attempts is as finished as one that spent twenty, and
    // before this it would have sat in `recorded` being skipped until the cap caught up.
    expect(captured).toHaveLength(1);
    expect(captured[0]?.sql).toContain('"relay_valid_before"');
    expect(captured[0]?.sql).toContain('"broadcast_attempts"');
    expect(captured[0]?.params).toContain(NOW_SECONDS);
  });

  it('keeps the attempt cap clear of the deadline, so it never becomes the governing bound', () => {
    // The arithmetic that used to be the *only* thing making the deadline govern. An intent
    // is retried at most once per orphan-grace window, so this many attempts are reachable
    // before its receipt expires. If the cap sits below that, a still-valid receipt gets
    // abandoned and refunded because a constant ran out -- ADR-0050 calls that out
    // explicitly, and this test is what fails when someone lowers the cap or raises the
    // grace. The deadline clauses above mean the failure is now a wasted retry budget rather
    // than a wrong refund, which is why this is an assertion about tuning, not correctness.
    const attemptsReachableInsideTheWindow = Math.ceil(
      (RELAY_VALID_WINDOW_SECS * 1000) / INTENT_ORPHAN_GRACE_MS
    );

    expect(MAX_BROADCAST_ATTEMPTS).toBeGreaterThan(attemptsReachableInsideTheWindow);
  });
});

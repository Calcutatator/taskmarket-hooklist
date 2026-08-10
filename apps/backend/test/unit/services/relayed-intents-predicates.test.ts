// Verifies: ADR-0045, ADR-0050
import { PgDialect } from 'drizzle-orm/pg-core';
import { afterAll, describe, expect, it } from 'vitest';
import { stubServerEnvironment } from '../../helpers/server-environment';

const restoreServerEnvironment = stubServerEnvironment();

const { claimIntentForBroadcast, markIntentFailed } = await import(
  '../../../src/services/relayed-intents'
);

afterAll(restoreServerEnvironment);

const dialect = new PgDialect();

/**
 * Captures the predicate an UPDATE was built with and renders it back to SQL.
 *
 * These fixes live entirely in the WHERE clause -- they are the difference between a check made
 * in application code, which is stale the moment two callers race, and one the database applies
 * to the row it is about to write. Asserting on the rendered SQL is the only way to tell those
 * two apart from a test.
 */
function capturingDb() {
  const captured: { params: unknown[]; sql: string }[] = [];
  const db = {
    update: () => ({
      set: () => ({
        where: (predicate: { getSQL: () => never }) => {
          captured.push(dialect.sqlToQuery(predicate.getSQL()));
          const chain = {
            returning: async () => [],
            then: (onfulfilled?: (value: undefined) => unknown) =>
              Promise.resolve(undefined).then(onfulfilled),
          };
          return chain;
        },
      }),
    }),
  };
  return { captured, db };
}

describe('relayed intent write predicates', () => {
  it('never lets a failure verdict overwrite a completed intent', async () => {
    const { captured, db } = capturingDb();

    await markIntentFailed({ db: db as never, intentId: 'intent-1', reason: 'reverted' });

    // A read-then-write in the caller loses this race: settlement can be reading a
    // replacement's verdict while the request that owns the intent is completing it. Marking a
    // completed intent failed hides work that demonstrably happened and, on a paid intent,
    // points settlement at a refund for something the requester already has.
    expect(captured).toHaveLength(1);
    expect(captured[0]?.sql).toContain('"status" <> ');
    expect(captured[0]?.params).toContain('completed');
  });

  it('claims an intent for broadcast only if nobody else has attempted it since the read', async () => {
    const { captured, db } = capturingDb();

    const claimed = await claimIntentForBroadcast({
      db: db as never,
      expectedAttempts: 2,
      intentId: 'intent-1',
    });

    // `recorded` stays `recorded` across a broadcast attempt by design, so status alone lets two
    // passes that listed the same intent in the same window both claim it and both spend a
    // nonce. The attempt counter is the only field that moves, so comparing it against the value
    // the caller read is what makes the claim exclusive.
    expect(claimed).toBeNull();
    expect(captured).toHaveLength(1);
    expect(captured[0]?.sql).toContain('"broadcast_attempts" = ');
    expect(captured[0]?.params).toContain(2);
    expect(captured[0]?.params).toContain('recorded');
  });

  it('records the broadcast hash even when the outbox lookup fails', async () => {
    // The hash write is what stops the rebroadcast sweep reading a live transaction as one that
    // never reached the chain; the outbox id only decides who settles it. Losing the first
    // because the second failed is a second nonce spent on work already on chain.
    const { linkIntentToBroadcast } = await import('../../../src/services/relayed-intents');
    const writes: Record<string, unknown>[] = [];
    const db = {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => {
              throw new Error('outbox read failed');
            },
          }),
        }),
      }),
      update: () => ({
        set: (values: Record<string, unknown>) => ({
          where: () => ({
            then: (onfulfilled?: (value: undefined) => unknown) => {
              writes.push(values);
              return Promise.resolve(undefined).then(onfulfilled);
            },
          }),
        }),
      }),
    };

    await linkIntentToBroadcast({
      db: db as never,
      intentId: 'intent-1',
      txHash: `0x${'ab'.repeat(32)}`,
    });

    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({ status: 'broadcast', txHash: `0x${'ab'.repeat(32)}` });
  });
});

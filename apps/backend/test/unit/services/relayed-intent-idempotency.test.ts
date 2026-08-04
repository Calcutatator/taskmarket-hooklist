// Verifies: ADR-0052
import { PgDialect } from 'drizzle-orm/pg-core';
import { afterAll, describe, expect, it } from 'vitest';
import { stubServerEnvironment } from '../../helpers/server-environment';

const restoreServerEnvironment = stubServerEnvironment();

const { derivedIdempotencyKey, recordRelayedIntent } = await import(
  '../../../src/services/relayed-intents'
);

afterAll(restoreServerEnvironment);

const KEY = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const PAYER = '0x1111111111111111111111111111111111111111';
const OTHER_PAYER = '0x2222222222222222222222222222222222222222';
const PAYMENT = `0x${'99'.repeat(32)}`;

type StoredRow = Record<string, unknown>;

const dialect = new PgDialect();

/**
 * A database that behaves like the unique indexes do: an insert whose key or payment hash is
 * already taken writes nothing, and the caller has to go and look at what is there.
 *
 * That shape is the whole point of the mechanism, so a double that just returned whatever it
 * was given would test nothing.
 */
function indexedDb(rows: StoredRow[] = []) {
  const db = {
    insert: () => ({
      values: (values: StoredRow) => ({
        onConflictDoNothing: () => ({
          returning: async () => {
            const taken = rows.some(
              (row) =>
                row.idempotencyKey === values.idempotencyKey ||
                (Boolean(values.paymentTxHash) && row.paymentTxHash === values.paymentTxHash)
            );
            if (taken) return [];
            rows.push(values);
            return [values];
          },
        }),
      }),
    }),
    // The two post-conflict lookups are told apart by the column they filter on, read off
    // the rendered predicate -- the same way the real query would be told apart in a log.
    select: () => ({
      from: () => ({
        where: (predicate: { getSQL: () => never }) => ({
          limit: async () => {
            const query = dialect.sqlToQuery(predicate.getSQL());
            const column = query.sql.includes('payment_tx_hash')
              ? 'paymentTxHash'
              : 'idempotencyKey';
            return rows.filter((row) => row[column] === query.params[0]);
          },
        }),
      }),
    }),
  };
  return { db, rows };
}

function record(overrides: Record<string, unknown> = {}) {
  const db = overrides.db ?? indexedDb().db;
  return recordRelayedIntent({
    idempotencyKey: KEY,
    operation: 'tasks.create',
    payer: PAYER,
    payload: {},
    ...(overrides as Record<string, never>),
    db: db as never,
  } as never);
}

describe('recordRelayedIntent idempotency', () => {
  it('rejects a relayed write with no key, and one whose key is not a UUID', async () => {
    // Mandatory with no fallback: the whole decision collapses if any operation may omit it,
    // because a caller cannot then rely on retrying being safe anywhere.
    await expect(record({ idempotencyKey: undefined })).rejects.toThrow(/Idempotency-Key/);
    await expect(record({ idempotencyKey: 'retry-1' })).rejects.toThrow(/Idempotency-Key/);
  });

  it('returns the original intent when the same caller repeats the same key', async () => {
    const { db, rows } = indexedDb();

    const first = await record({ db });
    const second = await record({ db });

    expect(second.id).toBe(first.id);
    // One row, therefore one chain call: the repeat joins the write already in progress
    // instead of starting a second one.
    expect(rows).toHaveLength(1);
  });

  it('refuses a key that resolves to another payer’s intent', async () => {
    const { db } = indexedDb();
    await record({ db });

    // The column is globally unique, so two callers can name the same intent. Handing the
    // second one the first one's row would leak a payer address, an amount and a payment
    // hash -- and would report someone else's write as their own.
    await expect(record({ db, payer: OTHER_PAYER })).rejects.toThrow(/already been used/);
  });

  it('refuses a fresh key that reuses a settled payment', async () => {
    const { db } = indexedDb();
    await record({ db, paymentTxHash: PAYMENT });

    // The payment index is no longer the idempotency mechanism, but it still guards the one
    // thing it was always really guarding: one settled payment funds at most one intent.
    await expect(
      record({ db, idempotencyKey: 'ffffffff-1111-4222-8333-444444444444', paymentTxHash: PAYMENT })
    ).rejects.toThrow(/already funded/);
  });

  it('derives a stable key for follow-on work so a rerun does not duplicate it', () => {
    // Completion is at-least-once, so a handler that records follow-on work is rerun. A
    // random key each time would record a second follow-on intent and make a second chain
    // call for work already under way.
    expect(derivedIdempotencyKey('task-1:tasks.assignEvaluator')).toBe(
      derivedIdempotencyKey('task-1:tasks.assignEvaluator')
    );
    expect(derivedIdempotencyKey('task-1:tasks.assignEvaluator')).not.toBe(
      derivedIdempotencyKey('task-2:tasks.assignEvaluator')
    );
    // It has to satisfy the same validation a client key does, or it could never be stored.
    expect(derivedIdempotencyKey('task-1:x')).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );
  });
});

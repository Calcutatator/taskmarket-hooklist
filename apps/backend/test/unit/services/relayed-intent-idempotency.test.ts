// Verifies: ADR-0052, ADR-0061
import { PgDialect } from 'drizzle-orm/pg-core';
import { afterAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { stubServerEnvironment } from '../../helpers/server-environment';

const restoreServerEnvironment = stubServerEnvironment();

const { canonicalizeIntentPayload, derivedIdempotencyKey, recordRelayedIntent } =
  await import('../../../src/services/relayed-intents');

afterAll(restoreServerEnvironment);

const KEY = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const PAYER = '0x1111111111111111111111111111111111111111';
const OTHER_PAYER = '0x2222222222222222222222222222222222222222';
const PAYMENT = `0x${'99'.repeat(32)}`;

/**
 * A payment reference is whole or absent, so a test cannot name one by its hash alone any
 * more than production can -- which is the point of the type (ADR-0048).
 */
function settledPayment() {
  return { amount: 1_000n, payer: PAYER, txHash: PAYMENT as `0x${string}` };
}

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
            // The payload column is `jsonb`, so what comes back out is never the object that
            // went in -- key order is gone, an `undefined` entry has been dropped, a `Date` is
            // a string. The payload comparison (ADR-0061) is decided entirely by whether it
            // survives that trip, so the double has to take it too; a double that handed the
            // original object back would prove nothing about the thing being tested.
            const stored = {
              ...values,
              payload: JSON.parse(JSON.stringify(values.payload ?? null)),
            };
            rows.push(stored);
            return [stored];
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
    await record({ db, payment: settledPayment() });

    // The payment index is no longer the idempotency mechanism, but it still guards the one
    // thing it was always really guarding: one settled payment funds at most one intent.
    await expect(
      record({
        db,
        idempotencyKey: 'ffffffff-1111-4222-8333-444444444444',
        payment: settledPayment(),
      })
    ).rejects.toThrow(/already funded/);
  });

  it('returns the original intent when a retry re-sends the same arguments a different way', async () => {
    // The mechanism working, and the direction that must not break: this is the documented
    // recovery path (`TASKMARKET_IDEMPOTENCY_KEY`), so a retry that serialises its arguments
    // in a different key order, or spells an omitted field as an explicit `undefined`, is the
    // same write and has to be answered as one (ADR-0061).
    const { db, rows } = indexedDb();

    const first = await record({
      db,
      payload: { taskId: 't-1', reward: '1000', artifacts: [{ role: 'main', order: 0 }] },
    });
    const second = await record({
      db,
      payload: {
        artifacts: [{ order: 0, role: 'main' }],
        reward: '1000',
        taskId: 't-1',
        estimatedDuration: undefined,
      },
    });

    expect(second.id).toBe(first.id);
    expect(rows).toHaveLength(1);
  });

  it('refuses a retry that reuses the key with different arguments', async () => {
    const { db, rows } = indexedDb();
    await record({ db, payload: { taskId: 't-1', reward: '1000' } });

    // An operator taking the key off a failed envelope and re-running with a corrected reward
    // used to be handed the first write and told it succeeded. The write they described never
    // happened, and nothing said so.
    const refused = await record({ db, payload: { taskId: 't-1', reward: '5000' } }).catch(
      (error: { envelope?: { reason?: string }; message: string }) => error
    );

    expect((refused as { envelope?: { reason?: string } }).envelope?.reason).toBe(
      'idempotency_key_payload_mismatch'
    );
    // The message has to say what to do, because the two remedies are opposite and the caller
    // is the only one who knows which write they meant.
    expect((refused as Error).message).toMatch(/re-send the arguments it was created with/i);
    expect((refused as Error).message).toMatch(/generate a fresh key/i);
    expect(rows).toHaveLength(1);
  });

  it('canonicalises a payload to the form it comes back from jsonb as', () => {
    const payload = {
      taskId: 't-1',
      reward: 1_000n,
      deadline: new Date('2026-01-01T00:00:00.000Z'),
      note: undefined,
      artifacts: [{ order: 0, role: 'main' }],
    };

    // The round trip is what the stored side has been through, so the canonical form has to be
    // a fixed point of it -- otherwise no payload could ever equal its own stored copy.
    const roundTripped = JSON.parse(
      JSON.stringify(payload, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))
    );
    expect(canonicalizeIntentPayload(payload)).toBe(canonicalizeIntentPayload(roundTripped));

    // Key order and present-but-undefined are both invisible to jsonb, so they must be
    // invisible here too.
    expect(canonicalizeIntentPayload({ a: 1, b: 2 })).toBe(
      canonicalizeIntentPayload({ b: 2, a: 1 })
    );
    expect(canonicalizeIntentPayload({ a: 1, b: undefined })).toBe(
      canonicalizeIntentPayload({ a: 1 })
    );

    // What must still be told apart: a different value, and a differently ordered array.
    expect(canonicalizeIntentPayload({ a: 1 })).not.toBe(canonicalizeIntentPayload({ a: 2 }));
    expect(canonicalizeIntentPayload([1, 2])).not.toBe(canonicalizeIntentPayload([2, 1]));
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

  it('produces a key that is actually a UUID, not merely UUID-shaped', () => {
    // Our own pattern above is loose enough that raw digest nibbles passed it, but the version
    // and variant nibbles were whatever the hash happened to give -- so `z.string().uuid()`,
    // which any validator on this value could reasonably be written with, rejected it fifteen
    // times in sixteen. Checked over many scopes because a single sample passes by luck.
    for (let index = 0; index < 200; index++) {
      const key = derivedIdempotencyKey(`task-${index}:tasks.assignEvaluator`);
      expect(z.string().uuid().safeParse(key).success, key).toBe(true);
    }
  });

  it('keeps the same key across a rerun even with the version and variant bits set', () => {
    // Determinism is the whole point (ADR-0052 point 8): a completion handler rerun has to
    // collapse onto the same follow-on intent rather than record a second one and make a
    // second chain call. Stamping fixed bits at fixed positions preserves that exactly, and
    // this pins it against the substitution being made scope-dependent later.
    expect(derivedIdempotencyKey('proof-9:proofs.anchorDeliverable')).toBe(
      derivedIdempotencyKey('proof-9:proofs.anchorDeliverable')
    );
    expect(derivedIdempotencyKey('proof-9:proofs.anchorDeliverable')).not.toBe(
      derivedIdempotencyKey('proof-10:proofs.anchorDeliverable')
    );
  });
});

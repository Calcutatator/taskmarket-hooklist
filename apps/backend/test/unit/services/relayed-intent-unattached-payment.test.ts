// Verifies: ADR-0048, ADR-0052
import { PgDialect } from 'drizzle-orm/pg-core';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { stubServerEnvironment } from '../../helpers/server-environment';

const restoreServerEnvironment = stubServerEnvironment();

type UnattachedPaymentInput = {
  amount: bigint;
  context: string;
  failureReason: string;
  payer: string;
  paymentTxHash: string;
};

const recordUnattachedPayment = vi.fn<[UnattachedPaymentInput], Promise<void>>(
  async () => undefined
);

vi.mock('../../../src/services/orphaned-payments', () => ({
  recordUnattachedPayment: (input: UnattachedPaymentInput) => recordUnattachedPayment(input),
}));

const { recordRelayedIntent } = await import('../../../src/services/relayed-intents');

afterAll(restoreServerEnvironment);

const KEY = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const OTHER_KEY = 'ffffffff-1111-4222-8333-444444444444';
const PAYER = '0x1111111111111111111111111111111111111111';
const OTHER_PAYER = '0x2222222222222222222222222222222222222222';
const FIRST_PAYMENT = `0x${'99'.repeat(32)}` as `0x${string}`;
const SECOND_PAYMENT = `0x${'88'.repeat(32)}` as `0x${string}`;

type StoredRow = Record<string, unknown>;

const dialect = new PgDialect();

/** The same shape as relayed-intent-idempotency.test.ts's double: the unique indexes decide. */
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
    // The reservation fill (ADR-0067): `recordRelayedIntent` now tries to turn an existing
    // `reserved` row into a recorded one before it inserts anything. This double holds no
    // reservations -- every row in it arrives through the insert above -- so the fill matches
    // nothing and the insert-then-interpret-the-conflict path these tests exercise is reached
    // exactly as before. Modelled rather than stubbed to `[]` so that a test that does seed a
    // reservation gets the real behaviour instead of a silent no-match.
    update: () => ({
      set: (values: StoredRow) => ({
        where: (predicate: { getSQL: () => never }) => ({
          returning: async () => {
            const query = dialect.sqlToQuery(predicate.getSQL());
            const row = rows.find(
              (candidate) =>
                candidate.idempotencyKey === query.params[0] && candidate.status === 'reserved'
            );
            if (!row) return [];
            Object.assign(row, values);
            return [row];
          },
        }),
      }),
    }),
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

function payment(txHash: `0x${string}`, payer = PAYER) {
  return { amount: 1_000n, payer, txHash };
}

function record(overrides: Record<string, unknown>) {
  return recordRelayedIntent({
    idempotencyKey: KEY,
    operation: 'tasks.create',
    payload: {},
    ...(overrides as Record<string, never>),
  } as never);
}

/**
 * The double charge x402's pre-settlement idempotency check cannot close on its own.
 *
 * Two concurrent requests carrying one key both read "key is free" in middleware/x402.ts and
 * both have their authorization settled by the facilitator. Only then does `recordRelayedIntent`
 * see the collision -- and by then the loser's money has already moved. Whatever this function
 * answers, that payment funded nothing and nothing downstream will ever attach it: this is the
 * only code that attaches a payment to an intent, and it has just declined to.
 *
 * Recording it is the floor. Refunding is a separate judgement that ADR-0048 reserves for intent
 * settlement, so it is not made here; what must not happen is the payment leaving no trace at
 * all, which is what "no intent, no ledger row, nothing logged" means for the payer.
 */
describe('a settled payment that recordRelayedIntent cannot attach', () => {
  beforeEach(() => {
    recordUnattachedPayment.mockClear();
  });

  it('records the loser of a concurrent same-key race, which is answered with the winner', async () => {
    const { db, rows } = indexedDb();

    const first = await record({ db, payment: payment(FIRST_PAYMENT) });
    const second = await record({ db, payment: payment(SECOND_PAYMENT) });

    // The caller is handed the write already in progress -- correct, and the reason this is
    // silent: nothing throws, so nothing anywhere else notices the second payment.
    expect(second.id).toBe(first.id);
    expect(rows).toHaveLength(1);

    expect(recordUnattachedPayment).toHaveBeenCalledTimes(1);
    expect(recordUnattachedPayment.mock.calls[0]?.[0]).toMatchObject({
      amount: 1_000n,
      payer: PAYER,
      paymentTxHash: SECOND_PAYMENT,
    });
  });

  it('records the payment behind a key reused with different arguments', async () => {
    const { db } = indexedDb();
    await record({ db, payload: { reward: '1000' }, payment: payment(FIRST_PAYMENT) });

    await expect(
      record({ db, payload: { reward: '5000' }, payment: payment(SECOND_PAYMENT) })
    ).rejects.toThrow(/different arguments/);

    expect(recordUnattachedPayment.mock.calls[0]?.[0]).toMatchObject({
      paymentTxHash: SECOND_PAYMENT,
    });
  });

  it('records the payment behind a key that belongs to another payer', async () => {
    const { db } = indexedDb();
    await record({ db, payment: payment(FIRST_PAYMENT) });

    await expect(
      record({ db, payment: payment(SECOND_PAYMENT, OTHER_PAYER) })
    ).rejects.toThrow(/already been used/);

    expect(recordUnattachedPayment.mock.calls[0]?.[0]).toMatchObject({
      payer: OTHER_PAYER,
      paymentTxHash: SECOND_PAYMENT,
    });
  });

  it('does not record a payment that did fund the intent it is being told about', async () => {
    const { db } = indexedDb();
    await record({ db, payment: payment(FIRST_PAYMENT) });

    // `payment_already_spent`: the same payment hash, a fresh key. This payment bought the
    // earlier intent -- it is attached, not orphaned, and refunding it would take back money
    // that paid for a real write.
    await expect(
      record({ db, idempotencyKey: OTHER_KEY, payment: payment(FIRST_PAYMENT) })
    ).rejects.toThrow(/already funded/);

    expect(recordUnattachedPayment).not.toHaveBeenCalled();
  });

  it('records nothing for an unpaid write', async () => {
    const { db } = indexedDb();
    await record({ db, payer: PAYER });
    await record({ db, payer: PAYER });

    expect(recordUnattachedPayment).not.toHaveBeenCalled();
  });
});

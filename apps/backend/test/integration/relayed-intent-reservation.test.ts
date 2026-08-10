// Implements: ADR-0067
// Verifies: ADR-0070
import { randomUUID } from 'node:crypto';
import { apiErrorEnvelopeOf } from '@taskmarket/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { relayedIntents } from '../../src/db/schema';
import { createIsolatedMigratedDatabase } from '../helpers/integration-database';
import { stubServerEnvironment } from '../helpers/server-environment';

const isolatedDatabase = createIsolatedMigratedDatabase('intent_reservation');
const describeWithDatabase = isolatedDatabase.isAvailable ? describe : describe.skip;
const { database } = isolatedDatabase;

const restoreServerEnvironment = stubServerEnvironment();

const {
  claimIntentForBroadcast,
  listAbandonedIntents,
  listExpiredReservations,
  listUnbroadcastIntents,
  MAX_BROADCAST_ATTEMPTS,
  recordIntentPaymentAuthorization,
  recordRelayedIntent,
  releaseUnpaidReservation,
  reserveRelayedWrite,
} = await import('../../src/services/relayed-intents');

const PAYMENT = {
  amount: 1000n,
  payer: '0x3333333333333333333333333333333333333333',
  txHash: `0x${'cd'.repeat(32)}` as `0x${string}`,
};

describeWithDatabase('a relayed intent is reserved before it is paid for', () => {
  beforeAll(async () => {
    await isolatedDatabase.start();
  });

  afterAll(async () => {
    await isolatedDatabase.stop();
    restoreServerEnvironment();
  });

  beforeEach(async () => {
    await database.delete(relayedIntents);
  });

  it('claims the key, so a second claim on the same key is refused', async () => {
    const key = randomUUID();

    const first = await reserveRelayedWrite({ db: database, key, route: '/paid' });
    const second = await reserveRelayedWrite({ db: database, key, route: '/paid' });

    expect(first.intent?.status).toBe('reserved');
    expect(second.refusal?.status).toBe(409);
    expect(second.refusal?.envelope.reason).toBe('idempotency_key_reused');
    expect(second.refusal?.envelope.intentStatus).toBe('reserved');
    // Through the shared reader too: the reason asserts an intent exists, so the status is part
    // of the envelope's contract and one built without it would parse to nothing (ADR-0070).
    expect(apiErrorEnvelopeOf(second.refusal?.envelope)?.intentStatus).toBe('reserved');
  });

  /**
   * The middle of the three states ADR-0067 makes distinguishable, asserted as three states
   * rather than two. Before this, "no payment reference" meant "free write" and nothing else,
   * so this row and a `claims.claim` row would have been indistinguishable to every sweep.
   */
  it('is payment-required and unpaid, which a free write is not', async () => {
    const reserved = (await reserveRelayedWrite({ db: database, key: randomUUID() })).intent!;
    const free = await recordRelayedIntent({
      db: database,
      idempotencyKey: randomUUID(),
      operation: 'claims.claim',
      payload: { taskId: 't-1' },
    });

    expect([reserved.paymentRequired, reserved.paymentTxHash]).toEqual([true, null]);
    expect([free.paymentRequired, free.paymentTxHash]).toEqual([false, null]);
  });

  /**
   * The guard ADR-0067 names as the thing standing between a reservation and free execution of
   * a paid operation, tested against the queries that actually hand an intent to the chain
   * rather than against a comment claiming they exclude it.
   */
  it('is not broadcastable while it is reserved', async () => {
    const reserved = (await reserveRelayedWrite({ db: database, key: randomUUID() })).intent!;

    expect(
      await claimIntentForBroadcast({
        db: database,
        expectedAttempts: 0,
        intentId: reserved.id,
      })
    ).toBeNull();

    // A cutoff ahead of now, so nothing is excluded merely for being too recent: if the
    // reservation is absent it is because the query excludes reservations.
    const generousCutoff = new Date(Date.now() + 60_000);
    expect(
      await listUnbroadcastIntents({ cutoff: generousCutoff, db: database, limit: 10 })
    ).toHaveLength(0);

    // Nor by the abandoned path, which is the other way a `recorded` intent gets acted on.
    await database
      .update(relayedIntents)
      .set({ broadcastAttempts: MAX_BROADCAST_ATTEMPTS })
      .where(eq(relayedIntents.id, reserved.id));
    expect(await listAbandonedIntents({ cutoff: generousCutoff, db: database, limit: 10 })).toHaveLength(0);
  });

  it('becomes broadcastable in the same statement that attaches its payment', async () => {
    const key = randomUUID();
    await reserveRelayedWrite({ db: database, key });

    const filled = await recordRelayedIntent({
      db: database,
      idempotencyKey: key,
      operation: 'tasks.create',
      payment: PAYMENT,
      payload: { reward: '1000' },
    });

    expect(filled.status).toBe('recorded');
    expect(filled.operation).toBe('tasks.create');
    expect(filled.paymentRequired).toBe(true);
    expect(filled.paymentTxHash).toBe(PAYMENT.txHash);
    expect(filled.reservedExpiresAt).toBeNull();
    // One row throughout: the reservation *is* the intent, not a placeholder beside it.
    expect(await database.select().from(relayedIntents)).toHaveLength(1);

    // And it is claimable now that it is paid.
    expect(
      await claimIntentForBroadcast({ db: database, expectedAttempts: 0, intentId: filled.id })
    ).not.toBeNull();
  });

  it('surfaces an expired reservation to the sweep, and only once it has expired', async () => {
    const reserved = (await reserveRelayedWrite({ db: database, key: randomUUID() })).intent!;

    expect(await listExpiredReservations({ db: database, limit: 10 })).toHaveLength(0);
    expect(
      await listExpiredReservations({
        db: database,
        limit: 10,
        now: new Date(Date.now() + 60 * 60 * 1000),
      })
    ).toEqual([expect.objectContaining({ id: reserved.id })]);
  });

  /**
   * The write-ahead record is what makes expiry safe, so it must also be what stops a
   * reservation being handed back casually. Releasing a key on a refusal is fine only while
   * nothing was ever asked of the facilitator.
   */
  it('will not release a reservation once an authorization has been recorded against it', async () => {
    const reserved = (await reserveRelayedWrite({ db: database, key: randomUUID() })).intent!;
    await recordIntentPaymentAuthorization({
      db: database,
      amount: '1000',
      intentId: reserved.id,
      nonce: `0x${'11'.repeat(32)}`,
      payer: PAYMENT.payer,
    });

    await releaseUnpaidReservation({ db: database, intentId: reserved.id });
    expect(await database.select().from(relayedIntents)).toHaveLength(1);
  });

  it('releases a reservation that never recorded an authorization', async () => {
    const reserved = (await reserveRelayedWrite({ db: database, key: randomUUID() })).intent!;
    await releaseUnpaidReservation({ db: database, intentId: reserved.id });
    expect(await database.select().from(relayedIntents)).toHaveLength(0);
  });

  /**
   * An expired reservation whose owner never came back must not hold its key forever -- but
   * only when nothing was ever authorized against it, for the same reason releasing is
   * conditional above.
   */
  it('lets a new request take over an expired reservation with no authorization', async () => {
    const key = randomUUID();
    const first = (await reserveRelayedWrite({ db: database, key })).intent!;
    await database
      .update(relayedIntents)
      .set({ reservedExpiresAt: new Date(Date.now() - 1000) })
      .where(eq(relayedIntents.id, first.id));

    const second = await reserveRelayedWrite({ db: database, key });
    expect(second.intent).toBeDefined();
    expect(second.intent?.id).not.toBe(first.id);
    expect(await database.select().from(relayedIntents)).toHaveLength(1);
  });

  it('refuses to hand over an expired reservation that named an authorization', async () => {
    const key = randomUUID();
    const first = (await reserveRelayedWrite({ db: database, key })).intent!;
    await recordIntentPaymentAuthorization({
      db: database,
      amount: '1000',
      intentId: first.id,
      nonce: `0x${'22'.repeat(32)}`,
      payer: PAYMENT.payer,
    });
    await database
      .update(relayedIntents)
      .set({ reservedExpiresAt: new Date(Date.now() - 1000) })
      .where(eq(relayedIntents.id, first.id));

    expect((await reserveRelayedWrite({ db: database, key })).refusal?.status).toBe(409);
  });
});

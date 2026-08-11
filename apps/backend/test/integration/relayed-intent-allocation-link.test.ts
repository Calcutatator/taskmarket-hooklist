// Verifies: ADR-0069
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { relayedIntents, serverWalletTransactions } from '../../src/db/schema';
import { createIsolatedMigratedDatabase } from '../helpers/integration-database';
import { stubServerEnvironment } from '../helpers/server-environment';

const isolatedDatabase = createIsolatedMigratedDatabase('intent_alloc_link');
const describeWithDatabase = isolatedDatabase.isAvailable ? describe : describe.skip;
const { database } = isolatedDatabase;

const restoreServerEnvironment = stubServerEnvironment();

const { intentOutboxLink, listUnbroadcastIntents, markIntentBroadcast } =
  await import('../../src/services/relayed-intents');

const FUTURE_DEADLINE = String(Math.floor(Date.now() / 1000) + 3600);

async function reservedOutboxRow(): Promise<string> {
  const id = randomUUID();
  await database.insert(serverWalletTransactions).values({
    chainId: 84532,
    id,
    nonce: Math.floor(Math.random() * 1_000_000),
    status: 'reserved',
    walletAddress: '0x3333333333333333333333333333333333333333',
  });
  return id;
}

async function recordedIntent(): Promise<string> {
  const id = randomUUID();
  await database.insert(relayedIntents).values({
    chainId: 84532,
    id,
    idempotencyKey: randomUUID(),
    operation: 'tasks.assignEvaluator',
    payload: {},
    relayReceiptNonce: `0x${'00'.repeat(32)}`,
    relayValidBefore: FUTURE_DEADLINE,
    status: 'recorded',
    txHash: null,
    // Old enough that the worker's grace window has passed.
    updatedAt: new Date(Date.now() - 60 * 60 * 1000),
  });
  return id;
}

async function readIntent(id: string) {
  const [row] = await database.select().from(relayedIntents).where(eq(relayedIntents.id, id));
  return row;
}

async function unbroadcastIds(): Promise<string[]> {
  const rows = await listUnbroadcastIntents({
    cutoff: new Date(),
    db: database as never,
    limit: 50,
  });
  return rows.map((row) => row.id);
}

/**
 * The invariant ADR-0069 states, exercised on the query that depends on it.
 *
 * `listUnbroadcastIntents` treats "no outbox id and no hash" as positive evidence that nothing
 * was ever sent, and rebroadcasts on it -- and `settleAbandonedIntents` refunds on the same two
 * columns. That reading is only sound if the link is written when a nonce is allocated rather
 * than when a send returns, because a send that never returned is exactly the case where a
 * transaction may be mining.
 */
describeWithDatabase('an intent linked to its outbox row at allocation', () => {
  beforeAll(async () => {
    await isolatedDatabase.start();
  });

  afterAll(async () => {
    await isolatedDatabase.stop();
    restoreServerEnvironment();
  });

  it('is no longer read as one that never reached the chain', async () => {
    const intentId = await recordedIntent();
    expect(await unbroadcastIds()).toContain(intentId);

    // What the dispatcher does the moment a nonce exists, before any send.
    const link = intentOutboxLink(database as never, intentId);
    await link.onAllocated(await reservedOutboxRow());

    // A nonce is out there for this intent, so it is neither rebroadcast nor refundable -- the
    // two columns settleAbandonedIntents reads now say a transaction could be live.
    expect(await unbroadcastIds()).not.toContain(intentId);
  });

  it('is returned to the pool only when the nonce is released', async () => {
    const intentId = await recordedIntent();
    const link = intentOutboxLink(database as never, intentId);
    await link.onAllocated(await reservedOutboxRow());
    expect(await unbroadcastIds()).not.toContain(intentId);

    // The one branch that has positive evidence the nonce was never spent.
    await link.onReleased();

    expect((await readIntent(intentId))?.serverWalletTransactionId).toBeNull();
    expect(await unbroadcastIds()).toContain(intentId);
  });

  it('keeps its link when the broadcast write cannot supply one', async () => {
    const intentId = await recordedIntent();
    const outboxId = await reservedOutboxRow();
    await intentOutboxLink(database as never, intentId).onAllocated(outboxId);

    // `linkIntentToBroadcast` tolerates its outbox lookup failing and writes the hash alone.
    // That path must not take the allocation link off on its way past.
    await markIntentBroadcast({
      db: database as never,
      intentId,
      txHash: `0x${'ab'.repeat(32)}`,
    });

    const intent = await readIntent(intentId);
    expect(intent?.serverWalletTransactionId).toBe(outboxId);
    expect(intent?.status).toBe('broadcast');
  });
});

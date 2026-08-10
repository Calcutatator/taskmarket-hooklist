// Verifies: ADR-0045
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { relayedIntents, serverWalletTransactions } from '../../src/db/schema';
import { createIsolatedMigratedDatabase } from '../helpers/integration-database';
import { stubServerEnvironment } from '../helpers/server-environment';

const isolatedDatabase = createIsolatedMigratedDatabase('intent_unlinked');
const describeWithDatabase = isolatedDatabase.isAvailable ? describe : describe.skip;
const { database } = isolatedDatabase;

const restoreServerEnvironment = stubServerEnvironment();

const { listConfirmedUnsettledIntents } = await import('../../src/services/relayed-intents');

async function outboxRow(txHash: string, status: string): Promise<string> {
  const id = randomUUID();
  await database.insert(serverWalletTransactions).values({
    id,
    walletAddress: '0x3333333333333333333333333333333333333333',
    chainId: 84532,
    nonce: Math.floor(Math.random() * 1_000_000),
    status,
    txHash,
  });
  return id;
}

async function intentRow(fields: {
  serverWalletTransactionId?: string;
  status: string;
  txHash: string | null;
}): Promise<string> {
  const id = randomUUID();
  await database.insert(relayedIntents).values({
    id,
    idempotencyKey: randomUUID(),
    operation: 'tasks.assignEvaluator',
    payload: {},
    relayReceiptNonce: `0x${'00'.repeat(32)}`,
    relayValidBefore: '0',
    serverWalletTransactionId: fields.serverWalletTransactionId ?? null,
    status: fields.status,
    txHash: fields.txHash,
  });
  return id;
}

/**
 * The state the code comment promised was recoverable and was not.
 *
 * `linkIntentToBroadcast` writes two things and tolerates losing one of them: if the outbox
 * lookup by hash fails, the hash is still recorded but the outbox id is not, and it says a
 * missing id is recovered by `listConfirmedUnsettledIntents`. That was only ever true when the
 * id was present, because the sweep reached the outbox by joining on exactly that column. An
 * intent with a hash and no id was invisible to `onConfirmed` (keyed on the transaction id), to
 * this sweep, and to the abandoned sweep (which skips anything carrying a hash). The chain call
 * succeeded and the row was never written -- permanently.
 *
 * The hash is enough to find the outbox row, and the sweep already required the two hashes to
 * agree anyway.
 */
describeWithDatabase('confirmed intents whose outbox link is missing', () => {
  beforeAll(async () => {
    await isolatedDatabase.start();
  });

  afterAll(async () => {
    await isolatedDatabase.stop();
    restoreServerEnvironment();
  });

  it('finds a confirmed intent by hash when the outbox id was never written', async () => {
    const txHash = `0x${'a1'.repeat(32)}`;
    await outboxRow(txHash, 'confirmed');
    const intentId = await intentRow({ status: 'broadcast', txHash });

    const found = await listConfirmedUnsettledIntents({ db: database as never, limit: 25 });

    expect(found.map((intent) => intent.id)).toContain(intentId);
  });

  it('still finds one whose outbox id was written', async () => {
    const txHash = `0x${'b2'.repeat(32)}`;
    const serverWalletTransactionId = await outboxRow(txHash, 'confirmed');
    const intentId = await intentRow({ serverWalletTransactionId, status: 'broadcast', txHash });

    const found = await listConfirmedUnsettledIntents({ db: database as never, limit: 25 });

    expect(found.map((intent) => intent.id)).toContain(intentId);
  });

  it('still refuses one the reconciler replaced, whose confirmed hash is not the intent’s', async () => {
    // A replaced nonce confirms a no-op self-transfer, not this work. Completing it would
    // settle an intent whose call never landed -- the guard the hash comparison exists for,
    // which must survive the join being widened.
    await outboxRow(`0x${'c3'.repeat(32)}`, 'confirmed');
    const intentId = await intentRow({ status: 'broadcast', txHash: `0x${'d4'.repeat(32)}` });

    const found = await listConfirmedUnsettledIntents({ db: database as never, limit: 25 });

    expect(found.map((intent) => intent.id)).not.toContain(intentId);
  });

  it('refuses one whose outbox row has not confirmed', async () => {
    const txHash = `0x${'e5'.repeat(32)}`;
    await outboxRow(txHash, 'broadcast');
    const intentId = await intentRow({ status: 'broadcast', txHash });

    const found = await listConfirmedUnsettledIntents({ db: database as never, limit: 25 });

    expect(found.map((intent) => intent.id)).not.toContain(intentId);
  });
});

/**
 * An idempotency key names one operation on one chain.
 *
 * Verifies: ADR-0078
 *
 * The intent table's uniqueness rules used to be global while the outbox row beneath it was
 * chain-scoped. Nothing decided that asymmetry, and it was harmless only because one deployment
 * served one chain. Under a backend serving two, the same key from two callers on two chains
 * would collide on the unique index, and the second caller would be told its write was already
 * done -- returning another chain's operation as theirs, which is the exact promise ADR-0052
 * makes and this would have broken.
 *
 * These run against a real migrated database rather than a mock, because the property under test
 * IS the index: a mocked store would agree with whatever the code asked it, and the question here
 * is what Postgres enforces.
 */
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { relayedIntents } from '../../src/db/schema';
import { createIsolatedMigratedDatabase } from '../helpers/integration-database';
import { stubServerEnvironment } from '../helpers/server-environment';

const isolatedDatabase = createIsolatedMigratedDatabase('intent_chain_keys');
const describeWithDatabase = isolatedDatabase.isAvailable ? describe : describe.skip;
const { database } = isolatedDatabase;

const restoreServerEnvironment = stubServerEnvironment();

afterAll(restoreServerEnvironment);

const BASE_MAINNET = 8453;
const BASE_SEPOLIA = 84532;
const FUTURE_DEADLINE = String(Math.floor(Date.now() / 1000) + 3600);

async function insertIntent(chainId: number, idempotencyKey: string, paymentTxHash?: string) {
  await database.insert(relayedIntents).values({
    chainId,
    id: randomUUID(),
    idempotencyKey,
    operation: 'tasks.create',
    payload: {},
    paymentTxHash: paymentTxHash ?? null,
    relayReceiptNonce: `0x${'00'.repeat(32)}`,
    relayValidBefore: FUTURE_DEADLINE,
    status: 'recorded',
    updatedAt: new Date(),
  });
}

describeWithDatabase('relayed intent keys are scoped to their chain', () => {
  beforeAll(async () => {
    await isolatedDatabase.start();
  });

  afterAll(async () => {
    await isolatedDatabase.stop();
  });

  it('accepts the same idempotency key on two different chains', async () => {
    // The defect, stated as a passing test: before the composite index this second insert was
    // rejected as a duplicate, so a multi-chain backend could not have served both callers.
    const key = randomUUID();

    await insertIntent(BASE_SEPOLIA, key);
    await expect(insertIntent(BASE_MAINNET, key)).resolves.not.toThrow();

    const rows = await database
      .select({ chainId: relayedIntents.chainId })
      .from(relayedIntents)
      .where(eq(relayedIntents.idempotencyKey, key));
    expect(rows.map((r) => r.chainId).sort()).toEqual([BASE_MAINNET, BASE_SEPOLIA]);
  });

  it('still refuses the same idempotency key twice on one chain', async () => {
    // The half that must not regress. Scoping the key must not weaken it -- within a chain it is
    // still exactly one operation, which is what makes re-presenting one safe (ADR-0052).
    const key = randomUUID();

    await insertIntent(BASE_SEPOLIA, key);
    await expect(insertIntent(BASE_SEPOLIA, key)).rejects.toThrow();
  });

  it('accepts the same payment transaction hash on two different chains', async () => {
    // Two chains can produce the same transaction hash; the reference is only unique within one
    // (ADR-0057).
    const hash = `0x${'ab'.repeat(32)}`;

    await insertIntent(BASE_SEPOLIA, randomUUID(), hash);
    await expect(insertIntent(BASE_MAINNET, randomUUID(), hash)).resolves.not.toThrow();
  });

  it('still refuses the same payment transaction hash twice on one chain', async () => {
    const hash = `0x${'cd'.repeat(32)}`;

    await insertIntent(BASE_MAINNET, randomUUID(), hash);
    await expect(insertIntent(BASE_MAINNET, randomUUID(), hash)).rejects.toThrow();
  });

  it('leaves a lookup on one chain blind to the row on the other chain', async () => {
    // The index is only half of it: a query that forgot the scope would read the other chain's
    // operation and report it as this one's. Every lookup in `relayed-intents.ts` composes
    // `intentChainId()` for this reason.
    const key = randomUUID();
    await insertIntent(BASE_SEPOLIA, key);
    await insertIntent(BASE_MAINNET, key);

    const [sepoliaRow] = await database
      .select({ chainId: relayedIntents.chainId })
      .from(relayedIntents)
      .where(and(eq(relayedIntents.chainId, BASE_SEPOLIA), eq(relayedIntents.idempotencyKey, key)))
      .limit(1);

    expect(sepoliaRow?.chainId).toBe(BASE_SEPOLIA);
  });
});

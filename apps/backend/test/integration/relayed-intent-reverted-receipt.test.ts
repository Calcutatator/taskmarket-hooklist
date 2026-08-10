// Verifies: ADR-0073
// Verifies: ADR-0045
//
// The money-losing state this file is about: a paid relayed write whose transaction reverts on
// chain inside its own dispatch. The chain has answered, and the answer is the one ADR-0045
// names as the canonical evidence that the work did not happen and the payment is refundable --
// and it was thrown away. The dispatcher marked the outbox row `confirmed` regardless of the
// receipt, the relay then threw, the intent's hash was never persisted, and all three sweeps
// missed the resulting row for individually defensible reasons. Two payers were charged for
// nothing in the sandbox before this was written.
//
// As in relayed-intent-stranded.test.ts, the state is produced rather than constructed: the
// real dispatcher writes the real outbox row through the real Drizzle store against a real
// migrated Postgres. A hand-written row would keep passing if the dispatcher went back to
// writing `confirmed`, which is the whole defect.
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { relayedIntents, serverWalletNonces, serverWalletTransactions } from '../../src/db/schema';
import { createIsolatedMigratedDatabase } from '../helpers/integration-database';
import { stubServerEnvironment } from '../helpers/server-environment';

const isolatedDatabase = createIsolatedMigratedDatabase('intent_reverted');

const restoreServerEnvironment = stubServerEnvironment();

vi.mock('../../src/lib/rpc-gateway', () => ({
  getPublicClient: () => ({ readContract: vi.fn() }),
  getRpcOperation: () => 'request',
  getServerWallet: () => ({ account: { address: WALLET } }),
  runWithRpcApplicationAttempt: (_attempt: number, fn: () => unknown) => fn(),
  runWithRpcOperation: (_name: string, fn: () => unknown) => fn(),
  setRuntimeRpcTelemetrySink: () => {},
}));

// Mocked so "was the payer refunded, and exactly once?" is a direct assertion. The transfer
// itself belongs to orphaned-payments and has its own coverage.
const handlePostPaymentFailure = vi.fn(async (_input: { amount: bigint; payer: string }) => {
  throw new Error('refund attempted');
});
vi.mock('../../src/services/orphaned-payments', () => ({
  handlePostPaymentFailure,
  handleStandardFeePostPaymentFailure: vi.fn(),
  recordAndRefundOrphanedPayment: vi.fn(),
  recordUnattachedPayment: vi.fn(),
  refundDidNotComplete: () => false,
  retryFailedOrphanedRefunds: vi.fn(),
  settlePendingOrphanedRefunds: vi.fn(),
}));

const { createServerTransactionDispatcher } = await import(
  '../../src/lib/server-transaction-dispatcher'
);
const { createDrizzleServerTransactionStore } = await import(
  '../../src/lib/server-transaction-store'
);
const { intentOutboxLink, listConfirmedUnsettledIntents, listFailedTransactionIntents } =
  await import('../../src/services/relayed-intents');
const { settleFailedTransactionIntents } = await import(
  '../../src/services/relayed-intent-settlement'
);

const describeWithDatabase = isolatedDatabase.isAvailable ? describe : describe.skip;
const { database } = isolatedDatabase;

const CHAIN_ID = 31337;
const WALLET = '0x00000000000000000000000000000000000000bb';
const PAYER = '0x00000000000000000000000000000000000000cc';
const HASH = `0x${'cd'.repeat(32)}` as const;

function store() {
  return createDrizzleServerTransactionStore({
    chainId: CHAIN_ID,
    database: database as never,
    newId: () => randomUUID(),
    walletAddress: WALLET,
  });
}

/**
 * A paid `recorded` intent, exactly as a settled x402 write leaves behind.
 */
async function recordPaidIntent(): Promise<string> {
  const intentId = randomUUID();
  await database.insert(relayedIntents).values({
    id: intentId,
    idempotencyKey: randomUUID(),
    operation: 'bids.auctionAccept',
    payload: {},
    paymentAmount: '1000000',
    paymentRequired: true,
    paymentTxHash: `0x${'dd'.repeat(32)}`,
    payer: PAYER,
    relayReceiptNonce: `0x${'11'.repeat(32)}`,
    relayValidBefore: String(Math.floor(Date.now() / 1000) + 3600),
    status: 'recorded',
  });
  return intentId;
}

/**
 * Run one dispatch to completion with the receipt the chain is pretending to return.
 *
 * The send succeeds and returns a hash; only the receipt differs between the two cases. That is
 * the real shape of this failure -- everything works right up to the verdict.
 */
async function dispatchWithReceipt(intentId: string, status: 'success' | 'reverted') {
  const dispatch = createServerTransactionDispatcher({
    getPendingNonce: vi.fn().mockResolvedValue(7),
    store: store(),
  });
  const link = intentOutboxLink(database as never, intentId);

  return dispatch({
    confirm: vi.fn().mockResolvedValue({ status }),
    onNonceAllocated: (transactionId: string) =>
      link.onAllocated(transactionId, `0x${'ab'.repeat(32)}`),
    onNonceReleased: link.onReleased,
    send: vi.fn().mockResolvedValue(HASH),
    simulate: vi.fn().mockResolvedValue(undefined),
    succeeded: (receipt) => (receipt as { status?: string })?.status === 'success',
  });
}

async function readIntent(id: string) {
  const [row] = await database.select().from(relayedIntents).where(eq(relayedIntents.id, id));
  return row;
}

async function readOutbox(id: string) {
  const [row] = await database
    .select()
    .from(serverWalletTransactions)
    .where(eq(serverWalletTransactions.id, id));
  return row;
}

describeWithDatabase('a relayed write whose receipt reverted', () => {
  beforeAll(async () => {
    await isolatedDatabase.start();
  });

  afterAll(async () => {
    await isolatedDatabase.stop();
    restoreServerEnvironment();
  });

  afterEach(async () => {
    handlePostPaymentFailure.mockClear();
    await database.delete(relayedIntents);
    await database.delete(serverWalletTransactions);
    await database.delete(serverWalletNonces);
  });

  it('records the reverted receipt on the outbox row as failed, never confirmed', async () => {
    const intentId = await recordPaidIntent();
    await dispatchWithReceipt(intentId, 'reverted');

    const intent = await readIntent(intentId);
    const outbox = await readOutbox(intent.serverWalletTransactionId!);
    // The whole defect in one assertion: this used to be `confirmed`, with a hash, for a
    // transaction the chain had just rejected.
    expect(outbox.status).toBe('failed');
    expect(outbox.txHash).toBe(HASH);
  });

  it('settles the intent failed and refunds the payer exactly once', async () => {
    const intentId = await recordPaidIntent();
    await dispatchWithReceipt(intentId, 'reverted');

    // The intent as the request leaves it: still `recorded`, and with no hash of its own,
    // because the relay throws on the reverted receipt before the hash is persisted. This is
    // the exact row shape that was invisible to every sweep.
    const before = await readIntent(intentId);
    expect(before.status).toBe('recorded');
    expect(before.txHash).toBeNull();
    expect(before.serverWalletTransactionId).not.toBeNull();

    expect(
      (await listFailedTransactionIntents({ db: database as never, limit: 50 })).map((r) => r.id)
    ).toContain(intentId);

    await settleFailedTransactionIntents(10, { database: database as never });

    const after = await readIntent(intentId);
    expect(after.status).toBe('failed');
    expect(handlePostPaymentFailure).toHaveBeenCalledTimes(1);
    expect(handlePostPaymentFailure.mock.calls[0]?.[0]).toMatchObject({
      amount: 1_000_000n,
      payer: PAYER,
    });

    // Twice through the sweep is once through the refund. The intent is terminal now, so it no
    // longer matches, and `onFailed` refuses an intent already `failed` even if it did.
    await settleFailedTransactionIntents(10, { database: database as never });
    expect(handlePostPaymentFailure).toHaveBeenCalledTimes(1);
    expect(
      (await listFailedTransactionIntents({ db: database as never, limit: 50 })).map((r) => r.id)
    ).not.toContain(intentId);
  });

  it('never lets the confirmed sweep complete a reverted write', async () => {
    const intentId = await recordPaidIntent();
    await dispatchWithReceipt(intentId, 'reverted');
    // Give the intent the hash it would have carried had anything persisted it, which is the
    // one thing that could make the confirmed sweep's hash join match. It still must not: that
    // sweep requires a `confirmed` outbox row, and a reverted receipt no longer produces one.
    // Completing a reverted write is worse than failing to refund it.
    await database
      .update(relayedIntents)
      .set({ txHash: HASH })
      .where(eq(relayedIntents.id, intentId));

    expect(
      (await listConfirmedUnsettledIntents({ db: database as never, limit: 50 })).map((r) => r.id)
    ).not.toContain(intentId);
  });

  it('leaves a successful receipt confirmed, unswept and unrefunded', async () => {
    const intentId = await recordPaidIntent();
    await dispatchWithReceipt(intentId, 'success');

    const intent = await readIntent(intentId);
    const outbox = await readOutbox(intent.serverWalletTransactionId!);
    expect(outbox.status).toBe('confirmed');
    expect(outbox.txHash).toBe(HASH);

    expect(await listFailedTransactionIntents({ db: database as never, limit: 50 })).toEqual([]);

    await settleFailedTransactionIntents(10, { database: database as never });
    expect((await readIntent(intentId)).status).toBe('recorded');
    expect(handlePostPaymentFailure).not.toHaveBeenCalled();
  });

  it('does not match a failed outbox row that never named a transaction', async () => {
    const intentId = await recordPaidIntent();
    await dispatchWithReceipt(intentId, 'reverted');
    const intent = await readIntent(intentId);
    // The ADR-0069 state: terminal, but with no hash. Its nonce may have been spent by this
    // intent's own transaction, so it is not refundable on this evidence -- `listStrandedIntents`
    // owns it, and asks the chain about the intent's own receipt before concluding anything.
    await database
      .update(serverWalletTransactions)
      .set({ txHash: null })
      .where(eq(serverWalletTransactions.id, intent.serverWalletTransactionId!));

    expect(await listFailedTransactionIntents({ db: database as never, limit: 50 })).toEqual([]);
  });
});

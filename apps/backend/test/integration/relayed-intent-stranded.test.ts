// Verifies: ADR-0071
// Verifies: ADR-0069
//
// The state under test is the one ADR-0069 deliberately left open: a send whose connection
// dropped mid-call, so no transaction hash was ever returned, whose nonce the reconciler later
// found occupied by something it could not name. The intent could be neither refunded (the
// transaction occupying that nonce may have been its own) nor completed (nothing could say it
// was), so it sat non-terminal forever.
//
// ## Why the state is produced rather than written
//
// Every row here is put into that state by running the real dispatcher's unknown branch and the
// real reconciler against a real migrated Postgres through the real Drizzle store. Constructing
// the row by hand would be the more convenient test and a much weaker one: it would assert
// recovery from a state we invented, and would keep passing if the dispatcher stopped producing
// it -- which is precisely the defect class this whole area is about. `strandIntent` below is
// the only setup path, and it sends nothing it does not go through the production code to send.
//
// The chain is mocked at `rpc-gateway`, not above it, so the module actually under test --
// `readEffectEvidence` and its three-valued verdict -- runs for real.
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { relayedIntents, serverWalletTransactions } from '../../src/db/schema';
import { createIsolatedMigratedDatabase } from '../helpers/integration-database';
import { stubServerEnvironment } from '../helpers/server-environment';

const isolatedDatabase = createIsolatedMigratedDatabase('intent_stranded');

const restoreServerEnvironment = stubServerEnvironment();

const readContract = vi.fn();
vi.mock('../../src/lib/rpc-gateway', () => ({
  getPublicClient: () => ({ readContract }),
  getRpcOperation: () => 'request',
  getServerWallet: () => ({ account: { address: WALLET } }),
  runWithRpcApplicationAttempt: (_attempt: number, fn: () => unknown) => fn(),
  runWithRpcOperation: (_name: string, fn: () => unknown) => fn(),
  setRuntimeRpcTelemetrySink: () => {},
}));

// Mocked so "was this refunded?" is a direct assertion rather than an inference from a chain
// call that would fail anyway. The refund decision is what this suite is about; the transfer
// itself is `orphaned-payments`' own territory and has its own coverage.
const handlePostPaymentFailure = vi.fn(async () => {
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

const { createServerTransactionDispatcher } =
  await import('../../src/lib/server-transaction-dispatcher');
const { createServerTransactionReconciler } =
  await import('../../src/lib/server-transaction-reconciler');
const { createDrizzleServerTransactionStore } =
  await import('../../src/lib/server-transaction-store');
const { intentOutboxLink, listStrandedIntents } =
  await import('../../src/services/relayed-intents');
const { settleStrandedIntents } = await import('../../src/services/relayed-intent-stranded');

const describeWithDatabase = isolatedDatabase.isAvailable ? describe : describe.skip;
const { database } = isolatedDatabase;

const CHAIN_ID = 31337;
const WALLET = '0x00000000000000000000000000000000000000bb';
const PAYER = '0x00000000000000000000000000000000000000cc';
const STUCK_AFTER_MS = 90_000;
const HOUR_AGO = () => new Date(Date.now() - 60 * 60 * 1000);

function store() {
  return createDrizzleServerTransactionStore({
    chainId: CHAIN_ID,
    database: database as never,
    newId: () => randomUUID(),
    walletAddress: WALLET,
  });
}

/**
 * Drive one intent into the stranded state through the code that really produces it.
 *
 * Three steps, none of them shortcuts:
 *
 *   1. A `recorded` intent, as any paid write leaves behind.
 *   2. A dispatch whose `send` never answers, with the chain's pending count already past the
 *      nonce. That is the dispatcher's unknown branch: it cannot prove the nonce spent and
 *      cannot prove it free, so the outbox row stays `reserved` and the link -- and now the
 *      receipt hash -- stay written.
 *   3. A reconciler pass whose replacement is rejected `nonce too low`. With no hash on the row
 *      there is no receipt to read, so it makes the row terminal and leaves the intent alone.
 */
async function strandIntent(options: {
  operation?: string;
  paid?: boolean;
  payload?: Record<string, unknown>;
  receiptHash?: string | null;
  validBefore: number;
}): Promise<string> {
  const intentId = randomUUID();
  await database.insert(relayedIntents).values({
    id: intentId,
    idempotencyKey: randomUUID(),
    operation: options.operation ?? 'tasks.create',
    payload: options.payload ?? {},
    ...(options.paid === false
      ? {}
      : {
          paymentAmount: '1000000',
          paymentRequired: true,
          paymentTxHash: `0x${randomUUID().replace(/-/g, '')}${'0'.repeat(32)}`.slice(0, 66),
          payer: PAYER,
        }),
    relayReceiptNonce: `0x${'11'.repeat(32)}`,
    relayValidBefore: String(options.validBefore),
    status: 'recorded',
  });

  const nonce = Math.floor(Math.random() * 1_000_000);
  const dispatch = createServerTransactionDispatcher({
    // The chain's pending count is already past this nonce, so nothing here can prove it free.
    getPendingNonce: vi.fn().mockResolvedValue(nonce + 1),
    store: store(),
  });
  const link = intentOutboxLink(database as never, intentId);

  await expect(
    dispatch({
      confirm: vi.fn(),
      onNonceAllocated: (transactionId: string) =>
        link.onAllocated(
          transactionId,
          options.receiptHash === null
            ? undefined
            : ((options.receiptHash ?? `0x${'ab'.repeat(32)}`) as `0x${string}`)
        ),
      onNonceReleased: link.onReleased,
      // The send reached the node and the socket died before the hash came back. No hash exists
      // anywhere, which is the entire premise.
      send: vi.fn().mockRejectedValue(new Error('socket hang up')),
      simulate: vi.fn().mockResolvedValue(undefined),
    })
  ).rejects.toThrow('socket hang up');

  // Age the outbox row past the reconciler's stuck threshold. Time, not state.
  await database
    .update(serverWalletTransactions)
    .set({ updatedAt: HOUR_AGO() })
    .where(
      eq(serverWalletTransactions.id, (await readIntent(intentId)).serverWalletTransactionId!)
    );

  const reconcile = createServerTransactionReconciler({
    getReceiptStatus: vi.fn().mockResolvedValue(null),
    // Something already occupies the nonce, and it is not anything we can name.
    sendReplacement: vi.fn().mockRejectedValue(new Error('nonce too low')),
    stuckAfterMs: STUCK_AFTER_MS,
    store: store(),
  });
  await reconcile();

  // Age the intent past the sweep's cutoff, again purely time.
  await database
    .update(relayedIntents)
    .set({ updatedAt: HOUR_AGO() })
    .where(eq(relayedIntents.id, intentId));

  return intentId;
}

async function readIntent(id: string) {
  const [row] = await database.select().from(relayedIntents).where(eq(relayedIntents.id, id));
  return row;
}

const FUTURE = () => Math.floor(Date.now() / 1000) + 3600;
const PAST = () => Math.floor(Date.now() / 1000) - 3600;

describeWithDatabase('an intent whose send never returned a hash', () => {
  beforeAll(async () => {
    await isolatedDatabase.start();
  });

  afterAll(async () => {
    await isolatedDatabase.stop();
    restoreServerEnvironment();
  });

  afterEach(() => {
    readContract.mockReset();
    handlePostPaymentFailure.mockClear();
  });

  it('reaches the stranded state through the dispatcher and the reconciler', async () => {
    const intentId = await strandIntent({ validBefore: FUTURE() });

    const intent = await readIntent(intentId);
    // The premise, asserted rather than assumed: linked, hashless, non-terminal, and carrying
    // the receipt hash written before the send.
    expect(intent.status).toBe('recorded');
    expect(intent.txHash).toBeNull();
    expect(intent.serverWalletTransactionId).not.toBeNull();
    expect(intent.relayReceiptHash).toBe(`0x${'ab'.repeat(32)}`);

    const [outbox] = await database
      .select()
      .from(serverWalletTransactions)
      .where(eq(serverWalletTransactions.id, intent.serverWalletTransactionId!));
    // Terminal so no gap is created, and hashless so no receipt can ever be read for it.
    expect(outbox.status).toBe('failed');
    expect(outbox.txHash).toBeNull();

    const stranded = await listStrandedIntents({
      cutoff: new Date(),
      db: database as never,
      limit: 50,
    });
    expect(stranded.map((row) => row.id)).toContain(intentId);
  });

  it('completes without refunding when the forwarder says its receipt was consumed', async () => {
    const intentId = await strandIntent({ validBefore: FUTURE() });
    readContract.mockResolvedValue(true);

    await settleStrandedIntents(10, { database: database as never });

    // The work is on chain. Refunding here would hand the payer their money back for a task
    // they hold, paid for out of the server wallet -- the loss this whole mechanism exists to
    // prevent.
    expect((await readIntent(intentId)).status).toBe('completed');
    expect(handlePostPaymentFailure).not.toHaveBeenCalled();
  });

  it('refunds when the receipt is unconsumed past the deadline the chain enforces', async () => {
    const intentId = await strandIntent({ validBefore: PAST() });
    readContract.mockResolvedValue(false);

    await settleStrandedIntents(10, { database: database as never });

    // Past `validBefore` the forwarder reverts `ReceiptExpired`, so no transaction carrying this
    // intent's material can ever be included. Absence is now permanent, which is the same
    // standard ADR-0045 sets for a reverted receipt.
    expect((await readIntent(intentId)).status).toBe('failed');
    expect(handlePostPaymentFailure).toHaveBeenCalledTimes(1);
  });

  it('leaves the intent alone when the receipt is unconsumed but the deadline has not passed', async () => {
    const intentId = await strandIntent({ validBefore: FUTURE() });
    readContract.mockResolvedValue(false);

    await settleStrandedIntents(10, { database: database as never });

    // The transaction whose send never answered may still be sitting in a mempool and can still
    // be included right up to the deadline. Absence before it is not evidence of anything.
    expect((await readIntent(intentId)).status).toBe('recorded');
    expect(handlePostPaymentFailure).not.toHaveBeenCalled();
  });

  it('leaves the intent alone when the receipt read itself fails, deadline or not', async () => {
    const intentId = await strandIntent({ validBefore: PAST() });
    readContract.mockRejectedValue(new Error('gateway 502'));

    await settleStrandedIntents(10, { database: database as never });

    // An unreachable node is not the chain saying "this did not happen". Reading a failed read
    // as a `false` past the deadline is exactly how a payer gets refunded for work that landed,
    // and it is the one branch that must never be collapsed.
    expect((await readIntent(intentId)).status).toBe('recorded');
    expect(handlePostPaymentFailure).not.toHaveBeenCalled();
  });

  it('leaves an intent with no receipt hash alone rather than reading it as unconsumed', async () => {
    // Rows written before the column existed, and the two operations that do not relay. A null
    // hash means there is no question to ask -- not that the answer is no (ADR-0071).
    const intentId = await strandIntent({ receiptHash: null, validBefore: PAST() });
    readContract.mockResolvedValue(false);

    await settleStrandedIntents(10, { database: database as never });

    expect((await readIntent(intentId)).status).toBe('recorded');
    expect(handlePostPaymentFailure).not.toHaveBeenCalled();
    // The chain was never asked, because there was nothing to ask about.
    expect(readContract).not.toHaveBeenCalled();
  });

  it('resolves wallet.withdraw from the authorization the user signed, not a receipt hash', async () => {
    const intentId = await strandIntent({
      operation: 'wallet.withdraw',
      payload: {
        amountBaseUnits: '1000000',
        from: PAYER,
        nonce: `0x${'ee'.repeat(32)}`,
        signature: `0x${'00'.repeat(65)}`,
        to: WALLET,
        validAfter: '0',
        // The governing deadline for this operation is the user's own, inside the payload --
        // not the relay envelope's, which USDC knows nothing about.
        validBefore: String(PAST()),
      },
      receiptHash: null,
      validBefore: FUTURE(),
    });
    readContract.mockResolvedValue(true);

    await settleStrandedIntents(10, { database: database as never });

    // EIP-3009 records every consumed authorization under `(authorizer, nonce)`, which names
    // this withdrawal exactly -- the same lookup the reservation sweep relies on (ADR-0067).
    expect((await readIntent(intentId)).status).toBe('completed');
    expect(handlePostPaymentFailure).not.toHaveBeenCalled();
  });
});

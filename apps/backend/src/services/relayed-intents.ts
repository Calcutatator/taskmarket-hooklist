// Implements: ADR-0045
import { randomUUID } from 'crypto';
import { and, eq, inArray, lt, sql } from 'drizzle-orm';

import type { db as DbType } from '../db/client';
import { relayedIntents, serverWalletTransactions, type RelayedIntent } from '../db/schema';

type Db = typeof DbType;

/**
 * Operation kinds that can be recorded as a durable intent.
 *
 * A closed union rather than a free string: the completion registry is keyed on it, and a
 * kind with no handler is a startup error rather than a runtime surprise discovered when a
 * receipt lands an hour late and there is nothing to run.
 */
export type RelayedIntentOperation =
  | 'tasks.create'
  | 'tasks.assignEvaluator'
  | 'tasks.update'
  | 'acceptance.accept'
  | 'acceptance.acceptMany'
  | 'acceptance.rate'
  | 'bids.auctionAccept'
  | 'pitches.submit'
  | 'proofs.submit'
  | 'evaluations.evaluate'
  | 'identity.register';

export type RelayedIntentStatus = 'recorded' | 'broadcast' | 'completed' | 'failed';

export type RecordIntentInput = {
  db: Db;
  operation: RelayedIntentOperation;
  payer?: string;
  paymentTxHash?: string;
  paymentAmount?: bigint;
  payload: unknown;
};

/**
 * Persist an intent before anything irreversible happens.
 *
 * Ordering is the point: the row exists before the payment is consumed and before the chain
 * call is made, so there is no window where money has moved or a transaction is live with no
 * durable record of what it was for.
 *
 * The payment hash is uniquely indexed, so a retried request reusing the same settled x402
 * payment reuses its existing intent instead of creating a second one and a second chain
 * call. That makes the record itself the idempotency key for a paid operation.
 */
export async function recordRelayedIntent(input: RecordIntentInput): Promise<RelayedIntent> {
  const id = randomUUID();

  if (input.paymentTxHash) {
    const existing = await input.db
      .select()
      .from(relayedIntents)
      .where(eq(relayedIntents.paymentTxHash, input.paymentTxHash))
      .limit(1);
    if (existing[0]) return existing[0];
  }

  const [row] = await input.db
    .insert(relayedIntents)
    .values({
      id,
      operation: input.operation,
      payer: input.payer ?? null,
      paymentAmount: input.paymentAmount ? input.paymentAmount.toString() : null,
      paymentTxHash: input.paymentTxHash ?? null,
      payload: input.payload,
      status: 'recorded',
    })
    .onConflictDoNothing()
    .returning();

  if (row) return row;

  // Lost the insert race against a concurrent retry of the same payment; take theirs.
  const [existing] = await input.db
    .select()
    .from(relayedIntents)
    .where(eq(relayedIntents.paymentTxHash, input.paymentTxHash!))
    .limit(1);
  if (!existing)
    throw new Error(`Could not record or find intent for operation ${input.operation}`);
  return existing;
}

/**
 * Claim an intent for broadcast.
 *
 * There is no distinct in-flight status to move it to -- `recorded` means "not on chain", and
 * that is still true while a broadcast is being attempted -- so the claim is expressed as a
 * conditional bump of `updatedAt`. The worker's own query skips rows touched within its grace
 * window, which is what keeps an eager dispatch and a worker pass from both spending a nonce
 * on the same intent.
 */
export async function claimIntentForBroadcast(input: {
  db: Db;
  intentId: string;
}): Promise<RelayedIntent | null> {
  const [claimed] = await input.db
    .update(relayedIntents)
    .set({ updatedAt: new Date() })
    .where(and(eq(relayedIntents.id, input.intentId), eq(relayedIntents.status, 'recorded')))
    .returning();
  return claimed ?? null;
}

/**
 * Hand a claimed intent back for a later attempt after a transient broadcast failure.
 *
 * Rewriting `status` is redundant today (the claim never changed it) and deliberate anyway:
 * this is the one call site that means "nothing reached the chain, try again", and saying so
 * explicitly keeps it correct if the claim ever gains a status of its own.
 */
export async function releaseIntentForRetry(input: { db: Db; intentId: string }): Promise<void> {
  await input.db
    .update(relayedIntents)
    .set({ status: 'recorded', updatedAt: new Date() })
    .where(eq(relayedIntents.id, input.intentId));
}

/** Link the intent to its broadcast transaction. Only confirmed evidence moves it on from here. */
export async function markIntentBroadcast(input: {
  db: Db;
  intentId: string;
  serverWalletTransactionId?: string;
  txHash: string;
}): Promise<void> {
  await input.db
    .update(relayedIntents)
    .set({
      serverWalletTransactionId: input.serverWalletTransactionId ?? null,
      status: 'broadcast',
      txHash: input.txHash,
      updatedAt: new Date(),
    })
    .where(eq(relayedIntents.id, input.intentId));
}

/**
 * Mark an intent broadcast, resolving the outbox row from the transaction hash.
 *
 * The dispatcher hands callers a hash, not the id of the `server_wallet_transactions` row it
 * allocated -- but the reconciler settles by that id, so an intent left without it can never
 * be settled by anything except the request that started it. Looking the row up by hash is
 * what closes that gap, and it is why this is the form request paths should call.
 */
export async function linkIntentToBroadcast(input: {
  db: Db;
  intentId: string;
  txHash: string;
}): Promise<void> {
  const [row] = await input.db
    .select({ id: serverWalletTransactions.id })
    .from(serverWalletTransactions)
    .where(eq(serverWalletTransactions.txHash, input.txHash))
    .limit(1);

  await markIntentBroadcast({
    db: input.db,
    intentId: input.intentId,
    serverWalletTransactionId: row?.id,
    txHash: input.txHash,
  });
}

/**
 * Claim an intent for completion.
 *
 * A single conditional UPDATE, for the same reason the orphaned-payment refund path uses one:
 * the original request and a reconciler pass can both observe the same successful receipt, and
 * without an atomic claim both would run the completion handler. Only one caller's UPDATE
 * matches the row.
 *
 * Returns null when someone else already claimed or finished it.
 */
export async function claimIntentForCompletion(input: {
  db: Db;
  intentId: string;
}): Promise<RelayedIntent | null> {
  const [claimed] = await input.db
    .update(relayedIntents)
    .set({
      completionAttempts: sql`${relayedIntents.completionAttempts} + 1`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(relayedIntents.id, input.intentId),
        inArray(relayedIntents.status, ['recorded', 'broadcast'])
      )
    )
    .returning();

  return claimed ?? null;
}

export async function markIntentCompleted(input: { db: Db; intentId: string }): Promise<void> {
  const now = new Date();
  await input.db
    .update(relayedIntents)
    .set({ completedAt: now, lastError: null, status: 'completed', updatedAt: now })
    .where(eq(relayedIntents.id, input.intentId));
}

/** Terminal failure. Only the chain may put an intent here -- never a timeout (ADR-0045). */
export async function markIntentFailed(input: {
  db: Db;
  intentId: string;
  reason: string;
}): Promise<void> {
  await input.db
    .update(relayedIntents)
    .set({ lastError: input.reason.slice(0, 500), status: 'failed', updatedAt: new Date() })
    .where(eq(relayedIntents.id, input.intentId));
}

export async function recordIntentCompletionError(input: {
  db: Db;
  intentId: string;
  error: unknown;
}): Promise<void> {
  const message = input.error instanceof Error ? input.error.message : String(input.error);
  await input.db
    .update(relayedIntents)
    .set({ lastError: message.slice(0, 500), updatedAt: new Date() })
    .where(eq(relayedIntents.id, input.intentId));
}

export async function getRelayedIntent(input: {
  db: Db;
  intentId: string;
}): Promise<RelayedIntent | null> {
  const [row] = await input.db
    .select()
    .from(relayedIntents)
    .where(eq(relayedIntents.id, input.intentId))
    .limit(1);
  return row ?? null;
}

export async function findIntentByTransactionId(input: {
  db: Db;
  serverWalletTransactionId: string;
}): Promise<RelayedIntent | null> {
  const [row] = await input.db
    .select()
    .from(relayedIntents)
    .where(eq(relayedIntents.serverWalletTransactionId, input.serverWalletTransactionId))
    .limit(1);
  return row ?? null;
}

/**
 * Intents whose transaction is confirmed on chain but which have not finished.
 *
 * The reconciler's main pass only ever looks at outbox rows still in `broadcast`, so any row
 * that reached `confirmed` without its intent being completed is invisible to it -- which is
 * exactly what happens when a dispatch awaits its own receipt and the confirmation is recorded
 * before anyone runs the completion. That is a real defect (see dispatchRelayedIntent), and it
 * was undetectable because nothing ever asked this question. Asking it turns "stranded
 * forever" into "completed on the next pass" for any future path that forgets.
 */
export async function listConfirmedUnsettledIntents(input: {
  db: Db;
  limit: number;
}): Promise<RelayedIntent[]> {
  const rows = await input.db
    .select({ intent: relayedIntents })
    .from(relayedIntents)
    .innerJoin(
      serverWalletTransactions,
      eq(serverWalletTransactions.id, relayedIntents.serverWalletTransactionId)
    )
    .where(
      and(
        eq(serverWalletTransactions.status, 'confirmed'),
        inArray(relayedIntents.status, ['recorded', 'broadcast'])
      )
    )
    .limit(input.limit);

  return rows.map((row) => row.intent);
}

/**
 * Intents stuck in 'recorded' past the cutoff: the process died between persisting the intent
 * and broadcasting, so nothing is live on chain and any payment is genuinely refundable.
 */
export async function listAbandonedIntents(input: {
  db: Db;
  cutoff: Date;
  limit: number;
}): Promise<RelayedIntent[]> {
  return input.db
    .select()
    .from(relayedIntents)
    .where(and(eq(relayedIntents.status, 'recorded'), lt(relayedIntents.updatedAt, input.cutoff)))
    .limit(input.limit);
}

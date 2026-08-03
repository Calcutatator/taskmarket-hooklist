// Implements: ADR-0045
import { randomUUID } from 'crypto';
import { and, eq, inArray, lt, sql } from 'drizzle-orm';

import type { db as DbType } from '../db/client';
import { relayedIntents, type RelayedIntent } from '../db/schema';

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

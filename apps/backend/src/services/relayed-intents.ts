// Implements: ADR-0045, ADR-0050
import { randomUUID } from 'crypto';
import { and, asc, eq, gte, inArray, isNull, lt, ne, sql } from 'drizzle-orm';

import type { db as DbType } from '../db/client';
import { relayedIntents, serverWalletTransactions, type RelayedIntent } from '../db/schema';
import { logger } from '../lib/logger';
import { newRelayEnvelope, type RelayEnvelope } from './relay-envelope';

type Db = typeof DbType;

/**
 * The envelope this intent's transaction must carry, on every attempt.
 *
 * Falls back to a fresh one only for a row written before the columns existed; a stored
 * envelope is always preferred, because reusing it is the entire point.
 */
export function relayEnvelopeForIntent(intent: RelayedIntent): RelayEnvelope {
  if (!intent.relayValidBefore || !intent.relayReceiptNonce) return newRelayEnvelope();
  return {
    receiptNonce: intent.relayReceiptNonce as `0x${string}`,
    validBefore: BigInt(intent.relayValidBefore),
  };
}

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
  | 'tasks.cancel'
  | 'tasks.refundExpired'
  | 'tasks.rejectSubmission'
  | 'acceptance.accept'
  | 'acceptance.acceptSubmissions'
  | 'acceptance.rate'
  | 'bids.submit'
  | 'bids.auctionAccept'
  | 'pitches.submit'
  | 'pitches.select'
  | 'proofs.submit'
  | 'proofs.anchorDeliverable'
  | 'evaluations.evaluate'
  | 'evaluations.appeal'
  | 'evaluations.finalizeVerdict'
  | 'evaluations.resolveDispute'
  | 'evaluations.evaluatorTimeout'
  | 'claims.claim'
  | 'claims.forfeit'
  | 'submissions.submit'
  | 'wallet.withdraw'
  | 'wallet.withdrawDreams'
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

  // Fixed here, once, and replayed verbatim by every broadcast attempt. This is the intent's
  // deadline: a rebroadcast that regenerated it would buy itself another full window on every
  // pass, so the deadline would never arrive and retrying would be unbounded in all but name.
  const envelope = newRelayEnvelope();

  const [row] = await input.db
    .insert(relayedIntents)
    .values({
      id,
      operation: input.operation,
      payer: input.payer ?? null,
      paymentAmount: input.paymentAmount ? input.paymentAmount.toString() : null,
      paymentTxHash: input.paymentTxHash ?? null,
      payload: input.payload,
      relayReceiptNonce: envelope.receiptNonce,
      relayValidBefore: envelope.validBefore.toString(),
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
 * Belt-and-braces cap on rebroadcast attempts. Not the real bound.
 *
 * The real bound is the deadline the caller authorised. A relayed call carries a `validBefore`
 * that `TaskMarketForwarder.relay` enforces, and anything a user signed carries its own expiry
 * inside the payload; once chain time passes either, a replay reverts and the intent is failed
 * by contract enforcement rather than by a number somebody had to tune. That is the mechanism
 * to reason about, and the reason a payload is replayed verbatim and never amended: you do not
 * mutate what a user authorised, so an expired authorisation dies and is re-signed.
 *
 * This counter exists only so an intent whose broadcast fails for reasons unrelated to any
 * deadline -- a persistently unreachable RPC, say -- cannot hot-loop the worker forever, and
 * so a paid intent eventually reaches the refund path instead of being retried indefinitely.
 *
 * Set deliberately high enough that it does not bind first. The worker's orphan grace is 30s,
 * so an intent gets at most ~10 attempts inside a 300s receipt window; a cap of 20 sits well
 * clear of that, which is the point -- a cap low enough to end retrying before the deadline
 * would quietly make this constant the real bound again, and tuning it would then be tuning
 * something the payer never agreed to.
 */
export const MAX_BROADCAST_ATTEMPTS = 20;

/**
 * Claim an intent for broadcast.
 *
 * There is no distinct in-flight status to move it to -- `recorded` means "not on chain", and
 * that is still true while a broadcast is being attempted -- so the claim is expressed as a
 * conditional bump of `updatedAt`. The worker's own query skips rows touched within its grace
 * window, which is what keeps an eager dispatch and a worker pass from both spending a nonce
 * on the same intent.
 *
 * The attempt is counted here rather than on success or failure so that a process dying
 * mid-broadcast still consumes one: an attempt that leaves no trace is an attempt that can be
 * repeated forever.
 *
 * `expectedAttempts` makes the claim a compare-and-swap against the counter the caller read.
 * Status alone does not distinguish two claimants: `recorded` stays `recorded` across a
 * broadcast attempt by design, so two passes that listed the same intent in the same window
 * both match on status and both send. The counter is the only field that moves, so requiring it
 * to be untouched since the read is what makes the claim exclusive -- and the second claimant
 * gets null and stops, rather than spending a second nonce on the same work.
 *
 * The attempt cap is deliberately not enforced here. `listUnbroadcastIntents` applies it, which
 * is the right place: it governs *re*broadcasting, and an eager dispatch is the first attempt by
 * design, made by the request that just recorded the intent. Enforcing the cap at the claim
 * would only matter if a caller reached this with an exhausted budget, which is exactly the
 * state `exhaustIntentBroadcastAttempts` uses to mean "hand this to settlement" -- and settlement
 * finds it through that query, not through here.
 */
export async function claimIntentForBroadcast(input: {
  db: Db;
  expectedAttempts: number;
  intentId: string;
}): Promise<RelayedIntent | null> {
  const [claimed] = await input.db
    .update(relayedIntents)
    .set({
      broadcastAttempts: sql`${relayedIntents.broadcastAttempts} + 1`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(relayedIntents.id, input.intentId),
        eq(relayedIntents.status, 'recorded'),
        eq(relayedIntents.broadcastAttempts, input.expectedAttempts)
      )
    )
    .returning();
  return claimed ?? null;
}

/**
 * Intents that provably never reached the chain and are still worth another attempt.
 *
 * "Provably" is the load-bearing word, and it is why this is safe to run for paid intents too.
 * The outbox row is written when a nonce is allocated, which happens before anything is
 * broadcast, so an intent with no `serverWalletTransactionId` and no `txHash` cannot have a
 * transaction live under it. That is positive evidence of nothing having happened, not an
 * inference from an absent receipt -- the distinction ADR-0045 turns on.
 */
export async function listUnbroadcastIntents(input: {
  db: Db;
  cutoff: Date;
  limit: number;
}): Promise<RelayedIntent[]> {
  return input.db
    .select()
    .from(relayedIntents)
    .where(
      and(
        eq(relayedIntents.status, 'recorded'),
        isNull(relayedIntents.serverWalletTransactionId),
        isNull(relayedIntents.txHash),
        lt(relayedIntents.broadcastAttempts, MAX_BROADCAST_ATTEMPTS),
        lt(relayedIntents.updatedAt, input.cutoff)
      )
    )
    .orderBy(asc(relayedIntents.createdAt))
    .limit(input.limit);
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
 *
 * The lookup is allowed to fail without taking the hash write down with it. The two writes are
 * not equally important: the outbox id decides *who* settles the intent, while the hash decides
 * whether the intent still looks like one that never reached the chain. `listUnbroadcastIntents`
 * rebroadcasts on exactly that question, so losing the hash because a `select` failed would
 * spend a second nonce on a transaction that is already live. A missing outbox id is recovered
 * by `listConfirmedUnsettledIntents`; a missing hash is recovered by nothing.
 */
export async function linkIntentToBroadcast(input: {
  db: Db;
  intentId: string;
  txHash: string;
}): Promise<void> {
  let serverWalletTransactionId: string | undefined;
  try {
    const [row] = await input.db
      .select({ id: serverWalletTransactions.id })
      .from(serverWalletTransactions)
      .where(eq(serverWalletTransactions.txHash, input.txHash))
      .limit(1);
    serverWalletTransactionId = row?.id;
  } catch (error) {
    logger.error('Outbox lookup for a broadcast relayed intent failed; recording the hash anyway', {
      error: error instanceof Error ? error.message : String(error),
      intentId: input.intentId,
      txHash: input.txHash,
    });
  }

  await markIntentBroadcast({
    db: input.db,
    intentId: input.intentId,
    serverWalletTransactionId,
    txHash: input.txHash,
  });
}

/**
 * Record that an intent's transaction is live, for a caller that has already sent it.
 *
 * The one thing every post-broadcast path must do, and the reason it never throws: once
 * `send` has returned a hash the transaction exists whether or not we manage to write it down,
 * so an error here is not a reason to treat the intent as unsent. The pre-broadcast retry path
 * -- `releaseIntentForRetry`, and the rebroadcast sweep behind it -- is reachable only from a
 * failure that happened *before* a hash existed. Routing a failure from after the hash into it
 * hands `listUnbroadcastIntents` an intent it will read as provably never broadcast and send a
 * second time, which for a paid intent is one payment and two chain calls (ADR-0045, ADR-0050).
 *
 * Failing to persist the hash is still bad -- the intent is then genuinely indistinguishable
 * from an unsent one -- so it is logged at error level rather than swallowed. What the caller
 * must not do is make it worse by reporting the send as not having happened.
 */
export async function persistIntentBroadcast(input: {
  db: Db;
  intentId: string;
  txHash: string;
}): Promise<void> {
  try {
    await linkIntentToBroadcast(input);
  } catch (error) {
    logger.error('Recording the broadcast of a relayed intent failed; the transaction is live', {
      error: error instanceof Error ? error.message : String(error),
      intentId: input.intentId,
      txHash: input.txHash,
    });
  }
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

/**
 * Retire an intent's remaining rebroadcast attempts without sending anything.
 *
 * For an operation with no registered broadcaster there is no attempt to make: its payload
 * cannot be turned back into a transaction. Spending the budget outright is what keeps such an
 * intent from sitting in `recorded` forever being skipped on every worker pass -- it falls
 * through to the abandoned path, where a paid one is refunded, exactly as it was before
 * rebroadcasting existed.
 */
export async function exhaustIntentBroadcastAttempts(input: {
  db: Db;
  intentId: string;
}): Promise<void> {
  await input.db
    .update(relayedIntents)
    .set({ broadcastAttempts: MAX_BROADCAST_ATTEMPTS, updatedAt: new Date() })
    .where(eq(relayedIntents.id, input.intentId));
}

export async function markIntentCompleted(input: { db: Db; intentId: string }): Promise<void> {
  const now = new Date();
  await input.db
    .update(relayedIntents)
    .set({ completedAt: now, lastError: null, status: 'completed', updatedAt: now })
    .where(eq(relayedIntents.id, input.intentId));
}

/**
 * Terminal failure. Only the chain may put an intent here -- never a timeout (ADR-0045).
 *
 * `completed` is excluded in the predicate rather than by a read-then-write in the caller,
 * because the race this loses is not hypothetical: a request completing an intent and a
 * reconciler pass reading a replacement's verdict for the same nonce run concurrently, and a
 * check made before the UPDATE is already stale by the time the UPDATE runs. Overwriting a
 * `completed` intent would hide work that demonstrably happened, and on a paid intent it points
 * settlement at a refund for a task the requester already has.
 */
export async function markIntentFailed(input: {
  db: Db;
  intentId: string;
  reason: string;
}): Promise<void> {
  await input.db
    .update(relayedIntents)
    .set({ lastError: input.reason.slice(0, 500), status: 'failed', updatedAt: new Date() })
    .where(and(eq(relayedIntents.id, input.intentId), ne(relayedIntents.status, 'completed')));
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
        // The outbox row must still carry this intent's own transaction. A differing hash means
        // the reconciler replaced a stuck nonce, so what confirmed is a no-op self-transfer and
        // not this work -- sweeping it would complete an intent whose call never landed.
        eq(serverWalletTransactions.txHash, relayedIntents.txHash),
        inArray(relayedIntents.status, ['recorded', 'broadcast'])
      )
    )
    .limit(input.limit);

  return rows.map((row) => row.intent);
}

/**
 * Intents stuck in 'recorded' that are out of rebroadcast attempts.
 *
 * Refund is the fallback, not the reflex. An intent that never reached the chain is first
 * retried -- giving the payer the thing they paid for beats giving them their money back --
 * and only once `MAX_BROADCAST_ATTEMPTS` is spent does it become a write-off. Nothing is live
 * on chain in either case, so a payment here is genuinely refundable.
 */
export async function listAbandonedIntents(input: {
  db: Db;
  cutoff: Date;
  limit: number;
}): Promise<RelayedIntent[]> {
  return input.db
    .select()
    .from(relayedIntents)
    .where(
      and(
        eq(relayedIntents.status, 'recorded'),
        gte(relayedIntents.broadcastAttempts, MAX_BROADCAST_ATTEMPTS),
        lt(relayedIntents.updatedAt, input.cutoff)
      )
    )
    .limit(input.limit);
}

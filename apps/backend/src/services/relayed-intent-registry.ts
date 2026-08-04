// Implements: ADR-0045, ADR-0050, ADR-0053
import type { db as DbType } from '../db/client';
import type { RelayedIntent } from '../db/schema';
import { logger } from '../lib/logger';
import { classifyRelayFailure, relayFailureReason } from '../lib/relay-failure';
import { ServerTransactionPendingError } from '../lib/server-transaction-dispatcher';
import { withRelayEnvelope } from './relay-envelope';
import {
  claimIntentForBroadcast,
  claimIntentForCompletion,
  exhaustIntentBroadcastAttempts,
  markIntentCompleted,
  markIntentFailed,
  persistIntentBroadcast,
  recordIntentCompletionError,
  relayEnvelopeForIntent,
  releaseIntentForRetry,
  type RelayedIntentOperation,
} from './relayed-intents';

type Db = typeof DbType;

/**
 * The work an operation performs once its transaction is confirmed on chain.
 *
 * Two hard requirements, both load-bearing:
 *
 *   1. **Idempotent.** The original request and a reconciler pass can both observe the same
 *      successful receipt. `claimIntentForCompletion` narrows that to one caller, but a
 *      process can still die mid-handler and be retried, so the handler itself must tolerate
 *      partial prior application.
 *   2. **No bare chain calls.** By the time this runs the transaction is already confirmed.
 *      A handler that needs further on-chain work records its own intent for it and hands
 *      that to `dispatchRelayedIntent`, so that transaction has a durable record of its own
 *      before it is sent (ADR-0045), exactly as a request path does.
 */
export type RelayedIntentCompletionHandler = (context: {
  db: Db;
  intent: RelayedIntent;
  txHash: string;
}) => Promise<void>;

/**
 * How an intent gets on chain from its persisted payload alone.
 *
 * Most intents are broadcast by the request that recorded them, which still holds the
 * validated inputs in hand and needs nothing from here. An operation that can be started
 * somewhere with no request context -- today, the evaluator assignment a confirmed task
 * creation triggers -- must be sendable from its jsonb payload by whoever picks it up, which
 * is what this provides.
 */
export type RelayedIntentBroadcaster = (context: {
  db: Db;
  intent: RelayedIntent;
}) => Promise<string>;

/**
 * Hand back the guard state an operation claimed before its chain call.
 *
 * ADR-0050 draws the line between *outcome* state, which records that something happened and
 * so belongs after confirmation, and *guard* state, which reserves the right to attempt
 * something and so must be claimed before -- a mutex acquired after the critical section is
 * not a mutex. The `dreams_withdraw_nonces` row is the second kind, and today the only one
 * wired here: `withdrawFor` is relayed by the backend wallet rather than sent as a user
 * transaction, so that row is the entire replay protection for a signed authorization.
 *
 * Claiming before the call leaves the mirror-image problem -- a guard consumed for a call that
 * never landed, locking the user out of an authorization they legitimately still hold -- and
 * this is what closes it. It is declared alongside `broadcast` and `complete` so an operation
 * states its whole lifecycle in one place, and so the release is resolved from the payload on
 * the intent row rather than from a request that has long since gone.
 *
 * Releasing is security-relevant in a way completing is not: it reopens a window. So it is
 * invoked from exactly the sites that write a terminal `failed`, all of which reach that state
 * only from confirmed on-chain evidence or from an exhausted retry budget -- never from a
 * timeout and never from an ambiguous send error, where the transaction may still be live.
 */
export type RelayedIntentGuardRelease = (context: {
  db: Db;
  intent: RelayedIntent;
}) => Promise<void>;

type RegisteredOperation = {
  broadcast?: RelayedIntentBroadcaster;
  complete: RelayedIntentCompletionHandler;
  releaseGuard?: RelayedIntentGuardRelease;
};

const handlers = new Map<RelayedIntentOperation, RegisteredOperation>();

export function registerRelayedIntentHandler(
  operation: RelayedIntentOperation,
  handler: RelayedIntentCompletionHandler | RegisteredOperation
): void {
  handlers.set(operation, typeof handler === 'function' ? { complete: handler } : handler);
}

export function getRelayedIntentHandler(
  operation: string
): RelayedIntentCompletionHandler | undefined {
  return handlers.get(operation as RelayedIntentOperation)?.complete;
}

export function getRelayedIntentBroadcaster(
  operation: string
): RelayedIntentBroadcaster | undefined {
  return handlers.get(operation as RelayedIntentOperation)?.broadcast;
}

export function registeredRelayedIntentOperations(): RelayedIntentOperation[] {
  return [...handlers.keys()].sort();
}

/**
 * Release an intent's guard state, if its operation claimed any.
 *
 * Call this immediately after writing `failed`, and nowhere else. The precondition is not
 * "the send threw" but "the chain has said no, or we have stopped asking": a release on an
 * ambiguous outcome hands back a replay guard while the original transaction may still mine,
 * which on the DREAMS path is a double-spend of rewards.
 *
 * Never throws. A guard left claimed is the safe direction of this failure -- the user retries
 * with a fresh authorization -- whereas propagating would abort a settlement pass part way
 * through and leave a payment unrefunded, so the error is logged and the sweep continues.
 */
export async function releaseIntentGuard(input: { db: Db; intent: RelayedIntent }): Promise<void> {
  const release = handlers.get(input.intent.operation as RelayedIntentOperation)?.releaseGuard;
  if (!release) return;

  try {
    await release({ db: input.db, intent: input.intent });
  } catch (error) {
    logger.error('Releasing the guard for a failed relayed intent did not complete', {
      error: error instanceof Error ? error.message : String(error),
      intentId: input.intent.id,
      operation: input.intent.operation,
    });
  }
}

/**
 * Run an intent's completion handler exactly once.
 *
 * Returns true when the work is done -- either because this call did it, or because someone
 * else already had. Returns false when the handler threw, leaving the intent claimable so a
 * later reconciler pass retries it: a completion that fails must not silently mark the intent
 * finished, or the on-chain state and the database diverge permanently.
 */
export async function completeRelayedIntent(input: {
  db: Db;
  intent: RelayedIntent;
  txHash: string;
}): Promise<boolean> {
  const handler = getRelayedIntentHandler(input.intent.operation);
  if (!handler) {
    // Not fatal to the caller, but it means an operation shipped without a handler and its
    // on-chain effect will never be reflected in the database. Loud on purpose.
    logger.error('No completion handler registered for relayed intent', {
      intentId: input.intent.id,
      operation: input.intent.operation,
    });
    await recordIntentCompletionError({
      db: input.db,
      intentId: input.intent.id,
      error: new Error(`No completion handler registered for operation ${input.intent.operation}`),
    });
    return false;
  }

  const claimed = await claimIntentForCompletion({ db: input.db, intentId: input.intent.id });
  if (!claimed) return true; // Already completed or failed by another caller.

  // The receipt must belong to this intent's own transaction. They can differ: the reconciler
  // replaces a stuck nonce with a no-op self-transfer, and the outbox row then carries the
  // replacement's hash while the intent still carries the original's. A success on that hash
  // means the replacement mined, which is precisely the evidence that the intent's work did
  // *not* happen -- so completing here would write a database row asserting something the chain
  // never did. Settlement decides what such an intent becomes; this only refuses to finish it.
  if (claimed.txHash && claimed.txHash.toLowerCase() !== input.txHash.toLowerCase()) {
    logger.error('Refusing to complete a relayed intent from another transaction receipt', {
      intentId: claimed.id,
      intentTxHash: claimed.txHash,
      operation: claimed.operation,
      receiptTxHash: input.txHash,
    });
    return false;
  }

  try {
    await handler({ db: input.db, intent: claimed, txHash: input.txHash });
    await markIntentCompleted({ db: input.db, intentId: claimed.id });
    return true;
  } catch (error) {
    logger.error('Relayed intent completion failed', {
      error: error instanceof Error ? error.message : String(error),
      intentId: claimed.id,
      operation: claimed.operation,
    });
    await recordIntentCompletionError({ db: input.db, intentId: claimed.id, error });
    return false;
  }
}

/** What became of one broadcast attempt. */
export type IntentDispatchOutcome =
  /** On chain, or in flight and owned by the reconciler. */
  | 'broadcast'
  /** Somebody else claimed it, or the operation has no registered broadcaster. */
  | 'skipped'
  /** Deterministically rejected by the chain; terminal, and nobody will try again. */
  | 'failed'
  /** Nothing reached the chain; left claimable for the worker's next pass. */
  | 'retry';

/**
 * Get one intent's transaction onto the chain from its persisted payload.
 *
 * The single broadcast path for an intent whose sender is not the request that recorded it:
 * used eagerly by whoever recorded it, and by the worker that sweeps up anything nobody sent.
 * Which of the two calls it changes only when it runs, never what it does, so an intent picked
 * up by the worker hours later is handled identically to one dispatched milliseconds ago.
 *
 * Never throws. Every caller is already past the point where a failure here is actionable to
 * anyone -- the recording caller has a durable row either way -- and letting it propagate would
 * misreport unrelated work as having failed.
 */
export async function dispatchRelayedIntent(input: {
  db: Db;
  intent: RelayedIntent;
}): Promise<IntentDispatchOutcome> {
  const broadcast = getRelayedIntentBroadcaster(input.intent.operation);
  if (!broadcast) {
    // An operation dispatched this way shipped without a way to send it: its payload cannot
    // be turned back into a transaction, so there is no attempt to make now or later. Its
    // budget is spent outright rather than left intact, so the intent stops being re-examined
    // on every worker pass and reaches the abandoned path -- where a paid one is refunded, as
    // it was before rebroadcasting existed.
    logger.error('No broadcaster registered for relayed intent', {
      intentId: input.intent.id,
      operation: input.intent.operation,
    });
    await exhaustIntentBroadcastAttempts({ db: input.db, intentId: input.intent.id });
    await recordIntentCompletionError({
      db: input.db,
      intentId: input.intent.id,
      error: new Error(`No broadcaster registered for operation ${input.intent.operation}`),
    });
    return 'skipped';
  }

  const claimed = await claimIntentForBroadcast({
    db: input.db,
    expectedAttempts: input.intent.broadcastAttempts,
    intentId: input.intent.id,
  });
  if (!claimed) return 'skipped';

  // Only the send is inside the try, and the boundary is load-bearing. Everything below it runs
  // after a hash exists, which means the transaction is live; the catch classifies failures and
  // its transient branch hands the intent back to the rebroadcast sweep as never broadcast. A
  // post-broadcast failure routed through there would be read as provably unsent and sent again
  // -- one payment, two chain calls (ADR-0045, ADR-0050). So the send's verdict is the only
  // thing that classification is ever allowed to see.
  let txHash: string;
  try {
    // The stored envelope, not a fresh one: this is the rebroadcast path, and replaying the
    // deadline the intent was recorded with is what makes the deadline mean anything.
    txHash = await withRelayEnvelope(relayEnvelopeForIntent(claimed), () =>
      broadcast({ db: input.db, intent: claimed })
    );
  } catch (error) {
    // The transaction is live and owned by the reconciler (ADR-0045). Recording the hash is
    // the whole job here -- rebroadcasting would spend a second nonce on the same work.
    if (error instanceof ServerTransactionPendingError) {
      await persistIntentBroadcast({ db: input.db, intentId: claimed.id, txHash: error.hash });
      return 'broadcast';
    }

    if (classifyRelayFailure(error) === 'deterministic') {
      const reason = relayFailureReason(error);
      logger.error('Relayed intent rejected by the chain; not retrying', {
        intentId: claimed.id,
        operation: claimed.operation,
        reason,
      });

      // Retrying is pointless either way -- the inputs and the on-chain state that produced
      // this revert will not change by waiting -- but who writes the terminal state depends
      // on whether money is involved.
      if (claimed.paymentTxHash) {
        // A paid intent must reach `failed` through settlement, because that is the only
        // place allowed to decide a payment is orphaned (ADR-0048). Marking it failed here
        // would strand the payer: settlement's abandoned sweep only ever looks at `recorded`,
        // so it would never see this intent and never refund it. Spending the retry budget
        // instead leaves it exactly where that sweep will find it on its next pass.
        await exhaustIntentBroadcastAttempts({ db: input.db, intentId: claimed.id });
        await recordIntentCompletionError({ db: input.db, intentId: claimed.id, error });
        return 'failed';
      }

      // Nothing was paid, so there is nothing for settlement to decide and no reason to make
      // it wait: an intent that never reaches a terminal state is invisible to anything
      // watching for failures.
      await markIntentFailed({ db: input.db, intentId: claimed.id, reason });
      // A deterministic revert is the chain's own verdict, so it satisfies the same
      // confirmed-failure precondition settlement's release does. This branch is only reached
      // for an unpaid intent; a paid one exhausts its budget above and is released by
      // settleAbandonedIntents instead, so the guard is handed back exactly once either way.
      await releaseIntentGuard({ db: input.db, intent: claimed });
      return 'failed';
    }

    // Transient: nothing reached the chain, so this work simply has not happened yet. Back to
    // `recorded` for the worker's next pass.
    await releaseIntentForRetry({ db: input.db, intentId: claimed.id });
    await recordIntentCompletionError({ db: input.db, intentId: claimed.id, error });
    logger.warn('Relayed intent broadcast failed; will retry', {
      error: error instanceof Error ? error.message : String(error),
      intentId: claimed.id,
      operation: claimed.operation,
    });
    return 'retry';
  }

  // Past the boundary: the hash exists, so the outcome is 'broadcast' whatever happens from
  // here. Persisting the hash comes first and cannot throw, because that write is what stops
  // the rebroadcast sweep treating this intent as one that never reached the chain.
  await persistIntentBroadcast({ db: input.db, intentId: claimed.id, txHash });

  // A broadcaster that returns normally has already awaited its receipt -- that is what the
  // shared dispatcher guarantees -- so the outbox row is `confirmed` before we get here, and
  // the reconciler's main pass only ever examines rows still in `broadcast`. Nothing else
  // will observe this receipt, so the completion has to run here, exactly as the tasks.create
  // request path runs it after its own dispatch returns. Omitting it strands the intent at
  // `completion_attempts: 0` with the transaction sitting confirmed on chain.
  //
  // Safe to run inline even though a completion handler may itself record and dispatch
  // further intents: those are distinct rows, so the recursion is bounded by the operation
  // graph rather than by this call, and the conditional claim inside completeRelayedIntent
  // still admits only one caller per intent if a reconciler pass observes the same receipt.
  //
  // completeRelayedIntent swallows a handler's own failure, but not a database failure of its
  // own; either way an unfinished completion is recovered by `listConfirmedUnsettledIntents`,
  // and neither is a reason to send the transaction again.
  try {
    await completeRelayedIntent({ db: input.db, intent: claimed, txHash });
  } catch (error) {
    logger.error('Completing a broadcast relayed intent failed; the sweep will retry it', {
      error: error instanceof Error ? error.message : String(error),
      intentId: claimed.id,
      operation: claimed.operation,
    });
  }
  return 'broadcast';
}

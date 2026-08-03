// Implements: ADR-0045
import type { db as DbType } from '../db/client';
import type { RelayedIntent } from '../db/schema';
import { logger } from '../lib/logger';
import { classifyRelayFailure, relayFailureReason } from '../lib/relay-failure';
import { ServerTransactionPendingError } from '../lib/server-transaction-dispatcher';
import {
  claimIntentForBroadcast,
  claimIntentForCompletion,
  linkIntentToBroadcast,
  markIntentCompleted,
  markIntentFailed,
  recordIntentCompletionError,
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

type RegisteredOperation = {
  broadcast?: RelayedIntentBroadcaster;
  complete: RelayedIntentCompletionHandler;
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
    // An operation dispatched this way shipped without a way to send it. Its intent is
    // durable, so nothing is lost, but nothing will ever advance it either.
    logger.error('No broadcaster registered for relayed intent', {
      intentId: input.intent.id,
      operation: input.intent.operation,
    });
    await recordIntentCompletionError({
      db: input.db,
      intentId: input.intent.id,
      error: new Error(`No broadcaster registered for operation ${input.intent.operation}`),
    });
    return 'skipped';
  }

  const claimed = await claimIntentForBroadcast({ db: input.db, intentId: input.intent.id });
  if (!claimed) return 'skipped';

  try {
    const txHash = await broadcast({ db: input.db, intent: claimed });
    // linkIntentToBroadcast, not markIntentBroadcast: without the outbox row id the reconciler
    // has nothing to settle the intent against, so the intent would sit in `broadcast` forever
    // even after its receipt landed.
    await linkIntentToBroadcast({ db: input.db, intentId: claimed.id, txHash });
    return 'broadcast';
  } catch (error) {
    // The transaction is live and owned by the reconciler (ADR-0045). Recording the hash is
    // the whole job here -- rebroadcasting would spend a second nonce on the same work.
    if (error instanceof ServerTransactionPendingError) {
      await linkIntentToBroadcast({ db: input.db, intentId: claimed.id, txHash: error.hash });
      return 'broadcast';
    }

    if (classifyRelayFailure(error) === 'deterministic') {
      const reason = relayFailureReason(error);
      // Terminal: the inputs and the on-chain state that produced this revert will not change
      // by waiting, and an intent that never reaches a terminal state is invisible to anything
      // watching for failures. No refund is involved either way -- an intent dispatched from
      // here carries no payment reference of its own, and the refund rule is a confirmed
      // failure of an intent that actually carries a payment (relayed-intent-settlement.ts).
      await markIntentFailed({ db: input.db, intentId: claimed.id, reason });
      logger.error('Relayed intent rejected by the chain; not retrying', {
        intentId: claimed.id,
        operation: claimed.operation,
        reason,
      });
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
}

// Implements: ADR-0045
// Implements: ADR-0046
import type { db as DbType } from '../db/client';
import type { RelayedIntent } from '../db/schema';
import { logger } from '../lib/logger';
import { classifyRelayFailure, relayFailureReason } from '../lib/relay-failure';
import { ServerTransactionPendingError } from '../lib/server-transaction-dispatcher';
import {
  claimFollowOnForBroadcast,
  claimIntentForCompletion,
  linkIntentToBroadcast,
  listPendingFollowOns,
  markIntentCompleted,
  markIntentFailed,
  recordIntentCompletionError,
  releaseFollowOnForRetry,
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
 *   2. **No chain calls.** By the time this runs the transaction is already confirmed. A
 *      handler that relays further work would need its own intent.
 */
export type RelayedIntentCompletionHandler = (context: {
  db: Db;
  intent: RelayedIntent;
  txHash: string;
}) => Promise<void>;

/**
 * How a follow-on intent gets on chain (ADR-0046).
 *
 * A root intent is broadcast by the request that created it, which holds the validated inputs
 * in hand. A follow-on is enqueued from inside a completion handler and must be sendable from
 * its persisted payload alone -- by whoever completed the parent, or by the worker hours
 * later -- so any operation reachable as a follow-on must provide this.
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
    // The handler may have enqueued the next link in the chain. Broadcast it now rather than
    // leaving it for the worker's next poll: the durable record is already written, which is
    // the whole of ADR-0046's guarantee, and deferring the send adds nothing but latency. For
    // a status-gated follow-on such as assignEvaluator that latency is not cosmetic -- a
    // worker agent can claim the task in the interval, after which the call can never succeed.
    await dispatchPendingFollowOns({ db: input.db, parentIntentId: claimed.id });
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

/** What became of one follow-on broadcast attempt. */
export type FollowOnDispatchOutcome =
  /** On chain, or in flight and owned by the reconciler. */
  | 'broadcast'
  /** Somebody else claimed it, or the operation has no registered broadcaster. */
  | 'skipped'
  /** Deterministically rejected by the chain; terminal, and nobody will try again. */
  | 'failed'
  /** Nothing reached the chain; left claimable for the worker's next pass. */
  | 'retry';

/**
 * Get one follow-on intent onto the chain (ADR-0046).
 *
 * The single broadcast path, shared by whoever completed the parent and by the worker that
 * sweeps up follow-ons nobody broadcast. Which of the two calls it changes only when it runs,
 * never what it does, so a follow-on created during a reconciler pass with no request context
 * is handled identically to one created milliseconds ago.
 *
 * Never throws: the parent's transaction is already on chain by the time any of this runs, so
 * there is no caller for whom a follow-on problem is actionable, and letting it propagate
 * would misreport a completed parent as incomplete.
 */
export async function dispatchFollowOnIntent(input: {
  db: Db;
  intent: RelayedIntent;
}): Promise<FollowOnDispatchOutcome> {
  const broadcast = getRelayedIntentBroadcaster(input.intent.operation);
  if (!broadcast) {
    // An operation reachable as a follow-on shipped without a way to send it. Its intent is
    // durable, so nothing is lost, but nothing will ever advance it either.
    logger.error('No broadcaster registered for follow-on intent', {
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

  const claimed = await claimFollowOnForBroadcast({ db: input.db, intentId: input.intent.id });
  if (!claimed) return 'skipped';

  try {
    const txHash = await broadcast({ db: input.db, intent: claimed });
    // linkIntentToBroadcast, not markIntentBroadcast: without the outbox row id the reconciler
    // has nothing to settle the intent against, so a follow-on would sit in `broadcast`
    // forever even after its receipt landed.
    await linkIntentToBroadcast({ db: input.db, intentId: claimed.id, txHash });
    return 'broadcast';
  } catch (error) {
    // The transaction is live and owned by the reconciler (ADR-0045). Recording the hash is
    // the whole job here -- rebroadcasting would spend a second nonce on the same link.
    if (error instanceof ServerTransactionPendingError) {
      await linkIntentToBroadcast({ db: input.db, intentId: claimed.id, txHash: error.hash });
      return 'broadcast';
    }

    if (classifyRelayFailure(error) === 'deterministic') {
      const reason = relayFailureReason(error);
      // Terminal, and deliberately with no refund. A deterministic revert here happens at
      // simulation, before a nonce is spent, so there is no on-chain evidence of failure to
      // settle against -- and the money in question is not this link's anyway. The payment
      // belongs to the root, whose own transaction (the escrow) already succeeded: the task
      // exists and is funded. Refunding the escrow while the contract still holds the same
      // funds would pay for one task twice, which is the double spend ADR-0045 exists to
      // prevent. The chain records where it stopped; the parent's effect stands.
      await markIntentFailed({ db: input.db, intentId: claimed.id, reason });
      logger.error('Follow-on intent rejected by the chain; not retrying', {
        intentId: claimed.id,
        operation: claimed.operation,
        reason,
      });
      return 'failed';
    }

    // Transient: nothing reached the chain, so the parent's effect stands and the chain simply
    // has not advanced yet. Back to `recorded` for the worker's next pass.
    await releaseFollowOnForRetry({ db: input.db, intentId: claimed.id });
    await recordIntentCompletionError({ db: input.db, intentId: claimed.id, error });
    logger.warn('Follow-on intent broadcast failed; will retry', {
      error: error instanceof Error ? error.message : String(error),
      intentId: claimed.id,
      operation: claimed.operation,
    });
    return 'retry';
  }
}

/** Broadcast every follow-on a just-completed parent enqueued, without ever throwing. */
export async function dispatchPendingFollowOns(input: {
  db: Db;
  parentIntentId: string;
}): Promise<void> {
  try {
    const followOns = await listPendingFollowOns({
      db: input.db,
      parentIntentId: input.parentIntentId,
    });
    for (const followOn of followOns) {
      await dispatchFollowOnIntent({ db: input.db, intent: followOn });
    }
  } catch (error) {
    // The follow-ons are durable rows and the worker will find them. Never let this failure be
    // mistaken for the parent's completion having failed.
    logger.error('Eager follow-on dispatch failed; leaving them for the worker', {
      error: error instanceof Error ? error.message : String(error),
      parentIntentId: input.parentIntentId,
    });
  }
}

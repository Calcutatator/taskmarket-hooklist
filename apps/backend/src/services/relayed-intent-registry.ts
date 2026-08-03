// Implements: ADR-0045
import type { db as DbType } from '../db/client';
import type { RelayedIntent } from '../db/schema';
import { logger } from '../lib/logger';
import {
  claimIntentForCompletion,
  markIntentCompleted,
  recordIntentCompletionError,
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

const handlers = new Map<RelayedIntentOperation, RelayedIntentCompletionHandler>();

export function registerRelayedIntentHandler(
  operation: RelayedIntentOperation,
  handler: RelayedIntentCompletionHandler
): void {
  handlers.set(operation, handler);
}

export function getRelayedIntentHandler(
  operation: string
): RelayedIntentCompletionHandler | undefined {
  return handlers.get(operation as RelayedIntentOperation);
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

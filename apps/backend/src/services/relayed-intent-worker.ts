// Implements: ADR-0046
import { and, asc, eq, isNotNull, lt } from 'drizzle-orm';

import { db } from '../db/client';
import { relayedIntents, type RelayedIntent } from '../db/schema';
import { logger } from '../lib/logger';
import { getRelayedIntentBroadcaster } from './relayed-intent-registry';
import { markIntentBroadcast, recordIntentCompletionError } from './relayed-intents';

export const DEFAULT_INTENT_WORKER_INTERVAL_MS = 10_000;
const MAX_INTENTS_PER_PASS = 10;

/**
 * Broadcasts follow-on intents.
 *
 * A root intent is broadcast by the request that created it. A follow-on is enqueued from
 * inside its parent's completion handler, long after any request has gone, so something has to
 * pick it up -- otherwise a chain would stall permanently at its second link and the operation
 * would be silently half-applied, which is the failure mode ADR-0045 exists to remove.
 *
 * Scoped to intents with a parent on purpose. A *root* stuck in `recorded` means the process
 * died before broadcasting, so nothing is on chain and the payment is genuinely refundable --
 * a different situation with a different answer, handled by the abandoned-intent path rather
 * than by rebroadcasting here.
 */
export function createRelayedIntentWorker(options?: { database?: typeof db }) {
  const database = options?.database ?? db;

  async function claimFollowOn(intent: RelayedIntent): Promise<RelayedIntent | null> {
    // Same conditional-claim pattern as completion: two workers, or a worker racing a retry,
    // must not both broadcast the same intent and spend two nonces for one link.
    const [claimed] = await database
      .update(relayedIntents)
      .set({ updatedAt: new Date() })
      .where(and(eq(relayedIntents.id, intent.id), eq(relayedIntents.status, 'recorded')))
      .returning();
    return claimed ?? null;
  }

  return async function processFollowOnIntents(): Promise<void> {
    const pending = await database
      .select()
      .from(relayedIntents)
      .where(and(eq(relayedIntents.status, 'recorded'), isNotNull(relayedIntents.parentIntentId)))
      .orderBy(asc(relayedIntents.createdAt))
      .limit(MAX_INTENTS_PER_PASS);

    for (const intent of pending) {
      const broadcast = getRelayedIntentBroadcaster(intent.operation);
      if (!broadcast) {
        logger.error('No broadcaster registered for follow-on intent', {
          intentId: intent.id,
          operation: intent.operation,
        });
        await recordIntentCompletionError({
          db: database,
          intentId: intent.id,
          error: new Error(`No broadcaster registered for operation ${intent.operation}`),
        });
        continue;
      }

      const claimed = await claimFollowOn(intent);
      if (!claimed) continue;

      try {
        const txHash = await broadcast({ db: database, intent: claimed });
        await markIntentBroadcast({ db: database, intentId: claimed.id, txHash });
      } catch (error) {
        // Leave it in `recorded` so the next pass retries. Nothing reached the chain, so the
        // parent's effect stands and the chain simply has not advanced yet.
        await database
          .update(relayedIntents)
          .set({ status: 'recorded', updatedAt: new Date() })
          .where(eq(relayedIntents.id, claimed.id));
        await recordIntentCompletionError({ db: database, intentId: claimed.id, error });
        logger.warn('Follow-on intent broadcast failed; will retry', {
          error: error instanceof Error ? error.message : String(error),
          intentId: claimed.id,
          operation: claimed.operation,
        });
      }
    }
  };
}

export function startRelayedIntentWorker(
  process: () => Promise<void>,
  intervalMs: number = DEFAULT_INTENT_WORKER_INTERVAL_MS
): NodeJS.Timeout {
  const timer = setInterval(() => {
    void process().catch((error) => {
      logger.error('Relayed intent worker pass failed', error);
    });
  }, intervalMs);
  timer.unref?.();
  return timer;
}

/** Intents that never reached the chain, so their payment is genuinely refundable. */
export async function listAbandonedRootIntents(cutoff: Date, limit = MAX_INTENTS_PER_PASS) {
  return db
    .select()
    .from(relayedIntents)
    .where(and(eq(relayedIntents.status, 'recorded'), lt(relayedIntents.updatedAt, cutoff)))
    .limit(limit);
}

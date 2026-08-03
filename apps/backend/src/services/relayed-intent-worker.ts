// Implements: ADR-0045
import { and, asc, eq, isNull, lt } from 'drizzle-orm';

import { db } from '../db/client';
import { relayedIntents } from '../db/schema';
import { logger } from '../lib/logger';
import { dispatchRelayedIntent } from './relayed-intent-registry';
import { settleAbandonedIntents } from './relayed-intent-settlement';

export const DEFAULT_INTENT_WORKER_INTERVAL_MS = 10_000;
const MAX_INTENTS_PER_PASS = 10;

/**
 * How long an intent must have sat untouched before the worker treats it as orphaned.
 *
 * Every intent is broadcast eagerly by whoever recorded it, immediately after the durable row
 * is written. Claiming an intent for broadcast updates its `updatedAt`, so anything newer than
 * this window is either being broadcast right now or was just handed back after a transient
 * failure -- picking it up would spend a second nonce on the same work, or retry a network blip
 * harder than it deserves.
 */
export const INTENT_ORPHAN_GRACE_MS = 30_000;

/**
 * Crash fallback. Nothing more.
 *
 * With eager dispatch there is exactly one way an intent can be stuck in `recorded`: the
 * process died between writing the row and broadcasting its transaction, or an RPC failure
 * handed it back for another try. Nothing is on chain in either case, so rebroadcasting is
 * safe, and this is the only thing that will ever do it.
 *
 * Scoped to intents that carry no payment, which today means the evaluator assignment a
 * confirmed task creation starts. An intent that *does* carry a payment and never reached the
 * chain is a different situation with a different answer -- the payment is genuinely
 * refundable, and refunding it is the abandoned-intent path's job, not a rebroadcast here.
 */
export function createRelayedIntentWorker(options?: {
  database?: typeof db;
  graceMs?: number;
  now?: () => number;
}) {
  const database = options?.database ?? db;
  const graceMs = options?.graceMs ?? INTENT_ORPHAN_GRACE_MS;
  const now = options?.now ?? Date.now;

  return async function processUnbroadcastIntents(): Promise<void> {
    const cutoff = new Date(now() - graceMs);
    const pending = await database
      .select()
      .from(relayedIntents)
      .where(
        and(
          eq(relayedIntents.status, 'recorded'),
          isNull(relayedIntents.paymentTxHash),
          lt(relayedIntents.updatedAt, cutoff)
        )
      )
      .orderBy(asc(relayedIntents.createdAt))
      .limit(MAX_INTENTS_PER_PASS);

    for (const intent of pending) {
      // Classification, claiming and the terminal-vs-retry decision all live in the shared
      // dispatch path, so an intent behaves identically whether a request or this worker sent
      // it. It never throws.
      await dispatchRelayedIntent({ db: database, intent });
    }

    // The other half of `recorded`: an intent that does carry a payment and never reached the
    // chain is not rebroadcast, it is written off. Settlement makes that call, not this
    // worker -- the worker only says when to look (ADR-0048).
    await settleAbandonedIntents(MAX_INTENTS_PER_PASS);
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

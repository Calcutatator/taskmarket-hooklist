// Implements: ADR-0046
import { and, asc, eq, isNotNull, lt } from 'drizzle-orm';

import { db } from '../db/client';
import { relayedIntents } from '../db/schema';
import { logger } from '../lib/logger';
import { dispatchFollowOnIntent } from './relayed-intent-registry';

export const DEFAULT_INTENT_WORKER_INTERVAL_MS = 10_000;
const MAX_INTENTS_PER_PASS = 10;

/**
 * How long a follow-on must have sat untouched before the worker treats it as orphaned.
 *
 * A follow-on is normally broadcast by whoever completed its parent, immediately after the
 * durable row is written. Claiming a follow-on updates its
 * `updatedAt`, so anything newer than this window is either being broadcast right now or was
 * just handed back after a transient failure -- picking it up would spend a second nonce on
 * the same link, or retry a network blip harder than it deserves.
 */
export const FOLLOW_ON_ORPHAN_GRACE_MS = 30_000;

/**
 * Crash and reconciler fallback for follow-on intents. Nothing more.
 *
 * The common case never reaches here: a completion broadcasts its follow-ons eagerly, in
 * whatever context completed the parent, so a chain advances at request speed rather than at
 * poll speed. This exists only for the links that had nobody to do that -- a process that died
 * between enqueuing a follow-on and sending it, or a transient RPC failure that handed one
 * back for another try.
 *
 * Scoped to intents with a parent on purpose. A *root* stuck in `recorded` means the process
 * died before broadcasting, so nothing is on chain and the payment is genuinely refundable --
 * a different situation with a different answer, handled by the abandoned-intent path rather
 * than by rebroadcasting here.
 */
export function createRelayedIntentWorker(options?: {
  database?: typeof db;
  graceMs?: number;
  now?: () => number;
}) {
  const database = options?.database ?? db;
  const graceMs = options?.graceMs ?? FOLLOW_ON_ORPHAN_GRACE_MS;
  const now = options?.now ?? Date.now;

  return async function processFollowOnIntents(): Promise<void> {
    const cutoff = new Date(now() - graceMs);
    const pending = await database
      .select()
      .from(relayedIntents)
      .where(
        and(
          eq(relayedIntents.status, 'recorded'),
          isNotNull(relayedIntents.parentIntentId),
          lt(relayedIntents.updatedAt, cutoff)
        )
      )
      .orderBy(asc(relayedIntents.createdAt))
      .limit(MAX_INTENTS_PER_PASS);

    for (const intent of pending) {
      // Classification, claiming and the terminal-vs-retry decision all live in the shared
      // dispatch path, so a follow-on behaves identically whether a request or this worker
      // sent it. It never throws.
      await dispatchFollowOnIntent({ db: database, intent });
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

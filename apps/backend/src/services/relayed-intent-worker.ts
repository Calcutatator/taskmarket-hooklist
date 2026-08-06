// Implements: ADR-0045, ADR-0050
import { db } from '../db/client';
import { logger } from '../lib/logger';
import { dispatchRelayedIntent } from './relayed-intent-registry';
import { settleAbandonedIntents } from './relayed-intent-settlement';
import { settleStrandedIntents } from './relayed-intent-stranded';
import { settlePendingOrphanedRefunds } from './orphaned-payments';
import { expireStaleReservations } from './reservation-sweep';
import { countStaleNonTerminalIntents, listUnbroadcastIntents } from './relayed-intents';
import { publishStaleIntentSnapshot } from './intent-health-snapshot';

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
 * Paid intents are rebroadcast too, and that is the point. A requester who paid for a task
 * wants the task; refunding them is the consolation prize, and we are holding the payload that
 * would have produced it. It is safe because `listUnbroadcastIntents` requires positive
 * evidence that nothing was ever sent -- no outbox row and no hash, and the outbox row is
 * written at nonce allocation, before any broadcast. Refund is what happens after the retry
 * budget is spent, not instead of it.
 *
 * A rebroadcast replays the persisted payload verbatim and amends nothing -- no deadline, no
 * quoted price, no time-derived field. What the caller authorised is what goes on chain, the
 * same rule a wallet follows when it lets a stale transaction die rather than quietly
 * rewriting it. A replay that arrives after its deadline reverts, and the chain failing it is
 * a better bound than any attempt counter: `TaskMarketForwarder.relay` enforces the relay
 * `validBefore`, and a user-signed authorisation carries its own expiry inside the payload.
 * The cost is that a withdrawal whose broadcast was lost and whose authorisation has since
 * expired must be re-signed -- no funds move, nothing is lost but a round trip.
 *
 * The relay envelope is ours rather than the caller's, and is held to the same rule for a
 * different reason: it is fixed when the intent is recorded and replayed from the row, because
 * a regenerated one would hand every attempt a fresh five-minute window and the deadline would
 * never arrive at all -- unbounded retry wearing a deadline as a disguise.
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
    const pending = await listUnbroadcastIntents({
      cutoff,
      db: database,
      limit: MAX_INTENTS_PER_PASS,
    });

    for (const intent of pending) {
      // Classification, claiming and the terminal-vs-retry decision all live in the shared
      // dispatch path, so an intent behaves identically whether a request or this worker sent
      // it. It never throws.
      await dispatchRelayedIntent({ db: database, intent });
    }

    // The far end of `recorded`: an intent that is out of rebroadcast attempts, or whose
    // operation has no way to be sent at all. Retrying is over, so a payment it carries is
    // finally refundable. Settlement makes that call, not this worker -- the worker only says
    // when to look (ADR-0048).
    await settleAbandonedIntents(MAX_INTENTS_PER_PASS);

    // The intents the sweep above deliberately skips: those carrying a linked outbox row, whose
    // send never returned a hash and whose nonce the reconciler later found spent by something
    // it could not name (ADR-0069). Neither refundable nor completable from a hash, they are
    // resolved by asking the chain whether the intent's own one-shot receipt was consumed
    // (ADR-0071). Separate from the sweep above for the same reason the reservation sweep is:
    // same kind of work, different evidence.
    await settleStrandedIntents(MAX_INTENTS_PER_PASS);

    // Reservations that were claimed and never filled (ADR-0067). Runs on the same pass because
    // it is the same kind of work -- retiring an intent nothing is going to finish -- but it is
    // a separate sweep because the evidence it needs is different: an abandoned intent is
    // decided from its own retry budget, while a reservation cannot be retired until the token
    // contract has said no payment landed against it.
    await expireStaleReservations(MAX_INTENTS_PER_PASS);

    // The far end of a refund, and the mirror of the sweep above: a refund transfer whose
    // receipt was slow left its ledger row in `refunding`, and nothing used to move it on
    // (ADR-0069). Here rather than in the reconciler because a refund transfer has no intent
    // for the reconciler's settlement callbacks to resolve; the outbox row it does have is
    // exactly what this reads.
    try {
      await settlePendingOrphanedRefunds(database);
    } catch (error) {
      // Ledger bookkeeping must not take down the intent passes above it.
      logger.error('Settling pending orphaned refunds failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    // What none of the sweeps above could move on (ADR-0053). Counted here, at the end of the
    // pass, for two reasons. It is the honest number -- rows that survived everything that just
    // tried to resolve them, rather than a queue depth measured before the queue was worked --
    // and it puts the one query behind `/api/health`'s stale-intent count on this interval
    // instead of on inbound request volume. Health is public, unauthenticated and polled
    // continuously; a query per request there is an amplification aimed at the endpoint that
    // most needs to keep answering when the service is struggling.
    try {
      publishStaleIntentSnapshot({
        measuredAt: new Date(now()),
        staleNonTerminal: await countStaleNonTerminalIntents({ db: database }),
      });
    } catch (error) {
      // A count is the least important thing this pass does. Failing to compute it leaves the
      // previous snapshot published rather than clearing it, so health keeps reporting the last
      // answer alongside the `measuredAt` that shows it going stale -- which is more useful to a
      // reader than the field vanishing and reappearing.
      logger.warn('Counting stale relayed intents failed', {
        error: error instanceof Error ? error.message : String(error),
      });
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

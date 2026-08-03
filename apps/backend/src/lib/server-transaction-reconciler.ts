// Implements: ADR-0040
// Implements: ADR-0045
import type { Hex } from 'viem';
import { logger } from './logger';
import type { ServerTransactionStore } from './server-transaction-store';

/**
 * What the reconciler does with an intent once the chain has answered (ADR-0045).
 *
 * Injected rather than imported so the reconciler stays free of the database and the payment
 * layer, and so these branches are directly testable without either.
 */
export type RelayedIntentSettlement = {
  /** Transaction succeeded: run the intent's completion handler. */
  onConfirmed: (transactionId: string, hash: Hex) => Promise<void>;
  /**
   * The chain confirmed the work did not happen -- a reverted receipt, or a replacement that
   * mined in its place. This is the only path that may refund.
   */
  onFailed: (transactionId: string, reason: string) => Promise<void>;
};

export type ServerTransactionReconcilerOptions = {
  /** Resolves to the receipt status, or null when the transaction is still unmined. */
  getReceiptStatus: (hash: Hex) => Promise<'success' | 'reverted' | null>;
  /** Optional: absent in contexts with no intent layer, e.g. focused unit tests. */
  intents?: RelayedIntentSettlement;
  /**
   * Broadcast a no-op self-transfer at the given nonce with escalated gas, to clear a nonce
   * that is blocking every higher nonce behind it.
   */
  sendReplacement: (nonce: number) => Promise<Hex>;
  store: ServerTransactionStore;
  /** How long a transaction may sit unmined before it is replaced. */
  stuckAfterMs?: number;
};

export const DEFAULT_STUCK_AFTER_MS = 90_000;
export const DEFAULT_RECONCILE_INTERVAL_MS = 15_000;
const MAX_ROWS_PER_PASS = 25;

/**
 * Advance server-wallet transactions that outlived the request that created them.
 *
 * This is what lets the dispatcher hand an unconfirmed transaction back to its caller instead
 * of blocking on it. Two jobs:
 *
 *   - Settle 'broadcast' rows whose receipt has since landed.
 *   - Replace a 'broadcast' row still unmined past the stuck threshold, and fill a 'reserved'
 *     row abandoned by a process that died between allocating and broadcasting. Either would
 *     otherwise hold up every higher nonce indefinitely, which is the failure mode from
 *     issue #54 -- with the difference that recovery no longer needs an operator restart.
 */
export function createServerTransactionReconciler(options: ServerTransactionReconcilerOptions) {
  const stuckAfterMs = options.stuckAfterMs ?? DEFAULT_STUCK_AFTER_MS;
  const { getReceiptStatus, intents, sendReplacement, store } = options;

  async function settleIntent(
    outcome: 'confirmed' | 'failed',
    transactionId: string,
    hash: Hex | null,
    reason: string
  ): Promise<void> {
    if (!intents) return;
    try {
      if (outcome === 'confirmed' && hash) {
        await intents.onConfirmed(transactionId, hash);
      } else if (outcome === 'failed') {
        await intents.onFailed(transactionId, reason);
      }
    } catch (error) {
      // Never let intent settlement break nonce hygiene -- a failure here is retried on the
      // next pass, whereas an exception escaping would abandon the rest of the queue.
      logger.error('Relayed intent settlement failed during reconciliation', {
        error: error instanceof Error ? error.message : String(error),
        outcome,
        transactionId,
      });
    }
  }

  async function replaceStuckNonce(id: string, nonce: number): Promise<void> {
    try {
      const hash = await sendReplacement(nonce);
      // The replacement occupies the nonce, so the original can never be mined. That is the
      // second form of confirmed evidence that the work did not happen (ADR-0045).
      await settleIntent('failed', id, null, `superseded by replacement at nonce ${nonce}`);
      logger.warn('Replaced stuck server wallet transaction', {
        nonce,
        replacementHash: hash,
        transactionId: id,
      });
      await store.recordReplacement(id, hash);
    } catch (error) {
      // A replacement rejected because the original already landed is the good case: the next
      // pass reads the receipt and settles the row normally.
      logger.warn('Server wallet replacement transaction failed', {
        error: error instanceof Error ? error.message : String(error),
        nonce,
        transactionId: id,
      });
    }
  }

  return async function reconcileOnce(now: Date = new Date()): Promise<void> {
    const stuckBefore = new Date(now.getTime() - stuckAfterMs);

    // Clear blocking nonces before anything else. Replacing a higher nonce while a lower one is
    // missing produces a transaction that also cannot mine, so a pass that starts at the top of
    // the queue would burn gas on replacements forever without unblocking anything.
    for (const row of await store.listBlockingRecycled(stuckBefore, MAX_ROWS_PER_PASS)) {
      await replaceStuckNonce(row.id, row.nonce);
    }

    for (const row of await store.listAbandonedReservations(stuckBefore, MAX_ROWS_PER_PASS)) {
      await replaceStuckNonce(row.id, row.nonce);
    }

    for (const row of await store.listBroadcast(MAX_ROWS_PER_PASS)) {
      if (!row.txHash) continue;

      let status: 'success' | 'reverted' | null;
      try {
        status = await getReceiptStatus(row.txHash as Hex);
      } catch (error) {
        logger.warn('Server wallet receipt lookup failed', {
          error: error instanceof Error ? error.message : String(error),
          transactionId: row.id,
        });
        continue;
      }

      if (status === 'success') {
        await store.setStatus(row.id, 'confirmed', { hash: row.txHash });
        // Confirmed on chain: the work really happened, so finish whatever it was for. This
        // is what makes a late receipt still produce its task row and notifications instead
        // of vanishing with the request that started it (ADR-0045).
        await settleIntent('confirmed', row.id, row.txHash as Hex, '');
        continue;
      }
      if (status === 'reverted') {
        // The nonce is spent on chain, so the row is terminal and creates no gap. This is one
        // of only two outcomes that count as evidence the work did not happen, and therefore
        // one of only two that may trigger a refund.
        await store.setStatus(row.id, 'failed', { hash: row.txHash });
        await settleIntent('failed', row.id, null, 'transaction reverted on chain');
        continue;
      }

      if (row.broadcastAt && row.broadcastAt < stuckBefore) {
        await replaceStuckNonce(row.id, row.nonce);
      }
    }
  };
}

export function startServerTransactionReconciler(
  reconcileOnce: (now?: Date) => Promise<void>,
  intervalMs: number = DEFAULT_RECONCILE_INTERVAL_MS
): NodeJS.Timeout {
  const timer = setInterval(() => {
    void reconcileOnce().catch((error) => {
      logger.error('Server wallet transaction reconciler pass failed', error);
    });
  }, intervalMs);
  timer.unref?.();
  return timer;
}

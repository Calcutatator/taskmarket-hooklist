// Implements: ADR-0040
import type { Hex } from 'viem';
import { logger } from './logger';
import type { ServerTransactionStore } from './server-transaction-store';

export type ServerTransactionReconcilerOptions = {
  /** Resolves to the receipt status, or null when the transaction is still unmined. */
  getReceiptStatus: (hash: Hex) => Promise<'success' | 'reverted' | null>;
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
  const { getReceiptStatus, sendReplacement, store } = options;

  async function replaceStuckNonce(id: string, nonce: number): Promise<void> {
    try {
      const hash = await sendReplacement(nonce);
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
        continue;
      }
      if (status === 'reverted') {
        // The nonce is spent on chain, so the row is terminal and creates no gap.
        await store.setStatus(row.id, 'failed', { hash: row.txHash });
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

// Implements: ADR-0040
import type { Hex } from 'viem';
import { logger } from './logger';
import type { ServerTransactionStore } from './server-transaction-store';

export type ServerTransactionReconcilerOptions = {
  /**
   * The wallet's transaction count at the `latest` block -- the number of nonces the chain has
   * already consumed. A row whose nonce is below this has had its nonce spent by something.
   */
  getLatestNonceCount: () => Promise<number>;
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
 *   - End a 'broadcast' row whose nonce was spent by a transaction sent from outside this
 *     backend, which no replacement can ever clear (see settleNonceSpentElsewhere).
 */
export function createServerTransactionReconciler(options: ServerTransactionReconcilerOptions) {
  const stuckAfterMs = options.stuckAfterMs ?? DEFAULT_STUCK_AFTER_MS;
  const { getLatestNonceCount, getReceiptStatus, sendReplacement, store } = options;

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
      // A rejection here means the nonce is no longer replaceable, usually because something
      // already occupied it. That is only self-healing when the occupant was our own
      // transaction, in which case the next pass reads its receipt and settles the row. When a
      // transaction sent from outside this backend took the nonce, no receipt for our hash will
      // ever appear -- settleNonceSpentElsewhere below is what ends that row, not this catch.
      logger.warn('Server wallet replacement transaction failed', {
        error: error instanceof Error ? error.message : String(error),
        nonce,
        transactionId: id,
      });
    }
  }

  /**
   * End a row whose nonce was consumed by a transaction this backend did not send.
   *
   * The dispatcher assumes it is the only writer for the server wallet, but a deploy or an
   * operator script run with the same key breaks that assumption: the foreign transaction mines
   * at a nonce the allocator had already issued, our transaction at that nonce is dropped, and
   * no receipt for its hash will ever exist. Before this check the row sat in 'broadcast'
   * forever, re-sending a replacement every pass that the provider rejects as 'nonce too low'.
   *
   * The evidence is the chain's `latest` transaction count having passed the row's nonce while
   * the row's own hash still has no receipt. The count alone is NOT sufficient: our own
   * transaction mining advances the count too, so acting on the count by itself would mark
   * successful transactions failed. The receipt has to be the tiebreaker.
   *
   * That leaves a read ordering concern. A load-balanced RPC endpoint can serve the count from
   * a node ahead of the one that serves the receipt, so a transaction that genuinely mined can
   * briefly present as "count advanced, receipt missing". Two things make that safe here:
   * the receipt is re-read AFTER the count is observed (so the second read is never the older
   * view of the pair we reason about), and the whole branch only runs once the row is past the
   * stuck threshold -- 90s by default, orders of magnitude beyond replica lag. A row that
   * survives both is one the chain has moved past and that has had no receipt for a minute and
   * a half; treating it as terminal is correct, and the nonce is already spent, so ending it
   * creates no gap for the allocator to fill.
   *
   * Returns true when the row was settled and needs no replacement.
   */
  async function settleNonceSpentElsewhere(row: {
    id: string;
    nonce: number;
    txHash: string | null;
  }): Promise<boolean> {
    if (!row.txHash) return false;

    let latestNonceCount: number;
    try {
      latestNonceCount = await getLatestNonceCount();
    } catch (error) {
      // No evidence either way, so fall through to the existing replacement path.
      logger.warn('Server wallet nonce count lookup failed', {
        error: error instanceof Error ? error.message : String(error),
        transactionId: row.id,
      });
      return false;
    }

    // The count is the number of nonces consumed, so nonce N is spent once the count exceeds N.
    if (latestNonceCount <= row.nonce) return false;

    let recheck: 'success' | 'reverted' | null;
    try {
      recheck = await getReceiptStatus(row.txHash as Hex);
    } catch {
      return false;
    }

    if (recheck === 'success') {
      await store.setStatus(row.id, 'confirmed', { hash: row.txHash });
      return true;
    }
    if (recheck === 'reverted') {
      await store.setStatus(row.id, 'failed', { hash: row.txHash });
      return true;
    }

    logger.error('Server wallet nonce was spent by a transaction from outside this backend', {
      latestNonceCount,
      nonce: row.nonce,
      transactionId: row.id,
      txHash: row.txHash,
    });
    await store.setStatus(row.id, 'failed', {
      error: new Error(
        `nonce ${row.nonce} was consumed by a transaction this backend did not send ` +
          `(chain nonce count ${latestNonceCount}); this transaction can never mine`
      ),
    });
    return true;
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

      if (!row.broadcastAt || row.broadcastAt >= stuckBefore) continue;

      if (await settleNonceSpentElsewhere(row)) continue;

      await replaceStuckNonce(row.id, row.nonce);
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

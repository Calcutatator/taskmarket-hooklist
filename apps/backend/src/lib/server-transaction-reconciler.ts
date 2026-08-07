// Implements: ADR-0040
// Implements: ADR-0045
// Implements: ADR-0051
// Implements: ADR-0053
// Implements: ADR-0066
import type { Hex } from 'viem';
import { logger } from './logger';
import { nonceWasConsumed } from './server-transaction-dispatcher';
import type { GasFees, ServerTransactionStore } from './server-transaction-store';

/**
 * What `replacedTxHash` records when the row it replaced had never broadcast anything.
 *
 * A reservation whose nonce is filled by a replacement is the same fact as a mined replacement
 * over a real transaction -- the nonce is spent by something that did none of the intent's work
 * -- but there is no superseded hash to name. A non-hash marker says so, so the settlement
 * branch that reads "this row is no longer carrying the work" fires for both, and the branch
 * that re-reads a superseded receipt (which needs a real hash) does not (ADR-0069).
 */
export const UNBROADCAST_SUPERSEDED = 'unbroadcast';

function isTransactionHash(value: string | null | undefined): value is string {
  return typeof value === 'string' && /^0x[0-9a-fA-F]{64}$/.test(value);
}

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
  /**
   * Complete any intent whose transaction is already `confirmed` while the intent itself is
   * not finished.
   *
   * The passes above only ever see rows still in `broadcast`, so a transaction confirmed
   * inside its own dispatch -- the common case, since the dispatcher awaits the receipt --
   * never reaches them. Without this sweep a caller that forgets to run the completion itself
   * strands its intent permanently and silently; with it, the worst case is completed late.
   */
  sweepConfirmed?: (limit: number) => Promise<void>;
};

// Implements: ADR-0051
export type ReplacementRequest = {
  nonce: number;
  /** What this nonce's transaction was first broadcast with. The cap is a multiple of it. */
  originalFees: GasFees | null;
  /** What the most recent attempt paid. Null on the first replacement of a nonce. */
  previousFees: GasFees | null;
};

export type ReplacementBroadcast = {
  /**
   * True when what went out was the clearing self-transfer rather than a further escalation
   * (ADR-0066): escalation had reached the cap, so this transaction is priced above it and is
   * the last one this nonce gets. Decided where the fee is priced, since only the pricing
   * policy knows the curve has ended.
   */
  clearing?: boolean;
  fees: GasFees;
  hash: Hex;
};

export type ServerTransactionReconcilerOptions = {
  /**
   * The wallet's transaction count at the `latest` block -- the number of nonces the chain has
   * already consumed. A row whose nonce is below this has had its nonce spent by something.
   *
   * Optional, and absence is treated exactly as a failed read: no evidence either way, so the
   * foreign-spend check stands down and the ordinary replacement path runs. A caller that omits
   * it loses that recovery, never correctness -- which is what lets a test exercising some other
   * branch leave it out rather than stub a number it does not care about.
   */
  getLatestNonceCount?: () => Promise<number>;
  /** Resolves to the receipt status, or null when the transaction is still unmined. */
  getReceiptStatus: (hash: Hex) => Promise<'success' | 'reverted' | null>;
  /** Optional: absent in contexts with no intent layer, e.g. focused unit tests. */
  intents?: RelayedIntentSettlement;
  /**
   * Broadcast a no-op self-transfer at the given nonce with escalated gas, to clear a nonce
   * that is blocking every higher nonce behind it.
   *
   * The fee history travels with the request rather than being re-derived from the oracle:
   * escalation multiplies the fee being replaced, and multiplying a fresh oracle reading
   * instead is what produced a second replacement priced identically to the first, which the
   * network rejects as an insufficient bump (ADR-0051). The fee actually used comes back so it
   * can be persisted for the attempt after this one.
   */
  sendReplacement: (request: ReplacementRequest) => Promise<ReplacementBroadcast>;
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
  const { getLatestNonceCount, getReceiptStatus, intents, sendReplacement, store } = options;

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

  async function replaceStuckNonce(row: {
    clearingTxHash?: string | null;
    id: string;
    lastFees: GasFees | null;
    nonce: number;
    replacedTxHash?: string | null;
    txHash?: string | null;
    originalFees: GasFees | null;
  }): Promise<void> {
    const { id, nonce } = row;
    // One clearing transfer per stuck nonce, not one per pass (ADR-0066). Escalation has
    // already stopped at the cap and the nonce has already been freed by a transaction priced
    // above it; sending another would spend above the operator's ceiling on every pass, which
    // is the unbounded climb this decision replaced. The row is now waiting for that
    // transfer's receipt, and settles as failed through the ordinary mined-replacement rule.
    if (row.clearingTxHash) {
      logger.warn('Skipping replacement: this nonce has already been cleared', {
        clearingHash: row.clearingTxHash,
        nonce,
        transactionId: id,
      });
      return;
    }
    try {
      const { clearing, fees, hash } = await sendReplacement({
        nonce,
        originalFees: row.originalFees,
        previousFees: row.lastFees,
      });
      // Durable first: `recordReplacement` puts the row back in `broadcast` under the new hash,
      // which is what makes the next pass read the replacement's receipt rather than the
      // original's. A process that dies before this write leaves the row pointing at a
      // transaction that can no longer mine and no record that anything replaced it.
      //
      // The superseded hash is recorded with it. Once written, *any* process -- including one
      // that started after this replacement went out -- can tell that a receipt against this
      // row belongs to a no-op self-transfer rather than the work. The first replacement's
      // predecessor is the original; a later one keeps pointing at that same original, since
      // what matters downstream is that the row is no longer carrying the work, not which of
      // several replacements last held the nonce.
      await store.recordReplacement(id, hash, {
        clearing,
        fees,
        replacedTxHash: row.replacedTxHash ?? row.txHash ?? UNBROADCAST_SUPERSEDED,
      });
      // Deliberately no settlement here. A *broadcast* replacement is not evidence of anything:
      // it can be dropped in turn, and the original then mines after all. Only a mined
      // replacement occupies the nonce, and only that is the second form of confirmed evidence
      // ADR-0045 admits -- so the intent is settled on the pass that reads this hash's receipt.
      logger.warn('Replaced stuck server wallet transaction', {
        // Named in the log line as well as the outbox row: a clearing transfer is above the
        // configured cap and is the last thing this nonce gets, which log analysis reading
        // replacement volume must not count as ordinary escalation (ADR-0066).
        clearing: clearing === true,
        maxFeePerGas: fees.maxFeePerGas.toString(),
        maxPriorityFeePerGas: fees.maxPriorityFeePerGas.toString(),
        nonce,
        replacementHash: hash,
        transactionId: id,
      });
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

      // ...but only when there is an original to read a receipt for. A row with no hash is one
      // whose send never returned an answer, or that died before sending at all; if the chain
      // now says its nonce is spent, then something we cannot name occupies it, no receipt will
      // ever arrive, and replacing it again on every pass forever accomplishes nothing. Make it
      // terminal -- the nonce is genuinely spent, so this leaves no gap -- and say so once,
      // loudly. The intent under it stays non-terminal on purpose: it is not refundable, since
      // the transaction that spent this nonce may well have been its own (ADR-0069).
      if (!row.txHash && nonceWasConsumed(error)) {
        await store.setStatus(id, 'failed', { error });
        logger.error('A server wallet nonce is spent by an unidentifiable transaction', {
          error: error instanceof Error ? error.message : String(error),
          nonce,
          transactionId: id,
        });
      }
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

    if (!getLatestNonceCount) return false;

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

    // Each terminal branch below settles the intent under the row as well as the row itself.
    // ADR-0063 introduced this function against a backend that had no intents, where setting
    // the outbox row was the whole job. Here it is not: an outbox row that ends without its
    // intent ending leaves a paid caller with a write that never completes and never refunds.
    if (recheck === 'success') {
      await store.setStatus(row.id, 'confirmed', { hash: row.txHash });
      await settleIntent('confirmed', row.id, row.txHash as Hex, '');
      return true;
    }
    if (recheck === 'reverted') {
      await store.setStatus(row.id, 'failed', { hash: row.txHash });
      await settleIntent('failed', row.id, null, 'transaction reverted on chain');
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
    // Refundable, unlike the no-hash case ADR-0069 deliberately leaves open. That one is
    // guarded by `!row.txHash`, where the nonce's occupant may have been the intent's own
    // transaction, so refunding could pay for work that landed. This branch returns early
    // unless a hash exists, and the finding is that *our* transaction was dropped and can
    // never mine -- positive evidence the work did not happen, which is the standard
    // ADR-0045 sets for a refund.
    //
    // SINGLE-INSTANCE ASSUMPTION (ADR-0072). "Foreign" here means "not sent by this backend",
    // and that is only the same as "not this intent's work" while one instance broadcasts for
    // this wallet. Run a second, and it could broadcast this very intent at this very nonce
    // under a different hash -- which this branch would read as a foreign spend and refund,
    // paying back work that landed. Before the backend is ever scaled past one broadcasting
    // replica, this branch has to stop refunding on its own authority.
    await settleIntent(
      'failed',
      row.id,
      null,
      'the nonce this transaction held was consumed by a transaction sent from outside this backend, so it can never mine'
    );
    return true;
  }

  return async function reconcileOnce(now: Date = new Date()): Promise<void> {
    const stuckBefore = new Date(now.getTime() - stuckAfterMs);

    // Clear blocking nonces before anything else. Replacing a higher nonce while a lower one is
    // missing produces a transaction that also cannot mine, so a pass that starts at the top of
    // the queue would burn gas on replacements forever without unblocking anything.
    for (const row of await store.listBlockingRecycled(stuckBefore, MAX_ROWS_PER_PASS)) {
      await replaceStuckNonce(row);
    }

    for (const row of await store.listAbandonedReservations(stuckBefore, MAX_ROWS_PER_PASS)) {
      await replaceStuckNonce(row);
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

      // The replacement has not answered, and it may never: if the original mined after we
      // broadcast the replacement, the replacement is nonce-too-low forever and its receipt is
      // null on every pass from here. The hash it superseded is the only remaining place the
      // chain's answer can be read, and before this nothing read it -- the row escalated to the
      // cap, sent its one clearing transfer, and then sat in `broadcast` permanently while the
      // intent under it stayed invisible to every query there is (ADR-0069).
      //
      // Deliberately no new settlement path: a mined original is an ordinary confirmed
      // transaction and settles through the ordinary confirmed branch, with the row's hash put
      // back to the one that actually mined so the hash join in `listConfirmedUnsettledIntents`
      // lines up again.
      if (status === null && isTransactionHash(row.replacedTxHash)) {
        let supersededStatus: 'success' | 'reverted' | null = null;
        try {
          supersededStatus = await getReceiptStatus(row.replacedTxHash as Hex);
        } catch (error) {
          logger.warn('Superseded transaction receipt lookup failed', {
            error: error instanceof Error ? error.message : String(error),
            transactionId: row.id,
          });
        }

        if (supersededStatus === 'success' || supersededStatus === 'reverted') {
          logger.warn('The transaction a replacement superseded mined after all', {
            nonce: row.nonce,
            receiptStatus: supersededStatus,
            replacementHash: row.txHash,
            supersededHash: row.replacedTxHash,
            transactionId: row.id,
          });
          await store.setStatus(row.id, supersededStatus === 'success' ? 'confirmed' : 'failed', {
            hash: row.replacedTxHash,
          });
          if (supersededStatus === 'success') {
            await settleIntent('confirmed', row.id, row.replacedTxHash as Hex, '');
          } else {
            await settleIntent('failed', row.id, null, 'transaction reverted on chain');
          }
          continue;
        }
      }

      if (status === 'success' || status === 'reverted') {
        // This row's hash is a replacement we sent, and the chain has now answered for it. The
        // nonce is spent by a transaction that did none of the intent's work, so the original
        // can never mine: this, and not the moment we broadcast it, is the confirmed evidence
        // ADR-0045 requires before an intent may be failed and its payment refunded. A reverted
        // replacement spends the nonce just as thoroughly, so both verdicts settle the same way.
        //
        // Read from the row, not from process memory: a deploy or a restart between
        // broadcasting the replacement and reading its receipt used to lose the association
        // entirely, leaving the intent non-terminal with nothing able to recover it.
        if (row.replacedTxHash) {
          await store.setStatus(row.id, status === 'success' ? 'confirmed' : 'failed', {
            hash: row.txHash,
          });
          await settleIntent(
            'failed',
            row.id,
            null,
            `superseded by replacement ${row.txHash} mined at nonce ${row.nonce}`
          );
          continue;
        }
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

      if (!row.broadcastAt || row.broadcastAt >= stuckBefore) continue;

      // Before spending effort on a replacement: a nonce consumed by a transaction this
      // backend never sent can never be cleared by replacing ours, so that row is settled
      // here instead (ADR-0063).
      if (await settleNonceSpentElsewhere(row)) continue;

      await replaceStuckNonce(row);
    }

    // Safety net for intents whose transaction confirmed without anyone completing them. Last,
    // and never allowed to throw, for the same reason as settleIntent: nonce hygiene above must
    // not be held hostage to the intent layer.
    if (intents?.sweepConfirmed) {
      try {
        await intents.sweepConfirmed(MAX_ROWS_PER_PASS);
      } catch (error) {
        logger.error('Confirmed-intent sweep failed during reconciliation', {
          error: error instanceof Error ? error.message : String(error),
        });
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

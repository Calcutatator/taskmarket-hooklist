// Implements: ADR-0040
import type { Hex } from 'viem';
import type { GasFees, ServerTransactionStore } from './server-transaction-store';

export type ServerTransactionRequest<Receipt> = {
  /** Human-readable operation label recorded on the outbox row for operators. */
  context?: string;
  /**
   * The gas this transaction is being broadcast with, recorded on the outbox row.
   *
   * Optional only because a caller that omits it still gets a correct transaction -- but the
   * reconciler then has no original fee to cap escalation against and falls back to the oracle,
   * so production callers should pass it (ADR-0051).
   */
  fees?: GasFees;
  /**
   * Called with the outbox row id the moment a nonce is allocated, before anything is sent.
   *
   * This is what makes "no outbox id and no hash means nothing was sent" a fact rather than an
   * approximation (ADR-0069). Linking at send-success instead left exactly one gap, and it was
   * the expensive one: a send whose answer never arrived produced no id, no hash, and an intent
   * every sweep read as never-broadcast -- so it was refunded while its transaction mined.
   *
   * Must not throw meaningfully: a failure here is logged and the send proceeds, because the
   * alternative is refusing to broadcast work that has already been paid for.
   */
  onNonceAllocated?: (transactionId: string) => Promise<void>;
  /**
   * Called when the nonce is returned to the pool, and only then.
   *
   * The exact inverse of `onNonceAllocated`, and it runs only on the branch that has positive
   * evidence the nonce was never spent. Anything less certain keeps the link, because keeping
   * it is what stops a refund.
   */
  onNonceReleased?: () => Promise<void>;
  simulate: () => Promise<unknown>;
  send: (nonce: number) => Promise<Hex>;
  confirm: (hash: Hex) => Promise<Receipt>;
  /**
   * Whether the receipt `confirm` returned says the transaction succeeded.
   *
   * Required, not optional, and that is the whole point. The dispatcher cannot read a generic
   * receipt itself, so before this existed it wrote `confirmed` for every receipt it saw --
   * including a reverted one -- and left the caller to notice. Every caller did notice, and
   * every caller then threw, which is why this looked harmless: the outbox row said the
   * transaction succeeded while the request failed, and the intent underneath it was never
   * settled or refunded (ADR-0073).
   *
   * Making it a required field is what stops the next write from reintroducing that: a new
   * dispatch site cannot compile without answering the question.
   */
  succeeded: (receipt: Receipt) => boolean;
};

export type ServerTransactionResult<Receipt> = {
  hash: Hex;
  receipt: Receipt;
};

export type ServerTransactionDispatcherOptions = {
  /** Reads the chain's pending transaction count. Seeds and resyncs the allocator only. */
  getPendingNonce: () => Promise<number>;
  store: ServerTransactionStore;
};

/**
 * Thrown when a transaction was broadcast but no receipt arrived within the caller's budget.
 * The transaction is still live and owned by the reconciler -- callers must treat this as
 * "in flight", never as "failed", and must not resubmit the same intent.
 */
export class ServerTransactionPendingError extends Error {
  readonly hash: Hex;
  readonly nonce: number;

  constructor(hash: Hex, nonce: number) {
    super(
      `Server wallet transaction ${hash} (nonce ${nonce}) was broadcast but not confirmed within the request budget; it remains in flight`
    );
    this.name = 'ServerTransactionPendingError';
    this.hash = hash;
    this.nonce = nonce;
  }
}

/**
 * Failures that prove the nonce is already spent or already sitting in the mempool.
 *
 * A `true` here is positive evidence, and it is the only thing this answers. A `false` is *not*
 * the opposite: it says only that this particular error is not one of the recognised proofs, so
 * the caller still has to establish that the nonce is free before returning it to the pool
 * (ADR-0069). Reading a `false` as "never sent" is what refunded work that had landed.
 */
export function nonceWasConsumed(error: unknown): boolean {
  const message =
    error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return (
    message.includes('nonce too low') ||
    message.includes('nonce is too low') ||
    message.includes('already known') ||
    message.includes('already imported') ||
    message.includes('replacement transaction underpriced')
  );
}

/**
 * Whether the chain still shows this nonce as unspent and not sitting in a mempool.
 *
 * `eth_getTransactionCount(pending)` is the next nonce the node would hand out accounting for
 * what it already holds, so a count at or below ours means nothing occupies our nonce. A count
 * past it means something does -- mined or pending, and we cannot tell which, which is precisely
 * why the nonce may not be reused.
 *
 * An unanswered read is not a "yes". It returns false, and the caller keeps the nonce reserved,
 * for the same reason the reservation sweep leaves a row alone when the token contract does not
 * answer: the cost of being wrong is asymmetric.
 */
async function nonceIsUnused(
  getPendingNonce: () => Promise<number>,
  nonce: number
): Promise<boolean> {
  try {
    return (await getPendingNonce()) <= nonce;
  } catch {
    return false;
  }
}

/**
 * Dispatch server-wallet transactions with the nonce allocator in Postgres rather than in
 * process memory.
 *
 * The ordering of the three phases is the whole point:
 *   1. simulate() runs before any nonce exists, so a deterministic revert costs nothing. This
 *      is the direct fix for issue #54, where a failed gas estimate advanced viem's cached
 *      nonce and every later transaction queued behind the resulting gap.
 *   2. Nonce allocation is one short database transaction holding only row locks. No RPC call
 *      happens inside it, so a connection is never held across network latency.
 *   3. Broadcast and confirmation run entirely outside the database. Concurrent transactions
 *      may be in flight at different nonces; throughput is not serialized.
 *
 * A send that *provably* never reached the mempool returns its nonce to the pool so the next
 * allocation reuses it instead of leaving a permanent gap. Provably is the whole word: an
 * unrecognised send error is not evidence either way, and a nonce recycled on one is a nonce
 * that may already be carrying a live transaction (ADR-0069).
 */
export function createServerTransactionDispatcher(options: ServerTransactionDispatcherOptions) {
  const { getPendingNonce, store } = options;

  return async function dispatch<Receipt>(
    request: ServerTransactionRequest<Receipt>
  ): Promise<ServerTransactionResult<Receipt>> {
    // Phase 1: no nonce exists yet, so a deterministic revert here is free.
    await request.simulate();

    // Phase 2: short transaction, row locks only, zero RPC calls inside.
    await store.seed(getPendingNonce);
    const { id, nonce } = await store.allocate(request.context);

    // Before the send, never after. See `onNonceAllocated`.
    if (request.onNonceAllocated) {
      try {
        await request.onNonceAllocated(id);
      } catch (error) {
        // console.error rather than lib/logger for the same reason as orphaned-payments.ts:
        // the logger reads validated server config at import time, and this module is imported
        // by every path that touches the chain.
        console.error(
          `Linking server wallet transaction ${id} (nonce ${nonce}) to its caller failed: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    }

    // Phase 3: everything below runs with no database transaction open.
    let hash: Hex;
    try {
      hash = await request.send(nonce);
    } catch (error) {
      if (nonceWasConsumed(error)) {
        await store.setStatus(id, 'failed', { error });
        await store.resync(getPendingNonce);
      } else if (await nonceIsUnused(getPendingNonce, nonce)) {
        // Positive evidence: the chain's own pending count has not passed this nonce, so
        // nothing occupies it and the next allocation may have it back.
        await store.setStatus(id, 'recycled', { error });
        if (request.onNonceReleased) await request.onNonceReleased();
      } else {
        // Unknown. A send that never returned an answer is exactly the case in which the node
        // may have taken the transaction, so the nonce is not evidence of anything and must not
        // go back in the pool. The row stays `reserved` and the reconciler owns it from here
        // via `listAbandonedReservations` (ADR-0069).
        await store.setStatus(id, 'reserved', { error });
      }
      throw error;
    }

    // The fee is recorded with the hash: it is the original this nonce's replacements escalate
    // from and the base of the cap they clamp to (ADR-0051).
    await store.setStatus(id, 'broadcast', { fees: request.fees, hash });

    let receipt: Receipt;
    try {
      receipt = await request.confirm(hash);
    } catch (error) {
      // The transaction is live. Leave the row 'broadcast' for the reconciler and tell the
      // caller it is pending -- never recycle a nonce that may already be in the mempool.
      await store.setStatus(id, 'broadcast', { error });
      throw new ServerTransactionPendingError(hash, nonce);
    }

    // A reverted receipt is not a confirmation. `confirmed` means the chain answered *and the
    // answer was yes* everywhere else that writes it -- the reconciler has always written
    // `failed` for `status === 'reverted'` -- and every reader depends on that reading:
    // `listConfirmedUnsettledIntents` completes the intent under a confirmed row, and
    // `settlePendingOrphanedRefunds` reads a confirmed refund transfer as money that moved.
    // This writer was the one that disagreed, and it disagreed on the branch that costs money
    // (ADR-0073).
    //
    // Terminal, with the hash, exactly as the reconciler settles the same verdict. The intent
    // under it is settled from that row by `settleFailedTransactionIntents`, which is what
    // makes the refund happen no matter which of the two writers reached the verdict first.
    if (!request.succeeded(receipt)) {
      await store.setStatus(id, 'failed', { hash });
      return { hash, receipt };
    }

    await store.setStatus(id, 'confirmed', { hash });
    return { hash, receipt };
  };
}

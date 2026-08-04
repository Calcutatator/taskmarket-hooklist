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
  simulate: () => Promise<unknown>;
  send: (nonce: number) => Promise<Hex>;
  confirm: (hash: Hex) => Promise<Receipt>;
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
 * A send failure normally means the provider rejected the transaction outright, so the nonce
 * was never consumed on chain and must return to the pool. The exceptions are failures that
 * prove the nonce is already spent or already sitting in the mempool -- reusing one of those
 * would collide with a transaction that can still be mined.
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
 * A send that provably never reached the mempool returns its nonce to the pool so the next
 * allocation reuses it instead of leaving a permanent gap.
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

    // Phase 3: everything below runs with no database transaction open.
    let hash: Hex;
    try {
      hash = await request.send(nonce);
    } catch (error) {
      if (nonceWasConsumed(error)) {
        await store.setStatus(id, 'failed', { error });
        await store.resync(getPendingNonce);
      } else {
        await store.setStatus(id, 'recycled', { error });
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

    await store.setStatus(id, 'confirmed', { hash });
    return { hash, receipt };
  };
}

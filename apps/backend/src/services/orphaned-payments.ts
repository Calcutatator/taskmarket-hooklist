// Implements: ADR-0048
// Implements: ADR-0053
import { randomUUID } from 'crypto';
import { and, eq, inArray, or } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';

import type { db as DbType } from '../db/client';
import { orphanedPayments, serverWalletTransactions } from '../db/schema';
import { contractRefundOrphanedPayment } from './contract';
import { STANDARD_X402_ACTION_AMOUNT } from '../config/payments';
import { ServerTransactionPendingError } from '../lib/server-transaction-dispatcher';
import { UndeterminedRelayError } from '../lib/relay-failure';
// Deliberately console.error, not lib/logger: logger.ts calls getServerConfig() at
// module load time, and this module is imported by every X402-gated router (tasks,
// bids, pitches, proofs, identity, ...). Pulling that in transitively broke unit
// tests for routers whose test files never needed to mock config/env before.

type Db = typeof DbType;

/**
 * What became of a refund attempt.
 *
 * `pending` is the third answer the two booleans could not express. A refund transfer whose
 * receipt did not arrive within the request budget is neither refunded nor failed: it is live,
 * it has a hash, and it will be mined or replaced by the reconciler like any other server-wallet
 * transaction. Callers that render this to a payer must not tell them the refund did not happen.
 */
export type RefundOutcome = {
  pending: boolean;
  refunded: boolean;
  refundTxHash: `0x${string}` | null;
};

/**
 * The error `handlePostPaymentFailure` throws, carrying what became of the refund.
 *
 * The outcome travels as a field rather than as prose in the message. Both settlement paths
 * used to decide whether a refund had failed with `message.includes('refunded')`, run against
 * a string that concatenates a decoded revert reason -- operator-controlled text. A revert named
 * anything like `AlreadyRefunded` would make a genuinely failed refund read as a success and log
 * nothing, and under ADR-0053 that log is the entire reporting surface (ADR-0069).
 */
export class PostPaymentFailureError extends TRPCError {
  readonly refund: RefundOutcome;

  constructor(options: { code: TRPCError['code']; message: string; refund: RefundOutcome }) {
    super({ code: options.code, message: options.message });
    this.name = 'PostPaymentFailureError';
    this.refund = options.refund;
  }
}

/** Whether an error from `handlePostPaymentFailure` left the payer's money unreturned. */
export function refundDidNotComplete(error: unknown): boolean {
  // Anything that is not this error never reached the refund at all -- a rethrown original,
  // a pending-transaction error -- so it is not a refund failure to report either.
  if (!(error instanceof PostPaymentFailureError)) return false;
  // Sent and awaiting confirmation is not a failure: the transfer exists and the reconciler
  // owns it, and `settlePendingOrphanedRefunds` finishes the ledger row.
  return !error.refund.refunded && !error.refund.pending;
}

/**
 * Attempts the actual refund transfer for an already-recorded row and updates its
 * status. Shared by the initial post-failure attempt and the standalone retry path
 * (scripts/retry-orphaned-refunds.ts) -- the two need identical success/failure
 * handling, since a retry is just this same attempt run again later, typically after
 * an operational blocker (e.g. the server wallet running out of ETH for gas -- the
 * refund transfer needs gas exactly like the failed action it's refunding) is fixed.
 *
 * Claims the row ('pending'/'failed' -> 'refunding') with a single conditional UPDATE
 * BEFORE sending any on-chain transfer. This is the only thing that prevents a
 * double-payout: retryFailedOrphanedRefunds can be invoked concurrently (two ops
 * runs, a cron overlapping a manual run), and without this guard two callers could
 * both read the same 'failed' row and both successfully send a refund transfer for
 * it. The conditional UPDATE's WHERE clause makes the claim atomic -- only one
 * concurrent caller's UPDATE actually matches the row (Postgres serializes concurrent
 * UPDATEs to the same row), so only one caller proceeds to the transfer; the other
 * sees zero rows affected and backs off without touching the chain.
 */
async function attemptRefund(
  db: Db,
  row: { id: string; payer: string; amount: string; paymentTxHash: string }
): Promise<RefundOutcome> {
  const claimed = await db
    .update(orphanedPayments)
    .set({ refundStatus: 'refunding' })
    .where(
      and(
        eq(orphanedPayments.id, row.id),
        inArray(orphanedPayments.refundStatus, ['pending', 'failed'])
      )
    )
    .returning({ id: orphanedPayments.id });

  if (claimed.length === 0) {
    // Another caller already claimed this row (or it was refunded/is being refunded
    // right now) -- do not send a second transfer.
    console.error(
      `Skipped refund for orphaned payment ${row.id} (payer ${row.payer}, tx ${row.paymentTxHash}): row was not in a claimable state, likely a concurrent retry`
    );
    return { pending: false, refunded: false, refundTxHash: null };
  }

  try {
    const refundTxHash = await contractRefundOrphanedPayment(
      row.payer as `0x${string}`,
      BigInt(row.amount)
    );
    await db
      .update(orphanedPayments)
      .set({ refundStatus: 'refunded', refundTxHash, resolvedAt: new Date() })
      .where(eq(orphanedPayments.id, row.id));
    return { pending: false, refunded: true, refundTxHash };
  } catch (error) {
    // A pending transaction is not a failed one -- the same rule handlePostPaymentFailure
    // states below, applied to the refund transfer itself. The transfer was broadcast and has
    // a hash; only its receipt was slow. Writing 'failed' here would hand the row straight
    // back to retryFailedOrphanedRefunds, which selects exactly that status, and the retry
    // would send a second plain ERC-20 transfer for the same payment -- two refunds, one
    // payment, and no on-chain idempotency to catch it.
    //
    // The row stays in 'refunding', which it already holds: no status the sweep or the claim
    // predicate looks at, no migration, and the hash is recorded so ops can see which transfer
    // it is waiting on. `resolvedAt` is deliberately left null -- nothing is resolved yet.
    if (error instanceof ServerTransactionPendingError) {
      console.error(
        `Refund for orphaned payment ${row.id} (payer ${row.payer}, tx ${row.paymentTxHash}) is in flight as ${error.hash}; left 'refunding' for the reconciler`
      );
      await db
        .update(orphanedPayments)
        .set({ refundStatus: 'refunding', refundTxHash: error.hash })
        .where(eq(orphanedPayments.id, row.id));
      return { pending: true, refunded: false, refundTxHash: error.hash };
    }

    const message = error instanceof Error ? error.message : String(error);
    console.error(
      `Refund failed for orphaned payment ${row.id} (payer ${row.payer}, tx ${row.paymentTxHash}): ${message}`
    );
    await db
      .update(orphanedPayments)
      .set({ refundStatus: 'failed', resolvedAt: new Date() })
      .where(eq(orphanedPayments.id, row.id));
    return { pending: false, refunded: false, refundTxHash: null };
  }
}

/**
 * Write a settled payment into the ledger without deciding anything about it.
 *
 * This is deliberately not `recordAndRefundOrphanedPayment`. Deciding a payment is orphaned
 * means deciding to refund it, and ADR-0048 puts that judgement in intent settlement alone --
 * which is why the three functions that make it are policed by
 * test/unit/config/orphaned-payment-decision-usage.test.ts. Recording is a different act: it
 * makes a payment that funded nothing visible and recoverable, and leaves what to do about it
 * to an operator or to a later settlement pass.
 *
 * The case it exists for: `recordRelayedIntent` finds the caller's idempotency key already
 * spoken for by an earlier intent, so the payment settled by *this* request funds nothing and
 * never will -- nothing downstream will ever attach it. Before this, that payment left no trace
 * at all: no intent, no ledger row, no log. Two concurrent requests carrying one key both clear
 * the middleware's pre-settlement check and both settle, and the loser's money simply vanished.
 *
 * The row lands as 'pending', which no sweep claims (`retryFailedOrphanedRefunds` selects
 * 'failed'), so recording never causes a transfer on its own. Never throws: the caller is
 * already reporting a failure and this must not replace it.
 */
export async function recordUnattachedPayment(input: {
  db: Db;
  payer: `0x${string}`;
  amount: bigint;
  paymentTxHash: `0x${string}`;
  context: string;
  failureReason: string;
}): Promise<void> {
  try {
    await input.db.insert(orphanedPayments).values({
      id: `orphan_${randomUUID()}`,
      payer: input.payer.toLowerCase(),
      amount: input.amount.toString(),
      paymentTxHash: input.paymentTxHash,
      context: input.context,
      failureReason: input.failureReason,
      refundStatus: 'pending',
    });
  } catch (error) {
    // Most likely the unique index on paymentTxHash: this payment is already in the ledger,
    // which is the outcome this function wanted anyway.
    console.error(
      `Failed to record unattached payment for tx ${input.paymentTxHash}: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}

/**
 * Called when an x402 payment has already settled (payer -> server wallet) but the
 * on-chain action it was paying for then failed, so nothing was ever created for it.
 * Records the orphan in `orphaned_payments` and immediately attempts to send the money
 * straight back to the payer. Never throws -- a failure here must not shadow the
 * original error the caller is already handling; the ledger row is what lets ops find
 * and manually resolve any refund that didn't go through on its own (see
 * retryFailedOrphanedRefunds below for the sweep that resolves them later).
 *
 * See the createTask payment-orphan incidents (2026-06-11, 2026-07-24): payment and the
 * on-chain create are two separate transactions (x402 settlement vs. the relayed
 * contract call), so they can't be made atomic -- this is the mitigation instead.
 */
export async function recordAndRefundOrphanedPayment(input: {
  db: Db;
  payer: `0x${string}`;
  amount: bigint;
  paymentTxHash: `0x${string}`;
  context: string;
  failureReason: string;
}): Promise<RefundOutcome> {
  const id = `orphan_${randomUUID()}`;
  const normalizedPayer = input.payer.toLowerCase();

  try {
    await input.db.insert(orphanedPayments).values({
      id,
      payer: normalizedPayer,
      amount: input.amount.toString(),
      paymentTxHash: input.paymentTxHash,
      context: input.context,
      failureReason: input.failureReason,
      refundStatus: 'pending',
    });
  } catch (error) {
    // Most likely a duplicate paymentTxHash (unique constraint) -- this payment was
    // already recorded (and possibly already refunded) by a prior attempt. Do not
    // refund twice; leave the existing row as the source of truth.
    console.error(
      `Failed to record orphaned payment for tx ${input.paymentTxHash}: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    return { pending: false, refunded: false, refundTxHash: null };
  }

  return attemptRefund(input.db, {
    id,
    payer: normalizedPayer,
    amount: input.amount.toString(),
    paymentTxHash: input.paymentTxHash,
  });
}

/**
 * Sweeps every orphaned payment still marked 'failed' (the refund transfer itself
 * didn't go through -- e.g. the server wallet was out of ETH for gas at the time,
 * the same resource the original action needed) and retries each one. Intended to be
 * run manually by ops after fixing whatever blocked the refund (see
 * scripts/retry-orphaned-refunds.ts) -- this is not wired into any request path, since
 * a payer-facing request has no reason to trigger a retry sweep of every other
 * payer's stuck refunds.
 */
export async function retryFailedOrphanedRefunds(
  db: Db
): Promise<Array<{ id: string; payer: string; refunded: boolean; refundTxHash: string | null }>> {
  const failedRows = await db
    .select({
      id: orphanedPayments.id,
      payer: orphanedPayments.payer,
      amount: orphanedPayments.amount,
      paymentTxHash: orphanedPayments.paymentTxHash,
    })
    .from(orphanedPayments)
    .where(eq(orphanedPayments.refundStatus, 'failed'));

  const results = [];
  for (const row of failedRows) {
    // Sequential, not Promise.all: each attempt sends a real on-chain transfer from
    // the same server wallet, which needs its nonces allocated in order.
    const { refunded, refundTxHash } = await attemptRefund(db, row);
    results.push({ id: row.id, payer: row.payer, refunded, refundTxHash });
  }
  return results;
}

/**
 * Settle the ledger rows whose refund transfer was still in flight when it was recorded.
 *
 * `refunding` was documented as transient and was in fact terminal: `attemptRefund` writes it
 * when the transfer comes back pending, and nothing selected it afterwards. So a refund that
 * mined stayed `refunding` forever and the ledger permanently understated money returned, while
 * a refund that was replaced and cleared (ADR-0066) left the payer's money in the server wallet
 * with the row still claiming a refund was under way -- and `intents.get` reported that to the
 * payer indefinitely (ADR-0069).
 *
 * This is the exit transition, and it asks the outbox rather than the chain. A refund transfer
 * is an ordinary server-wallet transaction: the reconciler already establishes what became of
 * every one of them, so the answer is a join, not a second receipt-watching mechanism. It lives
 * here rather than in the reconciler's intent settlement because a refund transfer has no
 * intent -- `findIntentByTransactionId` cannot reach it -- so there is nothing for that callback
 * to resolve.
 *
 * Three outcomes, and the middle one is the reason this is not just "mark them refunded":
 *
 *   - the outbox row confirmed on the transfer's own hash -- the money moved, so `refunded`;
 *   - the outbox row settled on some *other* hash, meaning this transfer was replaced or
 *     cleared -- the money did not move, so `failed`, which is the status the retry sweep
 *     selects and therefore the one that sends it again;
 *   - the transfer reverted or its nonce was recycled -- also `failed`, same reason.
 *
 * Anything still `broadcast` or `reserved` is left exactly as it is; it is in flight, which is
 * what the row already says.
 */
export async function settlePendingOrphanedRefunds(
  db: Db
): Promise<Array<{ id: string; refundStatus: 'refunded' | 'failed' }>> {
  const rows = await db
    .select({
      id: orphanedPayments.id,
      outboxStatus: serverWalletTransactions.status,
      outboxTxHash: serverWalletTransactions.txHash,
      refundTxHash: orphanedPayments.refundTxHash,
    })
    .from(orphanedPayments)
    // Matched on the superseded hash as well as the current one, because a replaced transfer is
    // precisely the case this has to get right: without the second arm the row would stop
    // matching any outbox row the moment it was replaced, and stay `refunding` forever again.
    .innerJoin(
      serverWalletTransactions,
      or(
        eq(serverWalletTransactions.txHash, orphanedPayments.refundTxHash),
        eq(serverWalletTransactions.replacedTxHash, orphanedPayments.refundTxHash)
      )
    )
    .where(eq(orphanedPayments.refundStatus, 'refunding'));

  const settled: Array<{ id: string; refundStatus: 'refunded' | 'failed' }> = [];
  for (const row of rows) {
    const stillOurTransfer =
      typeof row.outboxTxHash === 'string' &&
      typeof row.refundTxHash === 'string' &&
      row.outboxTxHash.toLowerCase() === row.refundTxHash.toLowerCase();

    let refundStatus: 'refunded' | 'failed' | null = null;
    if (row.outboxStatus === 'confirmed') {
      refundStatus = stillOurTransfer ? 'refunded' : 'failed';
    } else if (row.outboxStatus === 'failed' || row.outboxStatus === 'recycled') {
      refundStatus = 'failed';
    }
    if (!refundStatus) continue;

    if (refundStatus === 'failed') {
      console.error(
        `Refund transfer ${row.refundTxHash} for orphaned payment ${row.id} did not move the money (outbox row is ${row.outboxStatus}${stillOurTransfer ? '' : ', under a different hash'}); flagged for retry`
      );
    }

    await db
      .update(orphanedPayments)
      .set({
        refundStatus,
        // Only a refund that happened is resolved. A failed one is handed to the retry sweep,
        // and a resolved timestamp on it would be a claim that it is over.
        ...(refundStatus === 'refunded' ? { resolvedAt: new Date() } : {}),
      })
      .where(and(eq(orphanedPayments.id, row.id), eq(orphanedPayments.refundStatus, 'refunding')));
    settled.push({ id: row.id, refundStatus });
  }
  return settled;
}

/**
 * Shared catch-block handler for any X402-gated mutation: call this with the error
 * from a failed post-payment on-chain call and it records + refunds the orphaned
 * payment (if one was settled) and throws a TRPCError describing what happened,
 * including the refund outcome. Always throws -- never returns.
 *
 * `paymentTxHash` is undefined when the caller never actually settled a payment (e.g.
 * a bug upstream, or a code path reached without X402), in which case there is nothing
 * to refund and the original error is rethrown unchanged.
 */
// Implements: ADR-0045
export async function handlePostPaymentFailure(input: {
  db: Db;
  payer: `0x${string}`;
  amount: bigint;
  paymentTxHash: `0x${string}` | undefined;
  context: string;
  error: unknown;
}): Promise<never> {
  // A pending transaction is not a failed one. It was broadcast, it is recorded in the
  // outbox, and the reconciler will either see it mined or replace it -- so refunding here
  // can pay the requester back for work that then lands on chain anyway, leaving the escrow
  // funded from the server wallet. Settlement waits for confirmed evidence (ADR-0045); this
  // is the single choke point every paid path funnels through, so the rule holds everywhere.
  // The same rule for the other in-flight signal. An `UndeterminedRelayError` is a relay that
  // established no verdict at all -- no decoded revert, and where there is a hash, a failed
  // receipt a replay of the same envelope could not reproduce. Refunding on that pays the
  // requester back for work that may still land, which is exactly the confirmed-evidence rule
  // ADR-0045 states and ADR-0048 gives settlement sole authority over.
  if (
    input.error instanceof ServerTransactionPendingError ||
    input.error instanceof UndeterminedRelayError
  ) {
    throw input.error;
  }

  const failureMessage = input.error instanceof Error ? input.error.message : String(input.error);

  if (!input.paymentTxHash) {
    throw input.error;
  }

  const { pending, refunded, refundTxHash } = await recordAndRefundOrphanedPayment({
    db: input.db,
    payer: input.payer,
    amount: input.amount,
    paymentTxHash: input.paymentTxHash,
    context: input.context,
    failureReason: failureMessage,
  });

  // Three outcomes, not two: a refund still in flight has been sent and must not be described
  // as one that did not happen.
  let refundNote: string;
  if (refunded) {
    refundNote = `Your payment was automatically refunded (refund tx: ${refundTxHash}).`;
  } else if (pending) {
    refundNote = `Your refund was sent and is awaiting confirmation (refund tx: ${refundTxHash}).`;
  } else {
    refundNote =
      'Automatic refund could not be completed and has been flagged for manual review -- contact support with this attempt time and your wallet address.';
  }

  throw new PostPaymentFailureError({
    code: input.error instanceof TRPCError ? input.error.code : 'INTERNAL_SERVER_ERROR',
    message: `${failureMessage}. ${refundNote}`,
    refund: { pending, refunded, refundTxHash },
  });
}

/**
 * Convenience wrapper for the common case: a mutation that charges the flat
 * STANDARD_X402_ACTION_AMOUNT action fee (not a variable amount like task create's
 * reward or task update's reward-delta). Every X402-gated mutation except
 * tasks.create and tasks.update charges this flat fee -- see paidTaskRouteHandlers
 * and the standalone X402-gated routes in app.ts. Always throws -- never returns.
 */
export function handleStandardFeePostPaymentFailure(input: {
  db: Db;
  payer: `0x${string}`;
  paymentTxHash: `0x${string}` | undefined;
  context: string;
  error: unknown;
}): Promise<never> {
  return handlePostPaymentFailure({
    ...input,
    amount: BigInt(STANDARD_X402_ACTION_AMOUNT),
  });
}

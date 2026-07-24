import { randomUUID } from 'crypto';
import { and, eq, inArray } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';

import type { db as DbType } from '../db/client';
import { orphanedPayments } from '../db/schema';
import { contractRefundOrphanedPayment } from './contract';
import { STANDARD_X402_ACTION_AMOUNT } from '../config/payments';
// Deliberately console.error, not lib/logger: logger.ts calls getServerConfig() at
// module load time, and this module is imported by every X402-gated router (tasks,
// bids, pitches, proofs, identity, ...). Pulling that in transitively broke unit
// tests for routers whose test files never needed to mock config/env before.

type Db = typeof DbType;

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
): Promise<{ refunded: boolean; refundTxHash: `0x${string}` | null }> {
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
    return { refunded: false, refundTxHash: null };
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
    return { refunded: true, refundTxHash };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(
      `Refund failed for orphaned payment ${row.id} (payer ${row.payer}, tx ${row.paymentTxHash}): ${message}`
    );
    await db
      .update(orphanedPayments)
      .set({ refundStatus: 'failed', resolvedAt: new Date() })
      .where(eq(orphanedPayments.id, row.id));
    return { refunded: false, refundTxHash: null };
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
}): Promise<{ refunded: boolean; refundTxHash: `0x${string}` | null }> {
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
    return { refunded: false, refundTxHash: null };
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
 * Shared catch-block handler for any X402-gated mutation: call this with the error
 * from a failed post-payment on-chain call and it records + refunds the orphaned
 * payment (if one was settled) and throws a TRPCError describing what happened,
 * including the refund outcome. Always throws -- never returns.
 *
 * `paymentTxHash` is undefined when the caller never actually settled a payment (e.g.
 * a bug upstream, or a code path reached without X402), in which case there is nothing
 * to refund and the original error is rethrown unchanged.
 */
export async function handlePostPaymentFailure(input: {
  db: Db;
  payer: `0x${string}`;
  amount: bigint;
  paymentTxHash: `0x${string}` | undefined;
  context: string;
  error: unknown;
}): Promise<never> {
  const failureMessage = input.error instanceof Error ? input.error.message : String(input.error);

  if (!input.paymentTxHash) {
    throw input.error;
  }

  const { refunded, refundTxHash } = await recordAndRefundOrphanedPayment({
    db: input.db,
    payer: input.payer,
    amount: input.amount,
    paymentTxHash: input.paymentTxHash,
    context: input.context,
    failureReason: failureMessage,
  });

  const refundNote = refunded
    ? `Your payment was automatically refunded (refund tx: ${refundTxHash}).`
    : 'Automatic refund could not be completed and has been flagged for manual review -- contact support with this attempt time and your wallet address.';

  throw new TRPCError({
    code: input.error instanceof TRPCError ? input.error.code : 'INTERNAL_SERVER_ERROR',
    message: `${failureMessage}. ${refundNote}`,
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

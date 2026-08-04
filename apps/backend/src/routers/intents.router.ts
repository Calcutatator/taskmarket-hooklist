// Implements: ADR-0049, ADR-0052
import { TRPCError } from '@trpc/server';
import { eq } from 'drizzle-orm';
import { IntentStatusInputSchema, IntentStatusResponseSchema } from '@taskmarket/shared';

import { orphanedPayments, type RelayedIntent } from '../db/schema';
import { findIntentByIdempotencyKey, getRelayedIntent } from '../services/relayed-intents';
import { protectedProcedure, router } from '../trpc';
import type { Context } from '../context';

/**
 * Payer scoping (ADR-0049 point 6).
 *
 * An intent row carries a payer address, an amount and a payment hash, so reading one is
 * reading someone's payment facts. A caller who is not the payer gets exactly what a caller
 * asking about an id that does not exist gets -- the same error, with nothing in it that
 * distinguishes "not yours" from "no such thing", since telling those apart would turn this
 * into an oracle for which intent ids and idempotency keys exist.
 *
 * An intent with no payer is a free relayed write with no payment facts on it at all, and it
 * is still not public: `evaluations.finalizeVerdict` is permissionless, so there is no owner
 * to scope it to, and rather than invent one those rows are readable by nobody through this
 * surface. Operators read them from the database, which is where they were readable before.
 */
function intentVisibleTo(intent: RelayedIntent, callerAddress: string): boolean {
  if (!intent.payer) return false;
  return intent.payer.toLowerCase() === callerAddress.toLowerCase();
}

function notFound(): TRPCError {
  return new TRPCError({ code: 'NOT_FOUND', message: 'No such intent' });
}

async function refundStateFor(ctx: Context, intent: RelayedIntent) {
  if (!intent.paymentTxHash) return null;
  const [row] = await ctx.db
    .select({
      refundStatus: orphanedPayments.refundStatus,
      refundTxHash: orphanedPayments.refundTxHash,
    })
    .from(orphanedPayments)
    .where(eq(orphanedPayments.paymentTxHash, intent.paymentTxHash))
    .limit(1);
  if (!row) return null;
  return {
    status: row.refundStatus as 'pending' | 'refunding' | 'refunded' | 'failed',
    txHash: row.refundTxHash ?? null,
  };
}

export const intentsRouter = router({
  /**
   * "What happened to my write, and what happened to my money."
   *
   * The answer a caller could previously only infer -- from a task that may never appear, or
   * from watching their own wallet balance. Deliberately answerable by idempotency key as
   * well as by intent id, because the caller who most needs to ask is the one whose
   * connection dropped before the intent id ever reached them.
   */
  get: protectedProcedure
    .meta({
      openapi: {
        method: 'GET',
        path: '/intents',
        tags: ['Intents'],
        summary: 'Get the status of a relayed write you started',
      },
    })
    .input(IntentStatusInputSchema)
    .output(IntentStatusResponseSchema)
    .query(async ({ ctx, input }) => {
      const intent = input.intentId
        ? await getRelayedIntent({ db: ctx.db, intentId: input.intentId })
        : await findIntentByIdempotencyKey(ctx.db, input.idempotencyKey!);

      if (!intent || !intentVisibleTo(intent, ctx.caller.address)) throw notFound();

      return {
        intentId: intent.id,
        idempotencyKey: intent.idempotencyKey,
        operation: intent.operation,
        status: intent.status as 'recorded' | 'broadcast' | 'completed' | 'failed',
        txHash: intent.txHash ?? null,
        // `lastError` is also written on a non-terminal completion failure, where it is a
        // progress note rather than a verdict. Only a `failed` intent has a terminal reason,
        // so reporting it on any other status would tell a caller their write is dead while
        // settlement is still carrying it (ADR-0049 point 3).
        terminalReason: intent.status === 'failed' ? (intent.lastError ?? null) : null,
        refund: await refundStateFor(ctx, intent),
      };
    }),
});

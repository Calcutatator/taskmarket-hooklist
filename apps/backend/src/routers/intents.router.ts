// Implements: ADR-0049, ADR-0052
// Implements: ADR-0055
//
// The scoping rule below is ADR-0059's, which is still `Proposed`, so it cannot carry an
// implements-marker back-pointer yet -- adr-lint blocks one while an ADR is unaccepted, and an
// agent may not self-approve. It is claimed against ADR-0049 above instead, whose point 6 it
// restates and whose promise it makes true. Add ADR-0059 to that marker list when it is accepted.
import type { TRPCError } from '@trpc/server';
import { eq } from 'drizzle-orm';
import { IntentStatusInputSchema, IntentStatusResponseSchema } from '@taskmarket/shared';

import { apiError } from '../lib/api-error';
import { orphanedPayments, tasks, type RelayedIntent } from '../db/schema';
import { findIntentByIdempotencyKey, getRelayedIntent } from '../services/relayed-intents';
import { protectedProcedure, router } from '../trpc';
import type { Context } from '../context';

/**
 * Initiator scoping (ADR-0049 point 6, restated by ADR-0059).
 *
 * One comparison, and deliberately only one. `relayed_intents.payer` records the address the
 * relay acted for on every path, paid or free -- since ADR-0057 moved payment into its own
 * indivisible reference, it is the presence of `payment` that makes an intent refundable, and
 * this column is provenance. So it is the initiator under an older name, and authorizing on it
 * is not a new concept: it is the one this surface was already comparing against.
 *
 * Branching on whether a payment exists -- payer-scoped when paid, something else when free --
 * would give a surface deliberately built with one authorization rule a second one, and two
 * rules for one question is how they drift apart and how a gap opens between them. ADR-0049
 * already counted its single rule as "a place to get authorization wrong that did not exist
 * before"; there is no second place here.
 *
 * A caller who is not the initiator gets exactly what a caller asking about an id that does not
 * exist gets -- the same error, with nothing in it that distinguishes "not yours" from "no such
 * thing", since telling those apart would turn this into an oracle for which intent ids and
 * idempotency keys exist.
 *
 * A null initiator is readable by no *address*. That is the honest answer to "who started this"
 * when nothing was recorded, not a fallback: inventing an address that may read such a row would
 * be inventing the second rule.
 *
 * But an address is not the only thing a caller can present (ADR-0067).
 *
 * ADR-0067 made the intent a reservation, claimed before the payment challenge, so an intent now
 * exists during a window in which its payer is genuinely not yet knowable -- and the 409 that
 * created it tells the caller to read its outcome here. Under the address rule alone that
 * instruction is wrong in exactly the case a client most needs it: the row is readable by nobody.
 *
 * The gap is filled with the handle the caller already holds rather than with a second address
 * rule. `intents.get` takes either an intent id or the idempotency key, and those two are not
 * equivalent evidence. An id is minted here and proves nothing about who is asking. The key is
 * minted by the client before the request is sent, is the one handle that survives a lost
 * response, and is the whole premise of ADR-0052 -- so presenting it is the closest thing a
 * pre-payment caller has to identifying themselves, and matching it is a real comparison against
 * the row rather than an exemption from one.
 *
 * Two properties bound it, and both are the point:
 *
 * - Key possession is only ever a credential where *no* initiator was recorded. An intent that
 *   has a payer is answered by the address rule exactly as before, so a leaked key cannot open a
 *   settled write, and nothing about paid visibility is loosened.
 * - It is not an enumeration oracle. A caller who does not hold a key cannot ask this question at
 *   all: the id path is unchanged and still answers `intent_not_found` for a reservation, so the
 *   only way to reach the key path is to already possess a UUID a client minted, and a wrong
 *   guess is indistinguishable from a key that does not exist.
 *
 * `paymentAuthPayer` is the recorded-address case arriving late. The middleware writes the
 * authorization down before asking the facilitator to settle it, so from that moment an address
 * *is* recorded for the reservation and the ordinary rule has something to compare against
 * without any key. Preferring it when it exists is why this is a gap being filled and not a rule
 * being replaced: the address rule applies wherever an address exists, and the key answers only
 * the window where none does.
 */
function intentVisibleTo(
  intent: RelayedIntent,
  callerAddress: string,
  presentedIdempotencyKey: string | undefined
): boolean {
  // The settled payer, where there is one. Nothing below can widen this case.
  if (intent.payer) return intent.payer.toLowerCase() === callerAddress.toLowerCase();
  // The address the reservation is mid-settlement for, recorded before the settle call.
  if (intent.paymentAuthPayer?.toLowerCase() === callerAddress.toLowerCase()) return true;
  // No initiator recorded. The key is the only evidence there is, and it is evidence.
  return presentedIdempotencyKey !== undefined && presentedIdempotencyKey === intent.idempotencyKey;
}

function notFound(): TRPCError {
  return apiError({ reason: 'intent_not_found', message: 'No such intent' });
}

/**
 * The task a completed `tasks.create` produced, found by its escrow hash.
 *
 * Looked up rather than stored, because the intent payload deliberately holds no task id: the
 * chain assigns it, and it is only knowable from the transaction that created it. The task row
 * records that same hash in `escrow_tx_hash` -- written by whichever of the completion or the
 * chain-event indexer inserted it, both from the one transaction -- so the hash is the join.
 *
 * Only for a completed intent. Before that there may be a row from the indexer with no
 * completion behind it, and reporting an id from a write that has not finished would tell a
 * caller their creation is done when it is not.
 */
async function createdTaskIdFor(ctx: Context, intent: RelayedIntent): Promise<string | null> {
  if (intent.operation !== 'tasks.create' || intent.status !== 'completed' || !intent.txHash) {
    return null;
  }
  const [row] = await ctx.db
    .select({ id: tasks.id })
    .from(tasks)
    .where(eq(tasks.escrowTxHash, intent.txHash))
    .limit(1);
  return row?.id ?? null;
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

      // The key is passed as the caller presented it, not as the row records it: a lookup by
      // intent id presents none, and it must not inherit the row's own key as evidence.
      if (!intent || !intentVisibleTo(intent, ctx.caller.address, input.idempotencyKey)) {
        throw notFound();
      }

      return {
        intentId: intent.id,
        idempotencyKey: intent.idempotencyKey,
        operation: intent.operation,
        // 'reserved' included since ADR-0067: a key can name an intent whose payment has not
        // landed. A cast that omitted it would not fail here -- it would fail in the output
        // schema, as a 500, for a caller doing exactly what the 409 told them to do.
        status: intent.status as 'reserved' | 'recorded' | 'broadcast' | 'completed' | 'failed',
        txHash: intent.txHash ?? null,
        // `lastError` is also written on a non-terminal completion failure, where it is a
        // progress note rather than a verdict. Only a `failed` intent has a terminal reason,
        // so reporting it on any other status would tell a caller their write is dead while
        // settlement is still carrying it (ADR-0049 point 3).
        terminalReason: intent.status === 'failed' ? (intent.lastError ?? null) : null,
        taskId: await createdTaskIdFor(ctx, intent),
        refund: await refundStateFor(ctx, intent),
      };
    }),
});

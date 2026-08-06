import { z } from 'zod';

/**
 * The intent-status read surface (ADR-0049 point 2, built by ADR-0052).
 *
 * A caller that started a relayed write holds two handles to it: the intent id it was told
 * in the response, and the idempotency key it generated itself. Either resolves the same
 * intent. The key matters more than it looks: a caller whose connection dropped before the
 * response arrived never learned the intent id, and the key is the only thing they still
 * have.
 */
export const IntentStatusInputSchema = z
  .object({
    intentId: z.string().min(1).optional(),
    idempotencyKey: z.string().min(1).optional(),
  })
  .refine((value) => Boolean(value.intentId) !== Boolean(value.idempotencyKey), {
    message: 'Provide exactly one of intentId or idempotencyKey',
  });

export const IntentRefundStateSchema = z.object({
  status: z.enum(['pending', 'refunding', 'refunded', 'failed']),
  txHash: z.string().nullable(),
});

export const IntentStatusResponseSchema = z
  .object({
    intentId: z.string(),
    idempotencyKey: z.string(),
    /** The operation kind, e.g. `tasks.create`. */
    operation: z.string(),
    /**
     * `reserved` is the pre-payment state (ADR-0067): the key is claimed and the caller has been
     * challenged, but no payment has landed and nothing has been sent to the chain. It is
     * non-terminal, it is never broadcastable, and it expires if it is never filled.
     */
    status: z.enum(['reserved', 'recorded', 'broadcast', 'completed', 'failed']),
    /**
     * Known once something has been broadcast, and explicitly not the handle: the reconciler
     * may land a replacement at the same nonce, which is a different hash for the same intent.
     */
    txHash: z.string().nullable(),
    /** Why it failed, where it did. Null on every non-terminal status. */
    terminalReason: z.string().nullable(),
    /**
     * The task a completed `tasks.create` produced.
     *
     * This is where a caller whose creation went in flight learns the id. The id does not
     * exist until the transaction runs -- the contract derives it from a requester nonce it
     * increments as it goes -- so an in-flight creation has no id to report, and reporting one
     * would be a guess of the kind that made concurrent creates overwrite each other. Null
     * until the intent completes, and null for every other operation.
     */
    taskId: z.string().nullable(),
    /**
     * Only present where the intent carried a payment and that payment has been written off.
     * Null means no refund has been decided -- which is not the same as "no refund is coming"
     * while the intent is still in flight.
     */
    refund: IntentRefundStateSchema.nullable(),
  })
  /**
   * The combinations the lifecycle can actually produce, checked rather than described.
   *
   * Every field above is independently nullable, so the object type alone admits shapes the
   * lifecycle never emits -- a `reserved` intent carrying a txHash, or a taskId on an
   * operation that creates no task. Those are exactly the shapes a client reads and acts on:
   * a taskId shown for an intent that has not completed is a task id that does not exist yet,
   * and the whole reason `taskId` is null until completion is that the contract does not
   * derive it until the transaction runs. Catching that here means a malformed response is
   * rejected at the boundary instead of surfacing as a link to nothing.
   */
  .superRefine((value, ctx) => {
    if (value.status === 'reserved') {
      // Pre-payment (ADR-0067): the key is claimed and nothing has been sent. There is no
      // transaction to name, no terminal outcome to report, and no result.
      for (const field of ['txHash', 'terminalReason', 'taskId'] as const) {
        if (value[field] !== null) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [field],
            message: `A reserved intent has not been sent to the chain, so ${field} must be null`,
          });
        }
      }
      return;
    }

    if (value.taskId === null) return;

    if (value.status !== 'completed') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['taskId'],
        message: 'taskId is only known once the intent has completed',
      });
      return;
    }

    if (value.operation !== 'tasks.create') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['taskId'],
        message: 'Only a tasks.create intent produces a taskId',
      });
    }
  });

export type IntentStatusResponse = z.infer<typeof IntentStatusResponseSchema>;

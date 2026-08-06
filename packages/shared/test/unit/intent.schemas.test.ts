// Verifies: ADR-0049, ADR-0052, ADR-0067
//
// The response schema is the client boundary: a shape it accepts is a shape a caller will act
// on, so the combinations the lifecycle never emits are worth rejecting here rather than
// rendering somewhere as a link to nothing or as a write reported dead while it is still
// landing.
import { describe, expect, it } from 'vitest';

import { IntentStatusResponseSchema } from '../../src/schemas/intent.schemas';

function response(overrides: Record<string, unknown> = {}) {
  return {
    intentId: 'intent-1',
    idempotencyKey: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
    operation: 'tasks.create',
    status: 'broadcast',
    txHash: `0x${'ab'.repeat(32)}`,
    terminalReason: null,
    taskId: null,
    refund: null,
    ...overrides,
  };
}

describe('IntentStatusResponseSchema terminalReason', () => {
  it('accepts a terminal reason on a failed intent', () => {
    const parsed = IntentStatusResponseSchema.safeParse(
      response({ status: 'failed', terminalReason: 'escrow deposit reverted' })
    );

    expect(parsed.success).toBe(true);
  });

  // `completed` is here as well as the two in-flight statuses: it is terminal, but it is the
  // terminal outcome that has no reason to give. The completion path clears `lastError` in the
  // same statement that writes the status, so a completed intent carrying a verdict is a shape
  // the lifecycle cannot produce either.
  it.each(['recorded', 'broadcast', 'completed', 'reserved'] as const)(
    'rejects a terminal reason on a %s intent, which has no failure to report',
    (status) => {
      const parsed = IntentStatusResponseSchema.safeParse(
        response({
          status,
          // A reserved intent has been sent nowhere, so a hash would raise its own issue.
          txHash: status === 'reserved' ? null : `0x${'ab'.repeat(32)}`,
          terminalReason: 'escrow deposit reverted',
        })
      );

      expect(parsed.success).toBe(false);
      // Searched for, not read off index 0: which issue comes first is an ordering detail of
      // the refinement, and this is asserting that the field was rejected at all.
      expect(parsed.error?.issues.some((issue) => issue.path.join('.') === 'terminalReason')).toBe(
        true
      );
    }
  );

  it('accepts a null terminal reason on every status', () => {
    for (const status of ['reserved', 'recorded', 'broadcast', 'completed', 'failed'] as const) {
      const parsed = IntentStatusResponseSchema.safeParse(
        response({ status, txHash: status === 'reserved' ? null : `0x${'ab'.repeat(32)}` })
      );

      expect(parsed.success).toBe(true);
    }
  });

  /**
   * Not an oversight: the lifecycle really does emit both of these.
   *
   * A refund can attach to a reservation, because `holdReservationForReview` leaves a row
   * `reserved` precisely when the token contract says its authorization was consumed -- money
   * moved and nothing was built. And a completed `tasks.create` can report no task id, because
   * `persistIntentBroadcast` swallows its own write failure ("the transaction is live") while
   * completion carries on, leaving an intent with no hash for the task lookup to join on.
   * Rejecting either would turn a readable state into a parse failure at this boundary.
   */
  it('accepts the awkward states the lifecycle genuinely produces', () => {
    expect(
      IntentStatusResponseSchema.safeParse(
        response({
          status: 'reserved',
          txHash: null,
          refund: { status: 'refunded', txHash: `0x${'cd'.repeat(32)}` },
        })
      ).success
    ).toBe(true);

    expect(
      IntentStatusResponseSchema.safeParse(
        response({ status: 'completed', txHash: null, taskId: null })
      ).success
    ).toBe(true);
  });
});

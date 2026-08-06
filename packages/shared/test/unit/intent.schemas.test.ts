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

  it.each(['recorded', 'broadcast'] as const)(
    'rejects a terminal reason on a %s intent, which is still being carried',
    (status) => {
      const parsed = IntentStatusResponseSchema.safeParse(
        response({ status, terminalReason: 'escrow deposit reverted' })
      );

      expect(parsed.success).toBe(false);
      expect(parsed.error?.issues[0]?.path).toEqual(['terminalReason']);
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

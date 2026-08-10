import type { WriteOutcome } from '../../src/lib/api.js';

/**
 * The idempotency key the fake transport hands back from a write.
 *
 * A fixed value rather than a fresh UUID per call, so an assertion can name the key it expects to
 * see on the envelope. The point being pinned is that the key on a report came from the write
 * that report describes, and that is only checkable if the two are separately identifiable.
 */
export const TEST_IDEMPOTENCY_KEY = 'test-idempotency-key';

/** A write's return value: the backend payload, plus the key it was sent under. */
export function writeOutcome<T>(data: T, idempotencyKey = TEST_IDEMPOTENCY_KEY): WriteOutcome<T> {
  return { data, idempotencyKey };
}

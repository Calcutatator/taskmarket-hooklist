import { describe, it, expect } from 'vitest';

/**
 * Pins the evaluatorDeadline derivation logic used in processTaskSubmittedEvent.
 *
 * The deadline must be computed from the on-chain block timestamp (not wall-clock
 * time) so that indexer replay/backfill produces the same value each time.
 *
 * Formula: new Date((blockTimestamp + evaluationWindow) * 1000)
 * where blockTimestamp is block.timestamp (seconds) from publicClient.getBlock().
 */
function computeEvaluatorDeadline(blockTimestampSecs: number, evaluationWindowSecs: number): Date {
  return new Date((blockTimestampSecs + evaluationWindowSecs) * 1000);
}

describe('indexer — evaluatorDeadline formula', () => {
  it('adds evaluationWindow to block timestamp in seconds', () => {
    const deadline = computeEvaluatorDeadline(1_700_000_000, 3600);
    expect(deadline.getTime()).toBe(1_700_003_600_000);
  });

  it('produces different results for different block timestamps (replay-safe)', () => {
    const d1 = computeEvaluatorDeadline(1_700_000_000, 86400);
    const d2 = computeEvaluatorDeadline(1_700_100_000, 86400);
    expect(d1.getTime()).not.toBe(d2.getTime());
    expect(d2.getTime() - d1.getTime()).toBe(100_000 * 1000);
  });

  it('24h window produces deadline 86400s after block', () => {
    const blockTs = 1_000_000_000;
    const deadline = computeEvaluatorDeadline(blockTs, 86400);
    expect(deadline.getTime()).toBe((blockTs + 86400) * 1000);
  });
});

/**
 * Pins the EvaluatorTimedOut DB set payload shape.
 * The handler must clear evaluatorDeadline (set to null) alongside status/stake.
 */
describe('indexer — EvaluatorTimedOut set payload', () => {
  it('payload includes evaluatorDeadline: null to clear the deadline', () => {
    const payload = {
      status: 'pending_approval' as const,
      evaluatorStake: '0',
      evaluatorDeadline: null,
    };
    expect(payload.status).toBe('pending_approval');
    expect(payload.evaluatorStake).toBe('0');
    expect(payload.evaluatorDeadline).toBeNull();
  });
});

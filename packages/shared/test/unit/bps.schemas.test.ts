import { describe, expect, it } from 'vitest';

import {
  ExchangeRateOutputSchema,
  TaskDetailResponseSchema,
  TaskResponseSchema,
} from '../../src/schemas';

/**
 * Basis points are a money multiplier: a value a reader has to guess at is a wrong number of
 * dollars, shown silently. These tests pin the two properties that keep the guess from being
 * possible -- a fee the reader cannot omit, and a fraction it cannot exceed.
 */
function taskResponse(overrides: Record<string, unknown> = {}) {
  return {
    id: 'task-1',
    requester: '0x1111111111111111111111111111111111111111',
    requesterPubkey: null,
    description: 'A task',
    reward: '1000000',
    escrowTxHash: '0xabc',
    createdAt: '2026-01-01T00:00:00.000Z',
    expiryTime: '2026-01-02T00:00:00.000Z',
    status: 'open',
    tags: [],
    mode: 'bounty',
    stakeRequired: false,
    stakeBps: 0,
    pitchDeadline: null,
    bidDeadline: null,
    maxPrice: null,
    metricDescription: null,
    metricTarget: null,
    claimedBy: null,
    claimedAt: null,
    platformFeeBps: 500,
    submissionWindowOpen: true,
    phase: 'active',
    ...overrides,
  };
}

describe('platformFeeBps on the task response', () => {
  it('parses when the fee is present', () => {
    const result = TaskResponseSchema.safeParse(taskResponse());
    expect(result.success).toBe(true);
    expect(result.success && result.data.platformFeeBps).toBe(500);
  });

  it('fails to parse when the fee is absent, rather than defaulting it', () => {
    const { platformFeeBps: _omitted, ...withoutFee } = taskResponse();
    const result = TaskResponseSchema.safeParse(withoutFee);
    expect(result.success).toBe(false);
    expect(result.success === false && result.error.issues[0]?.path).toEqual(['platformFeeBps']);
  });

  it('rejects a fee above 100 percent or below zero', () => {
    expect(TaskResponseSchema.safeParse(taskResponse({ platformFeeBps: 10001 })).success).toBe(
      false
    );
    expect(TaskResponseSchema.safeParse(taskResponse({ platformFeeBps: -1 })).success).toBe(false);
  });

  it('rejects a fractional fee, which no uint16 could carry', () => {
    expect(TaskResponseSchema.safeParse(taskResponse({ platformFeeBps: 12.5 })).success).toBe(
      false
    );
  });
});

describe('stakeBps on the task response', () => {
  it('is bounded the same way the request side bounds it', () => {
    expect(TaskResponseSchema.safeParse(taskResponse({ stakeBps: 10000 })).success).toBe(true);
    expect(TaskResponseSchema.safeParse(taskResponse({ stakeBps: 10001 })).success).toBe(false);
    expect(TaskResponseSchema.safeParse(taskResponse({ stakeBps: 7.5 })).success).toBe(false);
  });
});

describe('evaluatorFeeBps on the task response', () => {
  it('stays genuinely absent, because no evaluator means no evaluator fee', () => {
    expect(TaskResponseSchema.safeParse(taskResponse()).success).toBe(true);
    expect(TaskResponseSchema.safeParse(taskResponse({ evaluatorFeeBps: null })).success).toBe(
      true
    );
  });

  it('is bounded when it is present', () => {
    expect(TaskResponseSchema.safeParse(taskResponse({ evaluatorFeeBps: 1000 })).success).toBe(
      true
    );
    expect(TaskResponseSchema.safeParse(taskResponse({ evaluatorFeeBps: 10001 })).success).toBe(
      false
    );
  });
});

describe('bonusBps on the task detail response', () => {
  const detail = (overrides: Record<string, unknown> = {}) =>
    TaskDetailResponseSchema.safeParse({ ...taskResponse(), pendingActions: [], ...overrides });

  it('is absent for a task with no DREAMS hook', () => {
    const result = detail();
    expect(result.success).toBe(true);
    expect(result.success && result.data.bonusBps).toBeUndefined();
  });

  it('is bounded when the hook is configured', () => {
    expect(detail({ bonusBps: 750 }).success).toBe(true);
    expect(detail({ bonusBps: 10001 }).success).toBe(false);
  });
});

describe('the exchange rate output', () => {
  const rate = { dreamsPerUsdc: '10', workerSplitBps: 8000, bonusBps: 750 };

  it('parses when every multiplier is present', () => {
    expect(ExchangeRateOutputSchema.safeParse(rate).success).toBe(true);
  });

  it('fails when the worker split is absent, rather than paying out the whole bonus', () => {
    const { workerSplitBps: _omitted, ...withoutSplit } = rate;
    expect(ExchangeRateOutputSchema.safeParse(withoutSplit).success).toBe(false);
  });

  it('fails when the bonus rate is absent, rather than reporting no bonus', () => {
    const { bonusBps: _omitted, ...withoutBonus } = rate;
    expect(ExchangeRateOutputSchema.safeParse(withoutBonus).success).toBe(false);
  });

  it('rejects either multiplier above what the hook itself accepts', () => {
    expect(ExchangeRateOutputSchema.safeParse({ ...rate, workerSplitBps: 10001 }).success).toBe(
      false
    );
    expect(ExchangeRateOutputSchema.safeParse({ ...rate, bonusBps: 10001 }).success).toBe(false);
  });
});

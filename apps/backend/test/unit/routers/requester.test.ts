import { describe, it, expect, beforeEach } from 'vitest';
import { createMockCtx, makeChain } from '../helpers';
import { requesterRouter } from '../../../src/routers/requester.router';

const ADDR = '0xRequester0000000000000000000000000000001';

function setupDb(
  ctx: ReturnType<typeof createMockCtx>,
  reputationRows: object[],
  taskCount: number,
  uniqueWorkers: number
) {
  ctx.db.select
    .mockReturnValueOnce(makeChain(reputationRows))
    .mockReturnValueOnce(makeChain([{ count: taskCount }]))
    .mockReturnValueOnce(makeChain([{ count: uniqueWorkers }]));
}

describe('requester.stats', () => {
  let ctx: ReturnType<typeof createMockCtx>;

  beforeEach(() => {
    ctx = createMockCtx();
  });

  it('returns all zeros when no history exists', async () => {
    setupDb(ctx, [], 0, 0);
    const result = await requesterRouter.createCaller(ctx).stats({ address: ADDR });

    expect(result).toEqual({
      completedCount: 0,
      selfAwardCount: 0,
      cancelledAfterSubmissionsCount: 0,
      expiredNoActionCount: 0,
      expiredAfterRejectionsCount: 0,
      totalTasksCreated: 0,
      totalSubmissionAttempts: 0,
      totalUniqueWorkers: 0,
    });
  });

  it('counts completed events and totalTasksCreated', async () => {
    setupDb(
      ctx,
      [
        { eventType: 'completed', selfAward: false, submissionCount: 2 },
        { eventType: 'completed', selfAward: false, submissionCount: 3 },
      ],
      5,
      2
    );
    const result = await requesterRouter.createCaller(ctx).stats({ address: ADDR });

    expect(result.completedCount).toBe(2);
    expect(result.selfAwardCount).toBe(0);
    expect(result.totalSubmissionAttempts).toBe(5);
    expect(result.totalTasksCreated).toBe(5);
    expect(result.totalUniqueWorkers).toBe(2);
  });

  it('increments selfAwardCount for completed events with selfAward=true', async () => {
    setupDb(
      ctx,
      [
        { eventType: 'completed', selfAward: true, submissionCount: 1 },
        { eventType: 'completed', selfAward: false, submissionCount: 1 },
        { eventType: 'completed', selfAward: true, submissionCount: 1 },
      ],
      3,
      1
    );
    const result = await requesterRouter.createCaller(ctx).stats({ address: ADDR });

    expect(result.completedCount).toBe(3);
    expect(result.selfAwardCount).toBe(2);
  });

  it('counts cancelledAfterSubmissionsCount', async () => {
    setupDb(
      ctx,
      [
        { eventType: 'cancelled_after_submissions', selfAward: false, submissionCount: 1 },
        { eventType: 'cancelled_after_submissions', selfAward: false, submissionCount: 2 },
      ],
      2,
      1
    );
    const result = await requesterRouter.createCaller(ctx).stats({ address: ADDR });

    expect(result.cancelledAfterSubmissionsCount).toBe(2);
    expect(result.completedCount).toBe(0);
  });

  it('counts expiredNoActionCount', async () => {
    setupDb(ctx, [{ eventType: 'expired_no_action', selfAward: false, submissionCount: 0 }], 1, 0);
    const result = await requesterRouter.createCaller(ctx).stats({ address: ADDR });

    expect(result.expiredNoActionCount).toBe(1);
    expect(result.expiredAfterRejectionsCount).toBe(0);
  });

  it('counts expiredAfterRejectionsCount separately from expiredNoActionCount', async () => {
    setupDb(
      ctx,
      [
        { eventType: 'expired_no_action', selfAward: false, submissionCount: 0 },
        { eventType: 'expired_after_rejections', selfAward: false, submissionCount: 3 },
      ],
      2,
      1
    );
    const result = await requesterRouter.createCaller(ctx).stats({ address: ADDR });

    expect(result.expiredNoActionCount).toBe(1);
    expect(result.expiredAfterRejectionsCount).toBe(1);
    expect(result.totalSubmissionAttempts).toBe(3);
  });

  it('accumulates totalSubmissionAttempts across all event types', async () => {
    setupDb(
      ctx,
      [
        { eventType: 'completed', selfAward: false, submissionCount: 4 },
        { eventType: 'cancelled_after_submissions', selfAward: false, submissionCount: 2 },
        { eventType: 'expired_after_rejections', selfAward: false, submissionCount: 1 },
      ],
      3,
      3
    );
    const result = await requesterRouter.createCaller(ctx).stats({ address: ADDR });

    expect(result.totalSubmissionAttempts).toBe(7);
  });

  it('handles null submissionCount gracefully', async () => {
    setupDb(
      ctx,
      [{ eventType: 'completed', selfAward: false, submissionCount: null }],
      1,
      0
    );
    const result = await requesterRouter.createCaller(ctx).stats({ address: ADDR });

    expect(result.totalSubmissionAttempts).toBe(0);
    expect(result.completedCount).toBe(1);
  });
});

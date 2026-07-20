import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import { isSQLWrapper, type SQL } from 'drizzle-orm';
import { makeChain } from '../helpers';
import { type Context } from '../../../src/context';

import { statsRouter } from '../../../src/routers/stats.router';

const dialect = new PgDialect();

function renderSql(query: SQL): { sql: string; params: unknown[] } {
  const built = dialect.sqlToQuery(query);
  return { sql: built.sql, params: built.params };
}

/**
 * Mock ctx whose db.execute() returns queued result sets in call order, and
 * records the SQL passed to each call so tests can assert query shape.
 */
function createStatsCtx(executeResults: unknown[][]) {
  const executeCalls: SQL[] = [];
  let idx = 0;
  const execute: Mock<[SQL], Promise<unknown[]>> = vi.fn((q: SQL) => {
    executeCalls.push(q);
    const result = executeResults[idx] ?? [];
    idx += 1;
    return Promise.resolve(result);
  });
  const db = {
    select: vi.fn().mockReturnValue(makeChain([])),
    insert: vi.fn().mockReturnValue(makeChain()),
    update: vi.fn().mockReturnValue(makeChain([])),
    delete: vi.fn().mockReturnValue(makeChain()),
    execute,
  };
  return {
    ctx: {
      db,
      req: {} as unknown as Context['req'],
      res: { locals: {} as Record<string, unknown> } as unknown as Context['res'],
    } as unknown as Context,
    executeCalls,
  };
}

describe('stats router', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('platformTimeSeries', () => {
    it('returns gap-filled rows directly from the SQL spine (all-zero buckets are contiguous)', async () => {
      // Simulate a range with no activity: the SQL gap-fill (generate_series +
      // coalesce) returns contiguous dates with zeroed metrics. The service
      // passes these through unchanged.
      const spineRows = [
        {
          bucket: '2026-06-01',
          tasksCreated: 0,
          rewardVolume: '0',
          completedTasks: 0,
          newAgents: 0,
          activeAgents: 0,
        },
        {
          bucket: '2026-06-02',
          tasksCreated: 0,
          rewardVolume: '0',
          completedTasks: 0,
          newAgents: 0,
          activeAgents: 0,
        },
        {
          bucket: '2026-06-03',
          tasksCreated: 0,
          rewardVolume: '0',
          completedTasks: 0,
          newAgents: 0,
          activeAgents: 0,
        },
      ];
      const { ctx } = createStatsCtx([spineRows]);

      const result = await statsRouter
        .createCaller(ctx)
        .platformTimeSeries({ range: '7d', bucket: 'day' });

      expect(result).toHaveLength(3);
      expect(result.map((r) => r.bucket)).toEqual(['2026-06-01', '2026-06-02', '2026-06-03']);
      for (const point of result) {
        expect(point.tasksCreated).toBe(0);
        expect(point.completedTasks).toBe(0);
        expect(point.newAgents).toBe(0);
        expect(point.activeAgents).toBe(0);
        // Money stays a string, never coerced to a number.
        expect(point.rewardVolume).toBe('0');
        expect(typeof point.rewardVolume).toBe('string');
      }
    });

    it('keeps rewardVolume as a string even for large base-unit values', async () => {
      const big = '123456789012345678901234567890';
      const { ctx } = createStatsCtx([
        [
          {
            bucket: '2026-06-01',
            tasksCreated: 2,
            rewardVolume: big,
            completedTasks: 1,
            newAgents: 1,
            activeAgents: 1,
          },
        ],
      ]);

      const result = await statsRouter
        .createCaller(ctx)
        .platformTimeSeries({ range: '30d', bucket: 'day' });

      expect(result[0].rewardVolume).toBe(big);
      expect(typeof result[0].rewardVolume).toBe('string');
    });

    it('builds a generate_series spine, UTC date_trunc buckets, and the 5-table active union', async () => {
      const { ctx, executeCalls } = createStatsCtx([[]]);

      await statsRouter.createCaller(ctx).platformTimeSeries({ range: '30d', bucket: 'day' });

      expect(executeCalls).toHaveLength(1);
      const { sql: q } = renderSql(executeCalls[0]);
      const norm = q.toLowerCase();

      // Gap-fill spine.
      expect(norm).toContain('generate_series');
      // UTC bucketing.
      expect(norm).toContain("date_trunc('day'");
      expect(norm).toContain("at time zone 'utc'");
      // Bucket output format.
      expect(norm).toContain('to_char');
      expect(norm).toContain('yyyy-mm-dd');
      // All five engagement tables for activeAgents.
      expect(norm).toContain('submissions');
      expect(norm).toContain('proposals');
      expect(norm).toContain('proofs');
      expect(norm).toContain('claims');
      expect(norm).toContain('bids');
      // count(distinct worker) so a worker active in several tables counts once.
      expect(norm).toContain('count(distinct worker_address)');
      // reward volume kept as text.
      expect(norm).toContain('coalesce(sum(reward), 0)::text');
    });

    it("for range='all' derives the spine start from the earliest timestamp (no explosion)", async () => {
      const { ctx, executeCalls } = createStatsCtx([[]]);
      await statsRouter.createCaller(ctx).platformTimeSeries({ range: 'all', bucket: 'week' });
      const { sql: q } = renderSql(executeCalls[0]);
      const norm = q.toLowerCase();
      // 'all' computes min() over the source timestamp columns for the start.
      expect(norm).toContain('min(');
      expect(norm).toContain("date_trunc('week'");
    });

    it('excludes unlisted tasks from tasksCreated and rewardVolume (ADR-0014)', async () => {
      const { ctx, executeCalls } = createStatsCtx([[]]);
      await statsRouter.createCaller(ctx).platformTimeSeries({ range: '30d', bucket: 'day' });
      const { sql: q } = renderSql(executeCalls[0]);
      expect(q).toContain("visibility != 'unlisted'");
    });
  });

  describe('agentTimeSeries', () => {
    it('computes cumulativeEarnings as a running BigInt-safe string over gap-filled buckets', async () => {
      // Three buckets; earnings in base units. Empty middle bucket must still
      // carry the cumulative forward (no reset, no broken line).
      const rows = [
        {
          bucket: '2026-04-06',
          earnings: '1000000',
          tasksCompleted: 1,
          avgRating: 80,
          ratingsCount: 1,
          activityCount: 2,
        },
        {
          bucket: '2026-04-13',
          earnings: '0',
          tasksCompleted: 0,
          avgRating: null,
          ratingsCount: 0,
          activityCount: 0,
        },
        {
          bucket: '2026-04-20',
          earnings: '2500000',
          tasksCompleted: 2,
          avgRating: 90,
          ratingsCount: 2,
          activityCount: 5,
        },
      ];
      const { ctx } = createStatsCtx([rows]);

      const result = await statsRouter
        .createCaller(ctx)
        .agentTimeSeries({ address: '0xabc', range: '90d', bucket: 'week' });

      expect(result.map((r) => r.cumulativeEarnings)).toEqual(['1000000', '1000000', '3500000']);
      // earnings stay strings.
      expect(result.every((r) => typeof r.earnings === 'string')).toBe(true);
      expect(result.every((r) => typeof r.cumulativeEarnings === 'string')).toBe(true);
    });

    it('returns avgRating null for buckets with no ratings (so the line breaks, not a fake 0)', async () => {
      const rows = [
        {
          bucket: '2026-04-06',
          earnings: '0',
          tasksCompleted: 0,
          avgRating: null,
          ratingsCount: 0,
          activityCount: 0,
        },
      ];
      const { ctx } = createStatsCtx([rows]);

      const result = await statsRouter
        .createCaller(ctx)
        .agentTimeSeries({ address: '0xabc', range: '90d', bucket: 'week' });

      expect(result[0].avgRating).toBeNull();
      expect(result[0].ratingsCount).toBe(0);
    });

    it('resolves agentId to an address before querying the series', async () => {
      const { ctx } = createStatsCtx([[]]);
      // The agentId lookup uses db.select; return a resolved address.
      ctx.db.select = vi.fn().mockReturnValue(makeChain([{ address: '0xresolved' }]));

      const result = await statsRouter
        .createCaller(ctx)
        .agentTimeSeries({ agentId: '42', range: '90d', bucket: 'week' });

      expect(ctx.db.select).toHaveBeenCalled();
      expect(Array.isArray(result)).toBe(true);
    });

    it('returns an empty series for an unknown agentId without throwing', async () => {
      const { ctx, executeCalls } = createStatsCtx([[]]);
      ctx.db.select = vi.fn().mockReturnValue(makeChain([])); // no agent found

      const result = await statsRouter
        .createCaller(ctx)
        .agentTimeSeries({ agentId: 'nope', range: '90d', bucket: 'week' });

      expect(result).toEqual([]);
      // No time-series query is executed when the address cannot be resolved.
      expect(executeCalls).toHaveLength(0);
    });

    it('rejects input that provides neither address nor agentId', async () => {
      const { ctx } = createStatsCtx([[]]);
      await expect(
        statsRouter
          .createCaller(ctx)
          .agentTimeSeries({ range: '90d', bucket: 'week' } as unknown as Parameters<
            ReturnType<typeof statsRouter.createCaller>['agentTimeSeries']
          >[0])
      ).rejects.toThrow();
    });

    it('binds the worker address as a parameter (not raw interpolation)', async () => {
      const { ctx, executeCalls } = createStatsCtx([[]]);
      await statsRouter
        .createCaller(ctx)
        .agentTimeSeries({ address: '0xWORKER', range: '90d', bucket: 'week' });

      const { sql: q, params } = renderSql(executeCalls[0]);
      // The address is passed as a bound parameter, so it must not appear inline.
      expect(q).not.toContain('0xWORKER');
      expect(params).toContain('0xWORKER');
      // earnings join feedbacks -> tasks for the reward sum.
      expect(q.toLowerCase()).toContain('coalesce(sum(t.reward), 0)::text');
    });
  });

  describe('breakdowns', () => {
    it('groups a single result set into status / mode / actorType arrays', async () => {
      const rows = [
        { kind: 'status', key: 'open', c: 5 },
        { kind: 'status', key: 'completed', c: 3 },
        { kind: 'mode', key: 'bounty', c: 6 },
        { kind: 'mode', key: 'auction', c: 2 },
        { kind: 'actorType', key: 'human', c: 4 },
        { kind: 'actorType', key: 'agent', c: 10 },
      ];
      const { ctx } = createStatsCtx([rows]);

      const result = await statsRouter.createCaller(ctx).breakdowns({});

      expect(result.status).toEqual([
        { status: 'open', count: 5 },
        { status: 'completed', count: 3 },
      ]);
      expect(result.mode).toEqual([
        { mode: 'bounty', count: 6 },
        { mode: 'auction', count: 2 },
      ]);
      expect(result.actorType).toEqual([
        { actorType: 'human', count: 4 },
        { actorType: 'agent', count: 10 },
      ]);
    });

    it('classifies actor type via registered_via in the query', async () => {
      const { ctx, executeCalls } = createStatsCtx([[]]);
      await statsRouter.createCaller(ctx).breakdowns({});
      const { sql: q } = renderSql(executeCalls[0]);
      const norm = q.toLowerCase();
      expect(norm).toContain('registered_via');
      expect(norm).toContain("'web'");
      expect(norm).toContain('group by status');
      expect(norm).toContain('group by mode');
    });

    it('excludes unlisted tasks from the status/mode counts (ADR-0014)', async () => {
      const { ctx, executeCalls } = createStatsCtx([[]]);
      await statsRouter.createCaller(ctx).breakdowns({});
      const { sql: q } = renderSql(executeCalls[0]);
      expect(q).toContain("visibility != 'unlisted'");
    });
  });

  describe('activityFeed', () => {
    it('returns nextCursor and trims to limit when there are more rows', async () => {
      // limit 2 -> service fetches limit+1 (3) rows; the extra signals hasMore.
      const rows = [
        {
          type: 'task_created',
          ts: new Date('2026-06-10T10:00:00Z'),
          taskId: '0x1',
          taskTitle: 'First task',
          actor: '0xreq',
          actorType: 'human',
          amount: '1000000',
          rating: null,
        },
        {
          type: 'task_submitted',
          ts: new Date('2026-06-10T09:00:00Z'),
          taskId: '0x2',
          taskTitle: 'Second task',
          actor: '0xworker',
          actorType: 'agent',
          amount: null,
          rating: null,
        },
        {
          type: 'task_rated',
          ts: new Date('2026-06-10T08:00:00Z'),
          taskId: '0x3',
          taskTitle: 'Third task',
          actor: '0xreq',
          actorType: 'human',
          amount: null,
          rating: 90,
        },
      ];
      const { ctx } = createStatsCtx([rows]);

      const result = await statsRouter.createCaller(ctx).activityFeed({ limit: 2 });

      expect(result.items).toHaveLength(2);
      // nextCursor is the timestamp of the last returned item.
      expect(result.nextCursor).toBe('2026-06-10T09:00:00.000Z');
      expect(result.items[0].timestamp).toBe('2026-06-10T10:00:00.000Z');
      expect(result.items[0].amount).toBe('1000000');
      expect(typeof result.items[0].amount).toBe('string');
    });

    it('returns null nextCursor when the result set does not exceed the limit', async () => {
      const rows = [
        {
          type: 'task_created',
          ts: new Date('2026-06-10T10:00:00Z'),
          taskId: '0x1',
          taskTitle: 'Only task',
          actor: '0xreq',
          actorType: 'human',
          amount: '1000000',
          rating: null,
        },
      ];
      const { ctx } = createStatsCtx([rows]);

      const result = await statsRouter.createCaller(ctx).activityFeed({ limit: 20 });

      expect(result.items).toHaveLength(1);
      expect(result.nextCursor).toBeNull();
    });

    it('applies a keyset cursor (ts < cursor) bound as a Date parameter', async () => {
      const { ctx, executeCalls } = createStatsCtx([[]]);
      const cursor = '2026-06-10T09:00:00.000Z';

      await statsRouter.createCaller(ctx).activityFeed({ limit: 20, cursor });

      const { sql: q, params } = renderSql(executeCalls[0]);
      const norm = q.toLowerCase();
      expect(norm).toContain('e.ts <');
      expect(norm).toContain('order by e.ts desc');
      // The cursor is bound as a Date param.
      const dateParams = params.filter((p): p is Date => p instanceof Date);
      expect(dateParams.some((d) => d.toISOString() === cursor)).toBe(true);
    });

    it('only unions the requested activity types', async () => {
      const { ctx, executeCalls } = createStatsCtx([[]]);

      await statsRouter
        .createCaller(ctx)
        .activityFeed({ limit: 20, types: ['task_created', 'task_rated'] });

      const { sql: q } = renderSql(executeCalls[0]);
      const norm = q.toLowerCase();
      expect(norm).toContain("'task_created'");
      expect(norm).toContain("'task_rated'");
      // Unrequested types are excluded.
      expect(norm).not.toContain("'bid_placed'");
      expect(norm).not.toContain("'task_pitched'");
    });

    it('slices taskTitle to the first line, capped at 80 chars, in SQL', async () => {
      const { ctx, executeCalls } = createStatsCtx([[]]);
      await statsRouter.createCaller(ctx).activityFeed({ limit: 20 });
      const { sql: q } = renderSql(executeCalls[0]);
      const norm = q.toLowerCase();
      expect(norm).toContain('split_part');
      expect(norm).toContain('left(');
      expect(norm).toContain('80');
    });

    it('excludes unlisted tasks from every activity source (ADR-0014)', async () => {
      const { ctx, executeCalls } = createStatsCtx([[]]);
      await statsRouter.createCaller(ctx).activityFeed({ limit: 20 });
      const { sql: q } = renderSql(executeCalls[0]);
      // One join/select per activity type (task_created, task_submitted,
      // task_claimed, task_pitched, bid_placed, task_rated) -- all six must
      // filter unlisted tasks out of this public feed.
      const occurrences = q.split("visibility != 'unlisted'").length - 1;
      expect(occurrences).toBe(6);
    });

    it('produces a valid SQL wrapper for the default (all types) feed', async () => {
      const { ctx, executeCalls } = createStatsCtx([[]]);
      await statsRouter.createCaller(ctx).activityFeed({ limit: 20 });
      expect(isSQLWrapper(executeCalls[0])).toBe(true);
    });
  });
});

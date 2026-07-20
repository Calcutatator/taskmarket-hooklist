import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import { type SQL } from 'drizzle-orm';
import { makeChain } from '../helpers';

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
type MockDb = {
  select: ReturnType<typeof vi.fn>;
  insert: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
  execute: Mock<[SQL], Promise<unknown[]>>;
};

function createStatsCtx(executeResults: unknown[][]) {
  const executeCalls: SQL[] = [];
  let idx = 0;
  const db: MockDb = {
    select: vi.fn().mockReturnValue(makeChain([])),
    insert: vi.fn().mockReturnValue(makeChain()),
    update: vi.fn().mockReturnValue(makeChain([])),
    delete: vi.fn().mockReturnValue(makeChain()),
    execute: vi.fn((q: SQL) => {
      executeCalls.push(q);
      const result = executeResults[idx] ?? [];
      idx += 1;
      return Promise.resolve(result);
    }),
  };
  type StatsCtx = Parameters<typeof statsRouter.createCaller>[0];
  return {
    ctx: {
      db,
      req: {} as Record<string, unknown>,
      res: { locals: {} as Record<string, unknown> },
    } as unknown as StatsCtx,
    executeCalls,
  };
}

describe('stats router activityHeatmap', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("dimension='mode'", () => {
    it('returns the fixed mode rowKeys, day colKeys from the spine, and non-empty cells only', async () => {
      // Spine rows: two days. Day 1 has a bounty cell; day 2 has no task (row null).
      const rows = [
        { col: '2026-06-01', row: 'bounty', c: 3, v: '5000000' },
        { col: '2026-06-02', row: null, c: 0, v: '0' },
      ];
      const { ctx } = createStatsCtx([rows]);

      const result = await statsRouter
        .createCaller(ctx)
        .activityHeatmap({ range: '7d', dimension: 'mode' });

      expect(result.rowKeys).toEqual(['bounty', 'claim', 'pitch', 'benchmark', 'auction']);
      // colKeys are the ordered, de-duplicated spine day buckets.
      expect(result.colKeys).toEqual(['2026-06-01', '2026-06-02']);
      // Only the non-empty cell is emitted.
      expect(result.cells).toEqual([
        { row: 'bounty', col: '2026-06-01', count: 3, volume: '5000000' },
      ]);
      expect(result.maxCount).toBe(3);
      // Volume stays a string, never coerced to a number.
      expect(typeof result.cells[0].volume).toBe('string');
    });

    it('keeps volume as a string for large base-unit reward sums', async () => {
      const big = '123456789012345678901234567890';
      const rows = [{ col: '2026-06-01', row: 'auction', c: 1, v: big }];
      const { ctx } = createStatsCtx([rows]);

      const result = await statsRouter
        .createCaller(ctx)
        .activityHeatmap({ range: '30d', dimension: 'mode' });

      expect(result.cells[0].volume).toBe(big);
      expect(typeof result.cells[0].volume).toBe('string');
    });

    it('returns maxCount 0 and no cells when there is no data', async () => {
      // Spine still produces day rows, but every row has a null mode (no tasks).
      const rows = [
        { col: '2026-06-01', row: null, c: 0, v: '0' },
        { col: '2026-06-02', row: null, c: 0, v: '0' },
      ];
      const { ctx } = createStatsCtx([rows]);

      const result = await statsRouter
        .createCaller(ctx)
        .activityHeatmap({ range: '7d', dimension: 'mode' });

      expect(result.cells).toEqual([]);
      expect(result.maxCount).toBe(0);
      expect(result.colKeys).toEqual(['2026-06-01', '2026-06-02']);
    });

    it('builds a generate_series spine, UTC day buckets, guards null created_at, and sums reward as text', async () => {
      const { ctx, executeCalls } = createStatsCtx([[]]);

      await statsRouter.createCaller(ctx).activityHeatmap({ range: '30d', dimension: 'mode' });

      expect(executeCalls).toHaveLength(1);
      const { sql: q } = renderSql(executeCalls[0]);
      const norm = q.toLowerCase();
      expect(norm).toContain('generate_series');
      expect(norm).toContain("date_trunc('day'");
      expect(norm).toContain("at time zone 'utc'");
      // created_at is guarded null (known gotcha).
      expect(norm).toContain('created_at is not null');
      // reward summed as text base units.
      expect(norm).toContain('coalesce(sum(reward), 0)::text');
      // day-bucket col output format.
      expect(norm).toContain('yyyy-mm-dd');
    });

    it('excludes unlisted tasks from the mode heatmap (ADR-0014)', async () => {
      const { ctx, executeCalls } = createStatsCtx([[]]);
      await statsRouter.createCaller(ctx).activityHeatmap({ range: '30d', dimension: 'mode' });
      const { sql: q } = renderSql(executeCalls[0]);
      expect(q).toContain("task_visibility_mode != 'unlisted'");
    });
  });

  describe("dimension='hourOfWeek'", () => {
    it('returns 7 day rowKeys, 24 hour colKeys, and per-(dow,hour) cells with volume 0', async () => {
      const rows = [
        { row: 1, col: 9, c: 4 },
        { row: 6, col: 23, c: 2 },
      ];
      const { ctx } = createStatsCtx([rows]);

      const result = await statsRouter
        .createCaller(ctx)
        .activityHeatmap({ range: '30d', dimension: 'hourOfWeek' });

      expect(result.rowKeys).toEqual(['0', '1', '2', '3', '4', '5', '6']);
      expect(result.colKeys).toEqual(Array.from({ length: 24 }, (_, h) => String(h)));
      expect(result.cells).toEqual([
        { row: '1', col: '9', count: 4, volume: '0' },
        { row: '6', col: '23', count: 2, volume: '0' },
      ]);
      expect(result.maxCount).toBe(4);
      // volume is not meaningful here and is the string '0'.
      expect(result.cells.every((cell) => cell.volume === '0')).toBe(true);
    });

    it('returns maxCount 0 and no cells when there is no activity', async () => {
      const { ctx } = createStatsCtx([[]]);

      const result = await statsRouter
        .createCaller(ctx)
        .activityHeatmap({ range: '7d', dimension: 'hourOfWeek' });

      expect(result.cells).toEqual([]);
      expect(result.maxCount).toBe(0);
      expect(result.rowKeys).toHaveLength(7);
      expect(result.colKeys).toHaveLength(24);
    });

    it('unions the engagement sources, guards null timestamps, and extracts dow/hour in UTC', async () => {
      const { ctx, executeCalls } = createStatsCtx([[]]);

      await statsRouter
        .createCaller(ctx)
        .activityHeatmap({ range: '30d', dimension: 'hourOfWeek' });

      const { sql: q } = renderSql(executeCalls[0]);
      const norm = q.toLowerCase();
      // All five engagement tables are unioned.
      expect(norm).toContain('submissions');
      expect(norm).toContain('proposals');
      expect(norm).toContain('proofs');
      expect(norm).toContain('claims');
      expect(norm).toContain('bids');
      // Null timestamps are guarded.
      expect(norm).toContain('is not null');
      // Day-of-week and hour extracted in UTC.
      expect(norm).toContain('extract(dow from');
      expect(norm).toContain('extract(hour from');
      expect(norm).toContain("at time zone 'utc'");
    });

    it("for range='all' on hourOfWeek does not apply a range filter", async () => {
      const { ctx, executeCalls } = createStatsCtx([[]]);

      await statsRouter
        .createCaller(ctx)
        .activityHeatmap({ range: 'all', dimension: 'hourOfWeek' });

      const { sql: q } = renderSql(executeCalls[0]);
      const norm = q.toLowerCase();
      // No range interval clause when range is 'all'.
      expect(norm).not.toContain("interval '30 days'");
    });
  });

  it('defaults to dimension=mode and range=30d', async () => {
    const { ctx, executeCalls } = createStatsCtx([[]]);

    const result = await statsRouter.createCaller(ctx).activityHeatmap({});

    expect(result.rowKeys).toEqual(['bounty', 'claim', 'pitch', 'benchmark', 'auction']);
    const { sql: q } = renderSql(executeCalls[0]);
    expect(q.toLowerCase()).toContain("interval '30 days'");
  });
});

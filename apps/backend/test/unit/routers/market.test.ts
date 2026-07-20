import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { createMockCtx, makeChain } from '../helpers';

import { marketRouter } from '../../../src/routers/market.router';

const dialect = new PgDialect();

function renderSql(query: SQL): { sql: string; params: unknown[] } {
  const built = dialect.sqlToQuery(query);
  return { sql: built.sql, params: built.params };
}

describe('market router', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('stats', () => {
    it('returns the three numeric fields coerced to numbers', async () => {
      const ctx = createMockCtx();
      // Calls happen in order: registeredWorkers, openTasks, activeWorkers7d.
      ctx.db.select
        .mockReturnValueOnce(makeChain([{ count: 42 }]))
        .mockReturnValueOnce(makeChain([{ count: 7 }]))
        .mockReturnValueOnce(makeChain([{ count: 5 }]));

      const result = await marketRouter.createCaller(ctx).stats({});

      expect(result).toEqual({
        registeredWorkers: 42,
        activeWorkers7d: 5,
        openTasks: 7,
      });
      expect(typeof result.registeredWorkers).toBe('number');
      expect(typeof result.activeWorkers7d).toBe('number');
      expect(typeof result.openTasks).toBe('number');
    });

    it('coerces string/bigint count rows to JS numbers', async () => {
      const ctx = createMockCtx();
      ctx.db.select
        .mockReturnValueOnce(makeChain([{ count: '12' }]))
        .mockReturnValueOnce(makeChain([{ count: '3' }]))
        .mockReturnValueOnce(makeChain([{ count: 2n }]));

      const result = await marketRouter.createCaller(ctx).stats({});

      expect(result.registeredWorkers).toBe(12);
      expect(result.openTasks).toBe(3);
      expect(result.activeWorkers7d).toBe(2);
    });

    it('defaults to zero when count rows are missing', async () => {
      const ctx = createMockCtx();
      ctx.db.select
        .mockReturnValueOnce(makeChain([]))
        .mockReturnValueOnce(makeChain([]))
        .mockReturnValueOnce(makeChain([]));

      const result = await marketRouter.createCaller(ctx).stats({});

      expect(result).toEqual({ registeredWorkers: 0, activeWorkers7d: 0, openTasks: 0 });
    });

    it('counts distinct workers across engagement tables via UNION', async () => {
      const ctx = createMockCtx();

      // Capture the SQL passed to the third select's .from() call.
      let activeWorkersFromSql: SQL | undefined;
      const activeWorkersChain = makeChain([{ count: 5 }]);
      activeWorkersChain.from = vi.fn((arg: SQL) => {
        activeWorkersFromSql = arg;
        return activeWorkersChain;
      });

      ctx.db.select
        .mockReturnValueOnce(makeChain([{ count: 1 }]))
        .mockReturnValueOnce(makeChain([{ count: 1 }]))
        .mockReturnValueOnce(activeWorkersChain);

      await marketRouter.createCaller(ctx).stats({});

      expect(activeWorkersFromSql).toBeDefined();
      const { sql: fromSql } = renderSql(activeWorkersFromSql!);
      const normalized = fromSql.toLowerCase();

      // UNION (not UNION ALL) dedupes addresses appearing in multiple tables,
      // so each distinct worker is counted exactly once.
      expect(normalized).toContain('union');
      expect(normalized).not.toContain('union all');
      // All engagement tables are included.
      expect(normalized).toContain('submissions');
      expect(normalized).toContain('proposals');
      expect(normalized).toContain('proofs');
      expect(normalized).toContain('claims');
      expect(normalized).toContain('bids');
    });

    it('includes benchmark proof submissions as active worker activity', async () => {
      const ctx = createMockCtx();

      let activeWorkersFromSql: SQL | undefined;
      const activeWorkersChain = makeChain([{ count: 5 }]);
      activeWorkersChain.from = vi.fn((arg: SQL) => {
        activeWorkersFromSql = arg;
        return activeWorkersChain;
      });

      ctx.db.select
        .mockReturnValueOnce(makeChain([{ count: 1 }]))
        .mockReturnValueOnce(makeChain([{ count: 1 }]))
        .mockReturnValueOnce(activeWorkersChain);

      await marketRouter.createCaller(ctx).stats({});

      expect(activeWorkersFromSql).toBeDefined();
      const { sql: fromSql } = renderSql(activeWorkersFromSql!);
      const normalized = fromSql.toLowerCase();

      expect(normalized).toContain('proofs');
      expect(normalized).toContain('submitted_at');
    });

    it('uses count(distinct ...) so a worker active in multiple tables is counted once', async () => {
      const ctx = createMockCtx();

      let activeWorkersCountSelect: Record<string, SQL> | undefined;
      const activeWorkersChain = makeChain([{ count: 5 }]);
      const originalSelect = ctx.db.select;
      // Intercept only the third select to capture its projection.
      let callIndex = 0;
      ctx.db.select = vi.fn((arg?: Record<string, SQL>) => {
        callIndex += 1;
        if (callIndex === 3) {
          activeWorkersCountSelect = arg;
          return activeWorkersChain;
        }
        return makeChain([{ count: 1 }]);
      });

      await marketRouter.createCaller(ctx).stats({});
      ctx.db.select = originalSelect;

      expect(activeWorkersCountSelect).toBeDefined();
      const { sql: countSql } = renderSql(activeWorkersCountSelect!.count);
      expect(countSql.toLowerCase()).toContain('count(distinct');
    });

    it('excludes unlisted tasks from the openTasks count (ADR-0014)', async () => {
      const ctx = createMockCtx();

      let openTasksWhereSql: SQL | undefined;
      const openTasksChain = makeChain([{ count: 7 }]);
      openTasksChain.where = vi.fn((arg: SQL) => {
        openTasksWhereSql = arg;
        return openTasksChain;
      });

      ctx.db.select
        .mockReturnValueOnce(makeChain([{ count: 1 }]))
        .mockReturnValueOnce(openTasksChain)
        .mockReturnValueOnce(makeChain([{ count: 1 }]));

      await marketRouter.createCaller(ctx).stats({});

      expect(openTasksWhereSql).toBeDefined();
      const { sql: whereSql } = renderSql(openTasksWhereSql!);
      expect(whereSql).toContain('"tasks"."task_visibility" <>');
    });

    it('excludes activity older than 7 days via a recent cutoff bound parameter', async () => {
      const ctx = createMockCtx();

      let activeWorkersFromSql: SQL | undefined;
      const activeWorkersChain = makeChain([{ count: 5 }]);
      activeWorkersChain.from = vi.fn((arg: SQL) => {
        activeWorkersFromSql = arg;
        return activeWorkersChain;
      });

      ctx.db.select
        .mockReturnValueOnce(makeChain([{ count: 1 }]))
        .mockReturnValueOnce(makeChain([{ count: 1 }]))
        .mockReturnValueOnce(activeWorkersChain);

      const before = Date.now();
      await marketRouter.createCaller(ctx).stats({});
      const after = Date.now();

      expect(activeWorkersFromSql).toBeDefined();
      const { sql: fromSql, params } = renderSql(activeWorkersFromSql!);

      // The window is enforced with a >= cutoff on each table's timestamp column.
      expect(fromSql.toLowerCase()).toContain('>=');

      // The cutoff is supplied as a bound parameter (one per table) equal to
      // "now minus 7 days", so any activity before that window is excluded.
      const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
      const cutoffParams = params.filter((p): p is Date => p instanceof Date);
      expect(cutoffParams.length).toBeGreaterThan(0);
      for (const cutoff of cutoffParams) {
        const cutoffMs = cutoff.getTime();
        expect(cutoffMs).toBeGreaterThanOrEqual(before - sevenDaysMs - 1000);
        expect(cutoffMs).toBeLessThanOrEqual(after - sevenDaysMs + 1000);
      }

      // A timestamp from 8 days ago falls before the cutoff and is excluded.
      const eightDaysAgo = after - 8 * 24 * 60 * 60 * 1000;
      for (const cutoff of cutoffParams) {
        expect(eightDaysAgo).toBeLessThan(cutoff.getTime());
      }
    });
  });
});

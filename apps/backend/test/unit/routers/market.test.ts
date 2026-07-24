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
    it('returns the existing market stats plus weekly active registered agents', async () => {
      const ctx = createMockCtx();
      // Calls happen in order: registeredWorkers, openTasks, then both activity metrics.
      ctx.db.select
        .mockReturnValueOnce(makeChain([{ count: 42 }]))
        .mockReturnValueOnce(makeChain([{ count: 7 }]))
        .mockReturnValueOnce(makeChain([{ activeAgents7d: 3, activeWorkers7d: 5 }]));

      const result = await marketRouter.createCaller(ctx).stats({});

      expect(result).toEqual({
        registeredWorkers: 42,
        activeWorkers7d: 5,
        activeAgents7d: 3,
        openTasks: 7,
      });
      expect(typeof result.registeredWorkers).toBe('number');
      expect(typeof result.activeWorkers7d).toBe('number');
      expect(typeof result.activeAgents7d).toBe('number');
      expect(typeof result.openTasks).toBe('number');
    });

    it('coerces string/bigint count rows to JS numbers', async () => {
      const ctx = createMockCtx();
      ctx.db.select
        .mockReturnValueOnce(makeChain([{ count: '12' }]))
        .mockReturnValueOnce(makeChain([{ count: '3' }]))
        .mockReturnValueOnce(makeChain([{ activeAgents7d: '4', activeWorkers7d: 2n }]));

      const result = await marketRouter.createCaller(ctx).stats({});

      expect(result.registeredWorkers).toBe(12);
      expect(result.openTasks).toBe(3);
      expect(result.activeWorkers7d).toBe(2);
      expect(result.activeAgents7d).toBe(4);
    });

    it('defaults to zero when count rows are missing', async () => {
      const ctx = createMockCtx();
      ctx.db.select
        .mockReturnValueOnce(makeChain([]))
        .mockReturnValueOnce(makeChain([]))
        .mockReturnValueOnce(makeChain([]));

      const result = await marketRouter.createCaller(ctx).stats({});

      expect(result).toEqual({
        registeredWorkers: 0,
        activeWorkers7d: 0,
        activeAgents7d: 0,
        openTasks: 0,
      });
    });

    it('counts distinct activity across requester and worker sources in one query', async () => {
      const ctx = createMockCtx();

      // Capture the SQL passed to the third select's .from() call.
      let activeWorkersFromSql: SQL | undefined;
      const activeWorkersChain = makeChain([{ activeAgents7d: 6, activeWorkers7d: 5 }]);
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

      // UNION ALL keeps the source scan simple; each projection applies its
      // own count(distinct ...) with the appropriate normalization rules.
      expect(normalized).toContain('union all');
      expect(normalized).toContain('requester');
      expect(normalized).toContain('submissions');
      expect(normalized).toContain('proposals');
      expect(normalized).toContain('proofs');
      expect(normalized).toContain('claims');
      expect(normalized).toContain('bids');
    });

    it('includes benchmark proof submissions as active worker activity', async () => {
      const ctx = createMockCtx();

      let activeWorkersFromSql: SQL | undefined;
      const activeWorkersChain = makeChain([{ activeAgents7d: 6, activeWorkers7d: 5 }]);
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
      const activeWorkersChain = makeChain([{ activeAgents7d: 6, activeWorkers7d: 5 }]);
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
      const { sql: countSql } = renderSql(activeWorkersCountSelect!.activeWorkers7d);
      expect(countSql.toLowerCase()).toContain('count(distinct');
    });

    it('normalizes active agent addresses and only counts registered agents', async () => {
      const ctx = createMockCtx();

      let activityProjection: Record<string, SQL> | undefined;
      let activityJoinSql: SQL | undefined;
      const activityChain = makeChain([{ activeAgents7d: 6, activeWorkers7d: 5 }]);
      activityChain.leftJoin = vi.fn((_table: unknown, predicate: SQL) => {
        activityJoinSql = predicate;
        return activityChain;
      });

      let callIndex = 0;
      ctx.db.select = vi.fn((projection?: Record<string, SQL>) => {
        callIndex += 1;
        if (callIndex === 3) {
          activityProjection = projection;
          return activityChain;
        }
        return makeChain([{ count: 1 }]);
      });

      await marketRouter.createCaller(ctx).stats({});

      expect(activityProjection).toBeDefined();
      expect(activityJoinSql).toBeDefined();
      expect(renderSql(activityProjection!.activeAgents7d).sql.toLowerCase()).toContain(
        'count(distinct lower(active_activity.agent_address))'
      );
      expect(renderSql(activityJoinSql!).sql.toLowerCase()).toContain(
        'lower("agents"."address") = lower(active_activity.agent_address)'
      );
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
      expect(whereSql).toContain('"tasks"."task_visibility" not in');
    });

    it('excludes unlisted-task activity from activeWorkers7d (ADR-0014)', async () => {
      const ctx = createMockCtx();

      let activeWorkersFromSql: SQL | undefined;
      const activeWorkersChain = makeChain([{ activeAgents7d: 6, activeWorkers7d: 5 }]);
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

      // Every engagement table is now joined back to tasks so unlisted/private-task
      // activity can't count toward the public active-workers figure.
      expect(normalized).toContain("task_visibility not in ('unlisted', 'private')");
      const joinCount = (normalized.match(/join tasks t on t\.id/g) ?? []).length;
      expect(joinCount).toBe(5);
    });

    it('excludes activity older than 7 days via a recent cutoff bound parameter', async () => {
      const ctx = createMockCtx();

      let activeWorkersFromSql: SQL | undefined;
      const activeWorkersChain = makeChain([{ activeAgents7d: 6, activeWorkers7d: 5 }]);
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
      // Passed as an ISO string, not a raw Date -- a bare Date interpolated
      // where the placeholder only appears inside nested UNION branches (as
      // it does here) crashes postgres.js's type inference (see
      // market.router.ts's comment on `since`); an ISO string sidesteps that
      // and round-trips through Postgres's own timestamptz parsing.
      const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
      const cutoffParams = params.filter((p): p is string => typeof p === 'string');
      expect(cutoffParams.length).toBeGreaterThan(0);
      for (const cutoff of cutoffParams) {
        const cutoffMs = new Date(cutoff).getTime();
        expect(cutoffMs).toBeGreaterThanOrEqual(before - sevenDaysMs - 1000);
        expect(cutoffMs).toBeLessThanOrEqual(after - sevenDaysMs + 1000);
      }

      // A timestamp from 8 days ago falls before the cutoff and is excluded.
      const eightDaysAgo = after - 8 * 24 * 60 * 60 * 1000;
      for (const cutoff of cutoffParams) {
        expect(eightDaysAgo).toBeLessThan(new Date(cutoff).getTime());
      }
    });
  });
});

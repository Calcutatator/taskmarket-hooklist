import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { computeTaskPhase } from '../../../src/lib/task';
import { hooksRouter } from '../../../src/routers/hooks.router';
import { createMockCtx } from '../helpers';

const dialect = new PgDialect();
const hook = '0x1111111111111111111111111111111111111111';
const secondHook = '0x2222222222222222222222222222222222222222';
const thirdHook = '0x3333333333333333333333333333333333333333';

type AggregateRow = {
  address: string;
  activePhaseTaskCount: number | string;
  modes: string[];
  taskCount: number | string;
  taskIds: string[];
};

function aggregate(overrides: Partial<AggregateRow> = {}): AggregateRow {
  return {
    address: hook,
    activePhaseTaskCount: 2,
    modes: ['bounty', 'claim'],
    taskCount: 3,
    taskIds: ['task-3', 'task-2', 'task-1'],
    ...overrides,
  };
}

function renderSql(query: SQL): { sql: string; params: unknown[] } {
  const built = dialect.sqlToQuery(query);
  return { sql: built.sql.replace(/\s+/g, ' ').trim(), params: built.params };
}

function executedQuery(ctx: ReturnType<typeof createMockCtx>): { sql: string; params: unknown[] } {
  const query = ctx.db.execute.mock.calls[0]?.[0] as SQL | undefined;
  expect(query).toBeDefined();
  return renderSql(query!);
}

describe('hooks router', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns a bounded aggregate page with hasMore and at most eight latest task IDs', async () => {
    const ctx = createMockCtx();
    ctx.db.execute.mockResolvedValue([
      aggregate({
        taskCount: '12',
        taskIds: Array.from({ length: 10 }, (_, index) => `task-${10 - index}`),
      }),
      aggregate({ address: secondHook, modes: ['auction'], taskCount: 2 }),
      aggregate({ address: thirdHook, modes: ['pitch'], taskCount: 1 }),
    ]);

    await expect(hooksRouter.createCaller(ctx).list({ limit: 2 })).resolves.toEqual({
      hooks: [
        {
          address: hook,
          activePhaseTaskCount: 2,
          modes: ['bounty', 'claim'],
          taskCount: 12,
          taskIds: [
            'task-10',
            'task-9',
            'task-8',
            'task-7',
            'task-6',
            'task-5',
            'task-4',
            'task-3',
          ],
        },
        {
          address: secondHook,
          activePhaseTaskCount: 2,
          modes: ['auction'],
          taskCount: 2,
          taskIds: ['task-3', 'task-2', 'task-1'],
        },
      ],
      hasMore: true,
      observation: 'current-task-projection-one-effective-hook-per-task',
    });

    expect(ctx.db.select).not.toHaveBeenCalled();
    const query = executedQuery(ctx);
    expect(query.params.at(-1)).toBe(3);
    expect(query.params).toContain(8);
    expect(query.sql).toContain('where task_id_rank <=');
    expect(query.sql).toContain('limit');
  });

  it('groups addresses case-insensitively and mirrors computeTaskPhase in SQL', async () => {
    vi.useFakeTimers();
    const now = new Date('2026-08-22T12:00:00.000Z');
    vi.setSystemTime(now);
    const ctx = createMockCtx();
    ctx.db.execute.mockResolvedValue([]);

    try {
      await expect(hooksRouter.createCaller(ctx).list({})).resolves.toEqual({
        hooks: [],
        hasMore: false,
        observation: 'current-task-projection-one-effective-hook-per-task',
      });
    } finally {
      vi.useRealTimers();
    }

    const query = executedQuery(ctx);
    expect(query.sql).toContain('lower("tasks"."hook_contract") as address');
    expect(query.sql).toContain('partition by lower("tasks"."hook_contract")');
    expect(query.sql).toContain('group by address');
    expect(query.sql).toContain('array_agg(distinct mode order by mode)');
    expect(query.sql).toContain('order by "taskCount" desc, address asc');
    expect(query.sql).toMatch(
      /case when .*status.* in \([^)]*\) then false when .*status.* in \([^)]*\) then false when .*status.* in \([^)]*\) then .*expiry_time.* > .* else true end/
    );
    expect(query.params).toEqual(
      expect.arrayContaining([
        'review',
        'appealing',
        'disputed',
        'completed',
        'cancelled',
        'expired',
        'open',
        'claimed',
        'worker_selected',
        now,
        'unlisted',
        'private',
      ])
    );
    expect(query.params.at(-1)).toBe(51);

    const future = new Date('2026-08-23T12:00:00.000Z');
    const past = new Date('2026-08-21T12:00:00.000Z');
    expect(
      [
        { status: 'open', expiryTime: future },
        { status: 'pending_approval', expiryTime: past },
        { status: 'review', expiryTime: future },
        { status: 'disputed', expiryTime: future },
        { status: 'open', expiryTime: past },
        { status: 'completed', expiryTime: future },
      ].map((task) => computeTaskPhase({ ...task, mode: 'bounty' }, now))
    ).toEqual(['active', 'active', 'in_review', 'in_review', 'awaiting_settlement', 'resolved']);
  });

  it('queries one address directly, canonicalizes its casing, and returns the entry', async () => {
    const ctx = createMockCtx();
    ctx.db.execute.mockResolvedValue([
      aggregate({ address: `0x${hook.slice(2).toUpperCase()}`, activePhaseTaskCount: '2' }),
    ]);

    await expect(
      hooksRouter.createCaller(ctx).get({ address: `0x${hook.slice(2).toUpperCase()}` })
    ).resolves.toEqual({
      address: hook,
      activePhaseTaskCount: 2,
      modes: ['bounty', 'claim'],
      taskCount: 3,
      taskIds: ['task-3', 'task-2', 'task-1'],
    });

    const query = executedQuery(ctx);
    expect(query.sql).toContain('and lower("tasks"."hook_contract") =');
    expect(query.params).toContain(hook);
    expect(query.params.at(-1)).toBe(1);
  });

  it('returns null when a well-formed address has no discoverable current projection', async () => {
    const ctx = createMockCtx();
    ctx.db.execute.mockResolvedValue([]);

    await expect(hooksRouter.createCaller(ctx).get({ address: hook })).resolves.toBeNull();
    expect(ctx.db.execute).toHaveBeenCalledTimes(1);
  });

  it('rejects malformed addresses before querying the database', async () => {
    const ctx = createMockCtx();

    await expect(
      hooksRouter.createCaller(ctx).get({ address: 'not-an-address' })
    ).rejects.toThrow();
    expect(ctx.db.execute).not.toHaveBeenCalled();
  });

  it('rejects the zero address before querying the database', async () => {
    const ctx = createMockCtx();

    await expect(
      hooksRouter.createCaller(ctx).get({ address: '0x0000000000000000000000000000000000000000' })
    ).rejects.toThrow('Hook address must be a non-zero 20-byte hex address');
    expect(ctx.db.execute).not.toHaveBeenCalled();
  });
});

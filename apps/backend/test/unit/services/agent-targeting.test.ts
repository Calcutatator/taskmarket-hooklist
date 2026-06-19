import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { createMockCtx, makeChain } from '../helpers';

import { selectTargetAgents } from '../../../src/services/agent-targeting';

const dialect = new PgDialect();

function captureWhere(filters?: Parameters<typeof selectTargetAgents>[1]) {
  const chain = makeChain([]);
  const ctx = createMockCtx();
  ctx.db.select.mockReturnValueOnce(chain);
  return selectTargetAgents(ctx.db, filters).then(() => {
    const whereArg = chain.where.mock.calls[0][0] as SQL;
    return dialect.sqlToQuery(whereArg);
  });
}

describe('agent-targeting', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('always restricts to agents with a non-null email address', async () => {
    const query = await captureWhere();
    expect(query.sql.toLowerCase()).toContain('email_address');
    expect(query.sql.toLowerCase()).toContain('is not null');
  });

  it('adds an ANY condition per requested skill', async () => {
    const query = await captureWhere({ skills: ['design', 'logo'] });
    const anyCount = (query.sql.match(/= any/gi) ?? []).length;
    expect(anyCount).toBe(2);
    expect(query.params).toContain('design');
    expect(query.params).toContain('logo');
  });

  it('adds a completedTasks >= condition for minTasks', async () => {
    const query = await captureWhere({ minTasks: 5 });
    expect(query.sql.toLowerCase()).toContain('completed_tasks');
    expect(query.sql).toContain('>=');
    expect(query.params).toContain(5);
  });

  it("maps actorType 'human' to registeredVia = 'web'", async () => {
    const query = await captureWhere({ actorType: 'human' });
    expect(query.sql.toLowerCase()).toContain('registered_via');
    expect(query.params).toContain('web');
  });

  it("maps actorType 'agent' to registeredVia = 'cli'", async () => {
    const query = await captureWhere({ actorType: 'agent' });
    expect(query.params).toContain('cli');
  });

  it("does not constrain actorType when 'all'", async () => {
    const query = await captureWhere({ actorType: 'all' });
    expect(query.sql.toLowerCase()).not.toContain('registered_via');
  });

  it('returns rows with non-null email addresses', async () => {
    const ctx = createMockCtx();
    ctx.db.select.mockReturnValueOnce(
      makeChain([
        { address: '0xa', emailAddress: 'a@mail.taskmarket.xyz' },
        { address: '0xb', emailAddress: 'b@mail.taskmarket.xyz' },
      ])
    );

    const result = await selectTargetAgents(ctx.db);

    expect(result).toEqual([
      { address: '0xa', emailAddress: 'a@mail.taskmarket.xyz' },
      { address: '0xb', emailAddress: 'b@mail.taskmarket.xyz' },
    ]);
  });
});

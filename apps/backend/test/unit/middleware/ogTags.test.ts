import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import type { NextFunction } from 'express';

/**
 * Renders a drizzle condition to real Postgres SQL text so assertions check the actual
 * query taskmarket would send, not just that mocked rows happen to render correctly.
 * This is what lets these tests catch a future regression where someone drops the
 * taskNotUnlisted filter from a query -- a test that only supplies pre-filtered mock rows
 * would stay green even if the real code never filtered anything.
 */
function renderSql(condition: SQL | undefined): { sql: string; params: unknown[] } {
  if (!condition) throw new Error('Expected a where condition, got undefined');
  return new PgDialect().sqlToQuery(condition);
}

// Chainable, thenable query builder mock: every method returns itself, and awaiting the
// chain at any point (matching ogTags.ts, which always terminates on .limit(...)) resolves
// to whatever rows this instance was built with.
interface FakeChain {
  from: (...args: unknown[]) => FakeChain;
  where: (cond: unknown) => FakeChain;
  orderBy: (...args: unknown[]) => FakeChain;
  limit: (...args: unknown[]) => FakeChain;
  then: (resolve: (v: unknown[]) => void) => void;
  whereCalls: unknown[];
}

function makeChain(rows: unknown[]): FakeChain {
  const whereCalls: unknown[] = [];
  const chain: FakeChain = {
    from: vi.fn(() => chain),
    where: vi.fn((cond: unknown) => {
      whereCalls.push(cond);
      return chain;
    }),
    orderBy: vi.fn(() => chain),
    limit: vi.fn(() => chain),
    then: (resolve: (v: unknown[]) => void) => resolve(rows),
    whereCalls,
  };
  return chain;
}

function fakeNext(): NextFunction {
  return vi.fn() as unknown as NextFunction;
}

const { selectMock } = vi.hoisted(() => ({ selectMock: vi.fn() }));

vi.mock('../../../src/db/client', () => ({ db: { select: selectMock } }));

vi.mock('../../../src/lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const { ogTagsMiddleware } = await import('../../../src/middleware/ogTags');
const { taskNotUnlisted } = await import('../../../src/lib/task-visibility');

function fakeReq(path: string, userAgent: string | undefined) {
  return { path, headers: { 'user-agent': userAgent } } as unknown as Parameters<
    typeof ogTagsMiddleware
  >[0];
}

function fakeRes() {
  let body = '';
  const res = {
    setHeader: vi.fn(),
    send: vi.fn((html: string) => {
      body = html;
    }),
    body: () => body,
  };
  return res as unknown as Parameters<typeof ogTagsMiddleware>[1] & { body: () => string };
}

const BOT_UA = 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';
const HUMAN_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36';

const PUBLIC_TASK = {
  id: 'task-public',
  description: 'PUBLIC-TASK-MARKER write a haiku about USDC',
  reward: '1000000',
  mode: 'bounty',
  tags: [],
  status: 'open',
};

const UNLISTED_TASK = {
  id: 'task-unlisted',
  description: 'UNLISTED-TASK-MARKER a secret internal task',
  reward: '2000000',
  mode: 'bounty',
  tags: [],
  status: 'open',
};

describe('ogTagsMiddleware', () => {
  beforeEach(() => {
    selectMock.mockReset();
  });

  it('skips entirely for non-bot user agents (no DB query at all)', async () => {
    const req = fakeReq('/', HUMAN_UA);
    const res = fakeRes();
    const next = vi.fn();

    await ogTagsMiddleware(req, res, next as unknown as NextFunction);

    expect(next).toHaveBeenCalledOnce();
    expect(selectMock).not.toHaveBeenCalled();
    expect(res.send).not.toHaveBeenCalled();
  });

  it('homepage query filters on the real taskNotUnlisted condition, and the rendered body omits an unlisted task even if the DB layer misbehaved and returned one', async () => {
    // Deliberately return BOTH tasks, as if the WHERE clause did nothing -- this is the
    // test that actually catches a dropped filter, rather than trusting the mock rows
    // are already correctly filtered.
    const chain = makeChain([PUBLIC_TASK, UNLISTED_TASK]);
    selectMock.mockReturnValue(chain);

    const req = fakeReq('/', BOT_UA);
    const res = fakeRes();
    await ogTagsMiddleware(req, res, fakeNext());

    const [condition] = chain.whereCalls;
    const rendered = renderSql(condition as SQL);
    expect(rendered.sql).toContain('task_visibility');
    expect(rendered.params).toContain('unlisted');

    // The condition actually used must be built from the shared taskNotUnlisted export,
    // not a look-alike inline condition -- render taskNotUnlisted alone and confirm its
    // SQL shape (column + operator, ignoring positional $N placeholder numbering, which
    // shifts depending on where the condition sits inside a larger AND) is a substring of
    // the full where-clause SQL.
    const sharedFilterRendered = renderSql(taskNotUnlisted).sql.replace(/\$\d+/g, '$N');
    expect(rendered.sql.replace(/\$\d+/g, '$N')).toContain(sharedFilterRendered);
  });

  it('tasks list query also uses the real taskNotUnlisted condition', async () => {
    const chain = makeChain([PUBLIC_TASK, UNLISTED_TASK]);
    selectMock.mockReturnValue(chain);

    const req = fakeReq('/tasks', BOT_UA);
    const res = fakeRes();
    await ogTagsMiddleware(req, res, fakeNext());

    const [condition] = chain.whereCalls;
    const rendered = renderSql(condition as SQL);
    expect(rendered.sql).toContain('task_visibility');
    expect(rendered.params).toContain('unlisted');
  });

  it('direct task-detail request for an unlisted task never renders its title or description', async () => {
    // Simulates the real DB behavior: the taskNotUnlisted-gated query returns zero rows
    // for an unlisted task id, exactly as Postgres would.
    const chain = makeChain([]);
    selectMock.mockReturnValue(chain);

    const req = fakeReq(`/tasks/${UNLISTED_TASK.id}`, BOT_UA);
    const res = fakeRes();
    await ogTagsMiddleware(req, res, fakeNext());

    const [condition] = chain.whereCalls;
    const rendered = renderSql(condition as SQL);
    expect(rendered.sql).toContain('task_visibility');

    expect(res.body()).not.toContain('UNLISTED-TASK-MARKER');
    // Falls back to the generic /tasks static meta, not a 404 or an empty/broken page.
    expect(res.body()).toContain('Browse open tasks');
  });

  it('direct task-detail request for a public task renders its real title and description', async () => {
    const chain = makeChain([PUBLIC_TASK]);
    selectMock.mockReturnValue(chain);

    const req = fakeReq(`/tasks/${PUBLIC_TASK.id}`, BOT_UA);
    const res = fakeRes();
    await ogTagsMiddleware(req, res, fakeNext());

    expect(res.body()).toContain('PUBLIC-TASK-MARKER');
  });

  it('falls back to generic meta (not a crash) when the DB query throws', async () => {
    const chain = makeChain([]);
    chain.then = () => {
      throw new Error('connection lost');
    };
    selectMock.mockReturnValue(chain);

    const req = fakeReq('/', BOT_UA);
    const res = fakeRes();
    await expect(ogTagsMiddleware(req, res, fakeNext())).resolves.not.toThrow();
    expect(res.send).toHaveBeenCalledOnce();
  });

  it('agent routes query the agents table with no task-visibility filter at all (no visibility concept for agents)', async () => {
    const chain = makeChain([
      {
        agentId: '1',
        address: '0xabc',
        completedTasks: 3,
        ratedTasks: 2,
        totalStars: 9,
        skills: [],
      },
    ]);
    selectMock.mockReturnValue(chain);

    const req = fakeReq('/agents', BOT_UA);
    const res = fakeRes();
    await ogTagsMiddleware(req, res, fakeNext());

    // buildAgentsBody has no .where() call at all -- asserting that stays true guards
    // against someone accidentally bolting task-visibility semantics onto agent data.
    expect(chain.where).not.toHaveBeenCalled();
  });

  it('unmatched paths call next() without touching the DB', async () => {
    const req = fakeReq('/some/unknown/route', BOT_UA);
    const res = fakeRes();
    const next = vi.fn();

    await ogTagsMiddleware(req, res, next as unknown as NextFunction);

    expect(next).toHaveBeenCalledOnce();
    expect(selectMock).not.toHaveBeenCalled();
  });
});

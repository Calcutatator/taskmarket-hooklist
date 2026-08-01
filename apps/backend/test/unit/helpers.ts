import { vi } from 'vitest';

/**
 * Creates a chainable Drizzle-like query object that resolves to `resolveValue`
 * when awaited.  All chain methods (from, where, limit, etc.) return `this`
 * so callers can freely chain them before awaiting.
 */
export function makeChain(resolveValue: any = undefined) {
  const chain: any = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    offset: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    groupBy: vi.fn().mockReturnThis(),
    having: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    returning: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    onConflictDoUpdate: vi.fn().mockReturnThis(),
    onConflictDoNothing: vi.fn().mockReturnThis(),
    leftJoin: vi.fn().mockReturnThis(),
    innerJoin: vi.fn().mockReturnThis(),
    rightJoin: vi.fn().mockReturnThis(),
    fullJoin: vi.fn().mockReturnThis(),
    for: vi.fn().mockReturnThis(),
    // Thenable so that `await chain` resolves correctly
    then: (onfulfilled: any, onrejected?: any) =>
      Promise.resolve(resolveValue).then(onfulfilled, onrejected),
    catch: (onrejected: any) => Promise.resolve(resolveValue).catch(onrejected),
    finally: (onfinally: any) => Promise.resolve(resolveValue).finally(onfinally),
  };
  return chain;
}

/**
 * Returns a mock tRPC context.  The `db` property exposes `select`, `insert`,
 * and `update` as vi.fn() instances whose default return value is an empty
 * chain.  Individual tests override specific calls with:
 *   ctx.db.select.mockReturnValueOnce(makeChain([...data]))
 */
export function createMockCtx(
  payer?: string,
  caller?: { address: string },
  taskAccessGrant?: { taskId: string }
) {
  const db: any = {
    select: vi.fn().mockReturnValue(makeChain([])),
    insert: vi.fn().mockReturnValue(makeChain()),
    update: vi.fn().mockReturnValue(makeChain([])),
    delete: vi.fn().mockReturnValue(makeChain()),
    // Real drizzle transactions support raw sql via .execute() (see e.g.
    // scripts/normalize-address-casing.ts) -- used by
    // assertUnderHardSubmissionCeilingForInsert's advisory lock. Resolves to an
    // empty result by default; tests exercising the ceiling itself override this.
    execute: vi.fn().mockResolvedValue([]),
    transaction: vi.fn(async (callback: (tx: any) => Promise<unknown>) => callback(db)),
  };

  return {
    db,
    req: {} as any,
    res: { locals: { payer: payer ?? undefined }, setHeader: vi.fn(), vary: vi.fn() } as any,
    caller,
    taskAccessGrant,
  };
}

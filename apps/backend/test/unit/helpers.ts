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
export function createMockCtx(payer?: string) {
  const db: any = {
    select: vi.fn().mockReturnValue(makeChain([])),
    insert: vi.fn().mockReturnValue(makeChain()),
    update: vi.fn().mockReturnValue(makeChain([])),
    delete: vi.fn().mockReturnValue(makeChain()),
    transaction: vi.fn(async (callback: (tx: any) => Promise<unknown>) => callback(db)),
  };

  return {
    db,
    req: {} as any,
    res: { locals: { payer: payer ?? undefined }, setHeader: vi.fn(), vary: vi.fn() } as any,
  };
}

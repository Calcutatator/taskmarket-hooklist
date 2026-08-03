import { vi } from 'vitest';

import { relayedIntents } from '../../src/db/schema';

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

/**
 * A mock context for a paid mutation, which now records a durable intent before its chain
 * call and runs its post-receipt work through the intent registry (ADR-0045).
 *
 * Neither survives the default empty chains: recording reads the inserted row back, and
 * completion claims the intent with a conditional UPDATE that must return it. Insert order is
 * also no longer a reliable way to reach a particular table, so this hands out one memoised
 * chain per table alongside a tiny in-memory intent store.
 */
export function createIntentCtx(
  payer?: string,
  caller?: { address: string },
  taskAccessGrant?: { taskId: string }
) {
  const ctx = createMockCtx(payer, caller, taskAccessGrant) as ReturnType<typeof createMockCtx> & {
    insertChain: (table: unknown) => ReturnType<typeof makeChain>;
    updateChain: (table: unknown) => ReturnType<typeof makeChain>;
    seedUpdate: (table: unknown, resolveValue: unknown) => ReturnType<typeof makeChain>;
    intents: Record<string, unknown>[];
  };
  const intents: Record<string, unknown>[] = [];
  const insertChains = new Map<unknown, ReturnType<typeof makeChain>>();
  const updateChains = new Map<unknown, ReturnType<typeof makeChain>>();

  const intentInsert = () => {
    let row: Record<string, unknown> = {};
    const chain: any = {
      onConflictDoNothing: () => chain,
      returning: () => chain,
      values: (values: Record<string, unknown>) => {
        row = { ...values };
        intents.push(row);
        return chain;
      },
      then: (onfulfilled: any, onrejected?: any) =>
        Promise.resolve([row]).then(onfulfilled, onrejected),
    };
    return chain;
  };

  // The claim, the broadcast link and the completion all target the same single intent in
  // these tests, so returning the most recent row is enough to exercise the real path.
  const intentUpdate = () => {
    const chain: any = {
      returning: () => chain,
      set: (values: Record<string, unknown>) => {
        Object.assign(intents[intents.length - 1] ?? {}, values);
        return chain;
      },
      where: () => chain,
      then: (onfulfilled: any, onrejected?: any) =>
        Promise.resolve(intents.slice(-1)).then(onfulfilled, onrejected),
    };
    return chain;
  };

  const chainFor = (
    store: Map<unknown, ReturnType<typeof makeChain>>,
    table: unknown,
    resolveValue?: unknown
  ) => {
    let chain = store.get(table);
    if (!chain) {
      chain = makeChain(resolveValue);
      store.set(table, chain);
    }
    return chain;
  };

  ctx.db.insert = vi.fn((table: unknown) =>
    table === relayedIntents ? intentInsert() : chainFor(insertChains, table)
  );
  ctx.db.update = vi.fn((table: unknown) =>
    table === relayedIntents ? intentUpdate() : chainFor(updateChains, table, [])
  );

  ctx.insertChain = (table: unknown) => chainFor(insertChains, table);
  ctx.updateChain = (table: unknown) => chainFor(updateChains, table, []);
  // A conditional UPDATE that claims a row reads its own .returning() to decide whether it
  // won. Those chains resolve empty by default, so a test exercising the winning branch has
  // to say what the claim returned.
  ctx.seedUpdate = (table: unknown, resolveValue: unknown) => {
    const chain = makeChain(resolveValue);
    updateChains.set(table, chain);
    return chain;
  };
  ctx.intents = intents;
  return ctx;
}

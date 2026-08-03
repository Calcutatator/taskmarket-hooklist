// Verifies: ADR-0045
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { stubServerEnvironment } from '../../helpers/server-environment';

const restoreServerEnvironment = stubServerEnvironment();

const { ServerTransactionPendingError } = await import(
  '../../../src/lib/server-transaction-dispatcher'
);
const { dispatchRelayedIntent, registerRelayedIntentHandler } = await import(
  '../../../src/services/relayed-intent-registry'
);
const { serverWalletTransactions } = await import('../../../src/db/schema');

afterAll(restoreServerEnvironment);

const INTENT_ID = 'intent-assign';
const ASSIGN_TX_HASH = `0x${'cd'.repeat(32)}` as `0x${string}`;

type Row = {
  completionAttempts: number;
  id: string;
  lastError: string | null;
  operation: string;
  payload: unknown;
  status: string;
  txHash: string | null;
};

function row(overrides: Partial<Row> = {}): Row {
  return {
    completionAttempts: 0,
    id: INTENT_ID,
    lastError: null,
    operation: 'tasks.assignEvaluator',
    payload: {},
    status: 'recorded',
    txHash: null,
    ...overrides,
  };
}

/**
 * Drizzle predicates are opaque objects, so the fake resolves an update's target by looking
 * for a known intent id anywhere inside the predicate it was handed. That keeps the fake
 * honest about which row each call actually touches.
 */
function findId(node: unknown, ids: string[], seen = new Set<unknown>()): string | undefined {
  if (typeof node === 'string') return ids.includes(node) ? node : undefined;
  // Drizzle's table/column graph is cyclic, so the walk needs its own visited set.
  if (!node || typeof node !== 'object' || seen.has(node)) return undefined;
  seen.add(node);
  for (const value of Object.values(node as Record<string, unknown>)) {
    const hit = findId(value, ids, seen);
    if (hit) return hit;
  }
  return undefined;
}

function makeDb(rows: Row[]) {
  const ids = rows.map((r) => r.id);

  function thenable<T>(resolve: () => T) {
    const chain = {
      limit: () => chain,
      orderBy: () => chain,
      then: (onfulfilled?: (value: T) => unknown, onrejected?: (reason: unknown) => unknown) =>
        Promise.resolve()
          .then(resolve)
          .then(onfulfilled, onrejected),
      where: () => chain,
    };
    return chain;
  }

  const db = {
    select: (_fields?: unknown) => ({
      from: (table: unknown) => {
        if (table === serverWalletTransactions) return thenable(() => [{ id: 'swt-1' }]);
        return thenable(() => rows.filter((r) => r.status === 'recorded'));
      },
    }),
    update: (_table: unknown) => ({
      set: (values: Record<string, unknown>) => ({
        where: (predicate: unknown) => {
          const targetId = findId(predicate, ids);
          const target = rows.find((r) => r.id === targetId);
          const apply = () => {
            if (!target) return;
            if (typeof values.status === 'string') target.status = values.status;
            if ('lastError' in values) target.lastError = values.lastError as string | null;
            if (typeof values.txHash === 'string') target.txHash = values.txHash;
          };
          const chain = {
            // Mirrors both real conditional claims: completion accepts recorded|broadcast,
            // broadcast accepts recorded only. Both are expressed here as "the row must not
            // already be terminal", which is enough to model losing the race.
            returning: async () => {
              if (!target) return [];
              if (target.status !== 'recorded' && target.status !== 'broadcast') return [];
              target.completionAttempts += 1;
              apply();
              return [{ ...target }];
            },
            then: (onfulfilled?: (value: undefined) => unknown) => {
              apply();
              return Promise.resolve(undefined).then(onfulfilled);
            },
          };
          return chain;
        },
      }),
    }),
  };

  return { db, rows };
}

describe('eager intent dispatch', () => {
  beforeEach(() => {
    registerRelayedIntentHandler('tasks.create', async () => undefined);
  });

  it('broadcasts a recorded intent immediately rather than waiting for the worker', async () => {
    const broadcast = vi.fn().mockResolvedValue(ASSIGN_TX_HASH);
    registerRelayedIntentHandler('tasks.assignEvaluator', {
      broadcast,
      complete: async () => undefined,
    });
    const intent = row();
    const { db } = makeDb([intent]);

    const outcome = await dispatchRelayedIntent({ db: db as never, intent: intent as never });

    // Timing is the point: assignEvaluator is gated on the task still being Open, so an intent
    // that waits for a poll interval loses to any worker agent claiming the task.
    expect(outcome).toBe('broadcast');
    expect(broadcast).toHaveBeenCalledTimes(1);
    expect(intent.status).toBe('broadcast');
    expect(intent.txHash).toBe(ASSIGN_TX_HASH);
  });

  it('marks an intent failed on a deterministic revert instead of retrying forever', async () => {
    const broadcast = vi.fn().mockRejectedValue(new Error('Contract call rejected: TaskNotOpen'));
    registerRelayedIntentHandler('tasks.assignEvaluator', {
      broadcast,
      complete: async () => undefined,
    });
    const intent = row();
    const { db } = makeDb([intent]);

    const outcome = await dispatchRelayedIntent({ db: db as never, intent: intent as never });

    expect(outcome).toBe('failed');
    expect(intent.status).toBe('failed');
    expect(intent.lastError).toContain('TaskNotOpen');

    // Terminal means terminal: a later pass finds nothing to claim and never calls the chain
    // a second time for an answer that cannot change.
    const again = await dispatchRelayedIntent({ db: db as never, intent: intent as never });
    expect(again).toBe('skipped');
    expect(broadcast).toHaveBeenCalledTimes(1);
  });

  it('leaves an intent recorded for retry when the failure is transient', async () => {
    const broadcast = vi
      .fn()
      .mockRejectedValue(new Error('Timed out while waiting for transaction receipt'));
    registerRelayedIntentHandler('tasks.assignEvaluator', {
      broadcast,
      complete: async () => undefined,
    });
    const intent = row();
    const { db } = makeDb([intent]);

    const outcome = await dispatchRelayedIntent({ db: db as never, intent: intent as never });

    expect(outcome).toBe('retry');
    expect(intent.status).toBe('recorded');
    expect(intent.lastError).toContain('Timed out');
  });

  it('records a pending broadcast as in flight rather than sending it a second time', async () => {
    registerRelayedIntentHandler('tasks.assignEvaluator', {
      broadcast: vi.fn().mockRejectedValue(new ServerTransactionPendingError(ASSIGN_TX_HASH, 7)),
      complete: async () => undefined,
    });
    const intent = row();
    const { db } = makeDb([intent]);

    const outcome = await dispatchRelayedIntent({ db: db as never, intent: intent as never });

    // The transaction is live and owned by the reconciler (ADR-0045); rebroadcasting would
    // spend a second nonce assigning the same evaluator.
    expect(outcome).toBe('broadcast');
    expect(intent.status).toBe('broadcast');
    expect(intent.txHash).toBe(ASSIGN_TX_HASH);
  });
});

// Verifies: ADR-0045
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { stubServerEnvironment } from '../../helpers/server-environment';

const restoreServerEnvironment = stubServerEnvironment();

const { ServerTransactionPendingError } = await import(
  '../../../src/lib/server-transaction-dispatcher'
);
const { completeRelayedIntent, dispatchRelayedIntent, registerRelayedIntentHandler } = await import(
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
    expect(intent.txHash).toBe(ASSIGN_TX_HASH);
  });

  it('completes the intent inline when the broadcast returns confirmed', async () => {
    const complete = vi.fn().mockResolvedValue(undefined);
    registerRelayedIntentHandler('tasks.assignEvaluator', {
      broadcast: vi.fn().mockResolvedValue(ASSIGN_TX_HASH),
      complete,
    });
    const intent = row();
    const { db } = makeDb([intent]);

    await dispatchRelayedIntent({ db: db as never, intent: intent as never });

    // A broadcaster that returned normally already awaited its receipt, so its outbox row is
    // `confirmed` -- a status the reconciler's broadcast pass never examines. Without the inline
    // completion the intent is stranded forever with the transaction live on chain.
    expect(complete).toHaveBeenCalledTimes(1);
    expect(intent.status).toBe('completed');
  });

  it('completes the intent exactly once when a reconciler pass sees the same receipt', async () => {
    const complete = vi.fn().mockResolvedValue(undefined);
    registerRelayedIntentHandler('tasks.assignEvaluator', {
      broadcast: vi.fn().mockResolvedValue(ASSIGN_TX_HASH),
      complete,
    });
    const intent = row();
    const { db } = makeDb([intent]);

    await dispatchRelayedIntent({ db: db as never, intent: intent as never });
    // The sweep observes the same confirmed row. The conditional claim is what stops the
    // handler running a second time.
    const settled = await completeRelayedIntent({
      db: db as never,
      intent: intent as never,
      txHash: ASSIGN_TX_HASH,
    });

    expect(settled).toBe(true);
    expect(complete).toHaveBeenCalledTimes(1);
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
    const complete = vi.fn().mockResolvedValue(undefined);
    registerRelayedIntentHandler('tasks.assignEvaluator', {
      broadcast: vi.fn().mockRejectedValue(new ServerTransactionPendingError(ASSIGN_TX_HASH, 7)),
      complete,
    });
    const intent = row();
    const { db } = makeDb([intent]);

    const outcome = await dispatchRelayedIntent({ db: db as never, intent: intent as never });

    // The transaction is live and owned by the reconciler (ADR-0045); rebroadcasting would
    // spend a second nonce assigning the same evaluator.
    expect(outcome).toBe('broadcast');
    expect(intent.status).toBe('broadcast');
    expect(intent.txHash).toBe(ASSIGN_TX_HASH);
    // No receipt exists yet, so there is nothing to complete: the outbox row really is in
    // `broadcast` and the reconciler owns it from here.
    expect(complete).not.toHaveBeenCalled();
  });

  // Verifies: ADR-0050
  it('does not hand an intent back for rebroadcast when the failure came after the send', async () => {
    const broadcast = vi.fn().mockResolvedValue(ASSIGN_TX_HASH);
    // A completion handler that throws stands in for anything that can fail after the hash
    // exists -- the outbox lookup, the completion claim, the handler itself.
    registerRelayedIntentHandler('tasks.assignEvaluator', {
      broadcast,
      complete: vi.fn().mockRejectedValue(new Error('connection terminated unexpectedly')),
    });
    const intent = row();
    const { db } = makeDb([intent]);

    const outcome = await dispatchRelayedIntent({ db: db as never, intent: intent as never });

    // The transaction is live. Classifying a post-send failure as transient would return it to
    // `recorded` with no hash, which is exactly what `listUnbroadcastIntents` reads as provably
    // never broadcast -- so the sweep would send it again: one payment, two chain calls.
    expect(outcome).toBe('broadcast');
    expect(intent.status).not.toBe('recorded');
    expect(intent.txHash).toBe(ASSIGN_TX_HASH);
    expect(broadcast).toHaveBeenCalledTimes(1);
  });

  // Verifies: ADR-0045
  it('refuses to complete an intent from a receipt belonging to another transaction', async () => {
    const complete = vi.fn().mockResolvedValue(undefined);
    registerRelayedIntentHandler('tasks.assignEvaluator', { complete });
    const intent = row({ status: 'broadcast', txHash: ASSIGN_TX_HASH });
    const { db } = makeDb([intent]);

    const settled = await completeRelayedIntent({
      db: db as never,
      intent: intent as never,
      // What the reconciler reads once it has replaced a stuck nonce: the receipt of the no-op
      // replacement, whose success means this intent's own call never landed.
      txHash: `0x${'ef'.repeat(32)}`,
    });

    expect(settled).toBe(false);
    expect(complete).not.toHaveBeenCalled();
    expect(intent.status).toBe('broadcast');
  });
});

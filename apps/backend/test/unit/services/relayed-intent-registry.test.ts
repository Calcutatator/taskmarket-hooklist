// Verifies: ADR-0045
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { stubServerEnvironment } from '../../helpers/server-environment';

const restoreServerEnvironment = stubServerEnvironment();

const {
  completeRelayedIntent,
  getRelayedIntentHandler,
  registerRelayedIntentHandler,
  registeredRelayedIntentOperations,
} = await import('../../../src/services/relayed-intent-registry');

afterAll(restoreServerEnvironment);

const TX_HASH = `0x${'ab'.repeat(32)}`;

type Row = { id: string; operation: string; status: string; completionAttempts: number };

/**
 * Fake covering only what the registry touches. The claim is modelled as the real one
 * behaves -- conditional on status, so a second caller gets nothing.
 */
function makeDb(row: Row) {
  const state = { lastError: null as string | null, row };
  const db = {
    update: () => ({
      set: (values: Record<string, unknown>) => ({
        where: (predicate: { claim?: boolean }) => {
          const chain = {
            returning: async () => {
              if (state.row.status !== 'recorded' && state.row.status !== 'broadcast') return [];
              state.row.completionAttempts += 1;
              return [{ ...state.row }];
            },
            then: (onfulfilled: (v: unknown) => unknown) => {
              if (typeof values.status === 'string') state.row.status = values.status as string;
              if ('lastError' in values) state.lastError = values.lastError as string | null;
              return Promise.resolve(undefined).then(onfulfilled);
            },
          };
          void predicate;
          return chain;
        },
      }),
    }),
  };
  return { db, state };
}

function intentRow(overrides: Partial<Row> = {}): Row {
  return {
    completionAttempts: 0,
    id: 'intent-1',
    operation: 'tasks.create',
    status: 'broadcast',
    ...overrides,
  };
}

describe('relayed intent registry', () => {
  beforeEach(() => {
    registerRelayedIntentHandler('tasks.create', async () => undefined);
  });

  it('registers and resolves a handler by operation', () => {
    expect(getRelayedIntentHandler('tasks.create')).toBeTypeOf('function');
    expect(registeredRelayedIntentOperations()).toContain('tasks.create');
  });

  it('runs the handler and marks the intent completed', async () => {
    const handler = vi.fn().mockResolvedValue(undefined);
    registerRelayedIntentHandler('tasks.create', handler);
    const { db, state } = makeDb(intentRow());

    const done = await completeRelayedIntent({
      db: db as never,
      intent: state.row as never,
      txHash: TX_HASH,
    });

    expect(done).toBe(true);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(state.row.status).toBe('completed');
  });

  it('runs the handler exactly once when the request and the reconciler race', async () => {
    const handler = vi.fn().mockResolvedValue(undefined);
    registerRelayedIntentHandler('tasks.create', handler);
    const { db, state } = makeDb(intentRow());

    await completeRelayedIntent({ db: db as never, intent: state.row as never, txHash: TX_HASH });
    // Second observer of the same successful receipt. The claim no longer matches.
    const second = await completeRelayedIntent({
      db: db as never,
      intent: state.row as never,
      txHash: TX_HASH,
    });

    expect(second).toBe(true);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('leaves the intent claimable when the handler throws, so a later pass retries', async () => {
    registerRelayedIntentHandler(
      'tasks.create',
      vi.fn().mockRejectedValue(new Error('db unavailable'))
    );
    const { db, state } = makeDb(intentRow());

    const done = await completeRelayedIntent({
      db: db as never,
      intent: state.row as never,
      txHash: TX_HASH,
    });

    // Not completed: marking it done here would leave the chain and the database permanently
    // out of step, with the on-chain effect real and nothing recording it.
    expect(done).toBe(false);
    expect(state.row.status).toBe('broadcast');
    expect(state.lastError).toContain('db unavailable');
  });

  it('does not mark an intent completed when no handler is registered', async () => {
    const { db, state } = makeDb(intentRow({ operation: 'unregistered.operation' }));

    const done = await completeRelayedIntent({
      db: db as never,
      intent: state.row as never,
      txHash: TX_HASH,
    });

    expect(done).toBe(false);
    expect(state.row.status).toBe('broadcast');
    expect(state.lastError).toContain('No completion handler');
  });
});

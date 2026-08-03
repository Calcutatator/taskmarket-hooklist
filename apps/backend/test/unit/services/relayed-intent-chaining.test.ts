// Verifies: ADR-0046
import { describe, expect, it } from 'vitest';
import {
  MAX_INTENT_CHAIN_DEPTH,
  enqueueFollowOnIntent,
  getRootIntent,
} from '../../../src/services/relayed-intents';
import type { RelayedIntent } from '../../../src/db/schema';

/**
 * In-memory stand-in. Inserts go through the fake db; ancestry walking goes through the
 * injected loadIntent seam rather than trying to decode drizzle predicates.
 */
function makeDb(seed: RelayedIntent[] = []) {
  const rows = [...seed];
  const db = {
    insert: () => ({
      values: (values: Record<string, unknown>) => ({
        returning: async () => {
          const row = { ...(values as unknown as RelayedIntent) };
          rows.push(row);
          return [row];
        },
      }),
    }),
  };
  const loadIntent = async (intentId: string) => rows.find((row) => row.id === intentId) ?? null;
  return { db, loadIntent, rows };
}

function intent(overrides: Partial<RelayedIntent> = {}): RelayedIntent {
  return {
    chainDepth: 0,
    id: 'root',
    operation: 'tasks.create',
    parentIntentId: null,
    payer: '0x1111111111111111111111111111111111111111',
    paymentAmount: '1000000',
    paymentTxHash: '0xpayment',
    status: 'broadcast',
    ...overrides,
  } as unknown as RelayedIntent;
}

describe('relayed intent chaining', () => {
  it('enqueues a follow-on one level deeper than its parent', async () => {
    const parent = intent();
    const { db } = makeDb([parent]);

    const followOn = await enqueueFollowOnIntent({
      db: db as never,
      operation: 'acceptance.accept',
      parent,
      payload: { taskId: '0xabc' },
    });

    expect(followOn.parentIntentId).toBe('root');
    expect(followOn.chainDepth).toBe(1);
    expect(followOn.status).toBe('recorded');
  });

  it('never gives a follow-on a payment reference, so a chain cannot refund twice', async () => {
    const parent = intent();
    const { db } = makeDb([parent]);

    const followOn = await enqueueFollowOnIntent({
      db: db as never,
      operation: 'acceptance.accept',
      parent,
      payload: {},
    });

    // The payer carries over for attribution; the payment itself belongs to the root only.
    expect(followOn.payer).toBe(parent.payer);
    expect(followOn.paymentTxHash).toBeUndefined();
    expect(followOn.paymentAmount).toBeUndefined();
  });

  it('refuses a chain deeper than the maximum rather than cascading', async () => {
    const deep = intent({ chainDepth: MAX_INTENT_CHAIN_DEPTH });
    const { db } = makeDb([deep]);

    await expect(
      enqueueFollowOnIntent({
        db: db as never,
        operation: 'acceptance.accept',
        parent: deep,
        payload: {},
      })
    ).rejects.toThrow(/maximum depth/);
  });

  it('refuses a follow-on that would repeat an operation already in the chain', async () => {
    const root = intent({ id: 'root', operation: 'tasks.create' });
    const child = intent({
      chainDepth: 1,
      id: 'child',
      operation: 'acceptance.accept',
      parentIntentId: 'root',
      paymentAmount: null,
      paymentTxHash: null,
    });
    const { db, loadIntent } = makeDb([root, child]);

    // A handler enqueuing its own operation again is a loop, not a longer operation.
    await expect(
      enqueueFollowOnIntent({
        db: db as never,
        loadIntent,
        operation: 'tasks.create',
        parent: child,
        payload: {},
      })
    ).rejects.toThrow(/would cycle/);
  });

  it('resolves the root of a chain, which is where the payment lives', async () => {
    const root = intent({ id: 'root' });
    const child = intent({
      chainDepth: 1,
      id: 'child',
      parentIntentId: 'root',
      paymentAmount: null,
      paymentTxHash: null,
    });
    const grandchild = intent({
      chainDepth: 2,
      id: 'grandchild',
      parentIntentId: 'child',
      paymentAmount: null,
      paymentTxHash: null,
    });
    const { db, loadIntent } = makeDb([root, child, grandchild]);

    const resolved = await getRootIntent({ db: db as never, intent: grandchild, loadIntent });

    expect(resolved.id).toBe('root');
    expect(resolved.paymentTxHash).toBe('0xpayment');
  });

  it('treats a root as its own root', async () => {
    const root = intent();
    const { db, loadIntent } = makeDb([root]);
    expect((await getRootIntent({ db: db as never, intent: root, loadIntent })).id).toBe('root');
  });
});

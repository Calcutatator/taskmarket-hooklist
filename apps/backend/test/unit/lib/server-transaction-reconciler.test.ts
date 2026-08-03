// Verifies: ADR-0040
import { afterAll, describe, expect, it, vi } from 'vitest';
import { createServerTransactionDispatcher } from '../../../src/lib/server-transaction-dispatcher';
import { createMemoryServerTransactionStore } from '../../helpers/memory-server-transaction-store';
import { stubServerEnvironment } from '../../helpers/server-environment';

// The reconciler logs, and the logger reads validated server config at import time.
const restoreServerEnvironment = stubServerEnvironment();

const { createServerTransactionReconciler } = await import(
  '../../../src/lib/server-transaction-reconciler'
);

afterAll(restoreServerEnvironment);

const HASH = `0x${'ab'.repeat(32)}` as const;
const REPLACEMENT_HASH = `0x${'cd'.repeat(32)}` as const;
const STUCK_AFTER_MS = 90_000;

async function broadcastOne(
  store: ReturnType<typeof createMemoryServerTransactionStore>['store']
) {
  const dispatch = createServerTransactionDispatcher({
    getPendingNonce: vi.fn().mockResolvedValue(10),
    store,
  });
  await expect(
    dispatch({
      confirm: vi.fn().mockRejectedValue(new Error('receipt timeout')),
      send: vi.fn().mockResolvedValue(HASH),
      simulate: vi.fn().mockResolvedValue(undefined),
    })
  ).rejects.toThrow();
}

describe('server transaction reconciler', () => {
  it('settles a transaction whose receipt landed after the request gave up', async () => {
    const { state, store } = createMemoryServerTransactionStore(10);
    await broadcastOne(store);

    const reconcile = createServerTransactionReconciler({
      getReceiptStatus: vi.fn().mockResolvedValue('success'),
      sendReplacement: vi.fn(),
      store,
    });
    await reconcile();

    expect(state.rows[0]).toMatchObject({ nonce: 10, status: 'confirmed' });
  });

  it('marks a reverted transaction terminal without creating a gap', async () => {
    const { state, store } = createMemoryServerTransactionStore(10);
    await broadcastOne(store);

    const sendReplacement = vi.fn();
    const reconcile = createServerTransactionReconciler({
      getReceiptStatus: vi.fn().mockResolvedValue('reverted'),
      sendReplacement,
      store,
    });
    await reconcile();

    // The nonce is spent on chain, so no replacement is needed.
    expect(state.rows[0]).toMatchObject({ status: 'failed' });
    expect(sendReplacement).not.toHaveBeenCalled();
  });

  it('leaves a recently broadcast transaction alone', async () => {
    const { store } = createMemoryServerTransactionStore(10);
    await broadcastOne(store);

    const sendReplacement = vi.fn();
    const reconcile = createServerTransactionReconciler({
      getReceiptStatus: vi.fn().mockResolvedValue(null),
      sendReplacement,
      store,
    });
    await reconcile();

    expect(sendReplacement).not.toHaveBeenCalled();
  });

  it('replaces a stuck nonce so later transactions are not blocked behind it', async () => {
    const { state, store } = createMemoryServerTransactionStore(10);
    await broadcastOne(store);

    const sendReplacement = vi.fn().mockResolvedValue(REPLACEMENT_HASH);
    const reconcile = createServerTransactionReconciler({
      getReceiptStatus: vi.fn().mockResolvedValue(null),
      sendReplacement,
      store,
      stuckAfterMs: STUCK_AFTER_MS,
    });

    // Pretend the pass runs well after the stuck threshold elapsed.
    await reconcile(new Date(Date.now() + STUCK_AFTER_MS * 2));

    expect(sendReplacement).toHaveBeenCalledWith(10);
    expect(state.rows[0]).toMatchObject({ status: 'broadcast', txHash: REPLACEMENT_HASH });
  });

  it('recovers without an operator restart when a replacement is itself rejected', async () => {
    const { state, store } = createMemoryServerTransactionStore(10);
    await broadcastOne(store);

    const reconcile = createServerTransactionReconciler({
      getReceiptStatus: vi.fn().mockResolvedValue(null),
      sendReplacement: vi.fn().mockRejectedValue(new Error('nonce too low')),
      store,
      stuckAfterMs: STUCK_AFTER_MS,
    });

    // A rejected replacement must not throw out of the pass or wedge the row.
    await expect(reconcile(new Date(Date.now() + STUCK_AFTER_MS * 2))).resolves.toBeUndefined();
    expect(state.rows[0]).toMatchObject({ status: 'broadcast' });
  });

  // Verifies: ADR-0045
  describe('relayed intent settlement', () => {
    function settlementSpies() {
      return { onConfirmed: vi.fn().mockResolvedValue(undefined), onFailed: vi.fn().mockResolvedValue(undefined) };
    }

    it('completes the intent when the receipt confirms success', async () => {
      const { store } = createMemoryServerTransactionStore(10);
      await broadcastOne(store);
      const intents = settlementSpies();

      const reconcile = createServerTransactionReconciler({
        getReceiptStatus: vi.fn().mockResolvedValue('success'),
        intents,
        sendReplacement: vi.fn(),
        store,
      });
      await reconcile();

      expect(intents.onConfirmed).toHaveBeenCalledTimes(1);
      expect(intents.onFailed).not.toHaveBeenCalled();
    });

    it('fails the intent when the receipt confirms a revert', async () => {
      const { store } = createMemoryServerTransactionStore(10);
      await broadcastOne(store);
      const intents = settlementSpies();

      const reconcile = createServerTransactionReconciler({
        getReceiptStatus: vi.fn().mockResolvedValue('reverted'),
        intents,
        sendReplacement: vi.fn(),
        store,
      });
      await reconcile();

      expect(intents.onFailed).toHaveBeenCalledTimes(1);
      expect(intents.onConfirmed).not.toHaveBeenCalled();
    });

    it('fails the intent when a replacement supersedes the original', async () => {
      const { store } = createMemoryServerTransactionStore(10);
      await broadcastOne(store);
      const intents = settlementSpies();

      const reconcile = createServerTransactionReconciler({
        getReceiptStatus: vi.fn().mockResolvedValue(null),
        intents,
        sendReplacement: vi.fn().mockResolvedValue(REPLACEMENT_HASH),
        store,
        stuckAfterMs: STUCK_AFTER_MS,
      });
      await reconcile(new Date(Date.now() + STUCK_AFTER_MS * 2));

      expect(intents.onFailed).toHaveBeenCalledTimes(1);
    });

    it('settles nothing while the transaction is merely unmined', async () => {
      const { store } = createMemoryServerTransactionStore(10);
      await broadcastOne(store);
      const intents = settlementSpies();

      const reconcile = createServerTransactionReconciler({
        getReceiptStatus: vi.fn().mockResolvedValue(null),
        intents,
        sendReplacement: vi.fn(),
        store,
      });
      await reconcile();

      // Still in flight is not evidence of anything. Refunding here is the defect ADR-0045
      // exists to prevent.
      expect(intents.onConfirmed).not.toHaveBeenCalled();
      expect(intents.onFailed).not.toHaveBeenCalled();
    });

    it('keeps reconciling the queue when intent settlement throws', async () => {
      const { store } = createMemoryServerTransactionStore(10);
      await broadcastOne(store);

      const reconcile = createServerTransactionReconciler({
        getReceiptStatus: vi.fn().mockResolvedValue('success'),
        intents: {
          onConfirmed: vi.fn().mockRejectedValue(new Error('completion handler exploded')),
          onFailed: vi.fn(),
        },
        sendReplacement: vi.fn(),
        store,
      });

      await expect(reconcile()).resolves.toBeUndefined();
    });

    it('sweeps intents left unfinished behind an already-confirmed transaction', async () => {
      const { store } = createMemoryServerTransactionStore(10);
      const sweepConfirmed = vi.fn().mockResolvedValue(undefined);

      const reconcile = createServerTransactionReconciler({
        getReceiptStatus: vi.fn(),
        intents: { ...settlementSpies(), sweepConfirmed },
        sendReplacement: vi.fn(),
        store,
      });
      await reconcile();

      // Nothing is in `broadcast` here at all -- that is the point. A transaction confirmed
      // inside its own dispatch is invisible to every other pass, so the sweep must run
      // regardless of what the broadcast queue looks like.
      expect(sweepConfirmed).toHaveBeenCalledTimes(1);
    });

    it('keeps the pass alive when the confirmed sweep throws', async () => {
      const { store } = createMemoryServerTransactionStore(10);

      const reconcile = createServerTransactionReconciler({
        getReceiptStatus: vi.fn(),
        intents: {
          ...settlementSpies(),
          sweepConfirmed: vi.fn().mockRejectedValue(new Error('sweep exploded')),
        },
        sendReplacement: vi.fn(),
        store,
      });

      await expect(reconcile()).resolves.toBeUndefined();
    });
  });

  it('fills a recycled nonce that is blocking an in-flight transaction', async () => {
    // The scenario: two concurrent dispatches take nonces 10 and 11. The 11 broadcasts and
    // sits pending; the 10 is rejected by the provider and returns to the recycled pool. On a
    // quiet relayer no further allocation is coming to consume 10, so 11 can never mine, and a
    // reconciler that only replaced 11 would broadcast replacements forever without unblocking
    // anything. The recycled nonce has to be filled first.
    const { state, store } = createMemoryServerTransactionStore(10);
    const dispatch = createServerTransactionDispatcher({
      getPendingNonce: vi.fn().mockResolvedValue(10),
      store,
    });

    const rejected = dispatch({
      confirm: vi.fn(),
      send: vi.fn().mockRejectedValue(new Error('connection reset by peer')),
      simulate: vi.fn().mockResolvedValue(undefined),
    });
    const inFlight = dispatch({
      confirm: vi.fn().mockRejectedValue(new Error('receipt timeout')),
      send: vi.fn().mockResolvedValue(HASH),
      simulate: vi.fn().mockResolvedValue(undefined),
    });
    await expect(rejected).rejects.toThrow('connection reset by peer');
    await expect(inFlight).rejects.toThrow();

    const recycled = state.rows.find((row) => row.status === 'recycled');
    const broadcast = state.rows.find((row) => row.status === 'broadcast');
    expect(recycled?.nonce).toBe(10);
    expect(broadcast?.nonce).toBe(11);

    const sendReplacement = vi.fn().mockResolvedValue(REPLACEMENT_HASH);
    const reconcile = createServerTransactionReconciler({
      getReceiptStatus: vi.fn().mockResolvedValue(null),
      sendReplacement,
      store,
      stuckAfterMs: STUCK_AFTER_MS,
    });
    await reconcile(new Date(Date.now() + STUCK_AFTER_MS * 2));

    // The blocking nonce is filled, and it is filled before the higher one is touched.
    expect(sendReplacement).toHaveBeenCalledWith(10);
    expect(sendReplacement.mock.calls[0]?.[0]).toBe(10);
    expect(state.rows.find((row) => row.id === recycled?.id)?.status).toBe('broadcast');
  });

  it('leaves a recycled nonce alone when nothing is queued behind it', async () => {
    // No in-flight transaction above it, so the next allocation will reuse it. Replacing it
    // here would spend gas to consume a nonce that was about to be used for real work.
    const { store } = createMemoryServerTransactionStore(10);
    const dispatch = createServerTransactionDispatcher({
      getPendingNonce: vi.fn().mockResolvedValue(10),
      store,
    });
    await expect(
      dispatch({
        confirm: vi.fn(),
        send: vi.fn().mockRejectedValue(new Error('connection reset by peer')),
        simulate: vi.fn().mockResolvedValue(undefined),
      })
    ).rejects.toThrow();

    const sendReplacement = vi.fn();
    const reconcile = createServerTransactionReconciler({
      getReceiptStatus: vi.fn(),
      sendReplacement,
      store,
      stuckAfterMs: STUCK_AFTER_MS,
    });
    await reconcile(new Date(Date.now() + STUCK_AFTER_MS * 2));

    expect(sendReplacement).not.toHaveBeenCalled();
  });

  it('fills a nonce reserved by a process that died before broadcasting', async () => {
    const { state, store } = createMemoryServerTransactionStore(10);
    await store.seed(vi.fn().mockResolvedValue(10));
    await store.allocate('crashed-before-send');

    const sendReplacement = vi.fn().mockResolvedValue(REPLACEMENT_HASH);
    const reconcile = createServerTransactionReconciler({
      getReceiptStatus: vi.fn(),
      sendReplacement,
      store,
      stuckAfterMs: STUCK_AFTER_MS,
    });
    await reconcile(new Date(Date.now() + STUCK_AFTER_MS * 2));

    expect(sendReplacement).toHaveBeenCalledWith(10);
    expect(state.rows[0]).toMatchObject({ status: 'broadcast' });
  });
});

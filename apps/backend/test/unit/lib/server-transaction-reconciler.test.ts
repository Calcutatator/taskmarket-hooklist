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
      // The chain has not consumed nonce 10 yet, so the foreign-nonce branch stays inert.
      getLatestNonceCount: vi.fn().mockResolvedValue(10),
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
      // The chain has not consumed nonce 10 yet, so the foreign-nonce branch stays inert.
      getLatestNonceCount: vi.fn().mockResolvedValue(10),
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
      // The chain has not consumed nonce 10 yet, so the foreign-nonce branch stays inert.
      getLatestNonceCount: vi.fn().mockResolvedValue(10),
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
      // The chain has not consumed nonce 10 yet, so the foreign-nonce branch stays inert.
      getLatestNonceCount: vi.fn().mockResolvedValue(10),
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
      // The chain has not consumed nonce 10 yet, so the foreign-nonce branch stays inert.
      getLatestNonceCount: vi.fn().mockResolvedValue(10),
      getReceiptStatus: vi.fn().mockResolvedValue(null),
      sendReplacement: vi.fn().mockRejectedValue(new Error('nonce too low')),
      store,
      stuckAfterMs: STUCK_AFTER_MS,
    });

    // A rejected replacement must not throw out of the pass or wedge the row.
    await expect(reconcile(new Date(Date.now() + STUCK_AFTER_MS * 2))).resolves.toBeUndefined();
    expect(state.rows[0]).toMatchObject({ status: 'broadcast' });
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
      // The chain has not consumed nonce 10 yet, so the foreign-nonce branch stays inert.
      getLatestNonceCount: vi.fn().mockResolvedValue(10),
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
      // The chain has not consumed nonce 10 yet, so the foreign-nonce branch stays inert.
      getLatestNonceCount: vi.fn().mockResolvedValue(10),
      getReceiptStatus: vi.fn(),
      sendReplacement,
      store,
      stuckAfterMs: STUCK_AFTER_MS,
    });
    await reconcile(new Date(Date.now() + STUCK_AFTER_MS * 2));

    expect(sendReplacement).not.toHaveBeenCalled();
  });

  it('ends a row whose nonce was spent by a transaction from outside the backend', async () => {
    // A `forge script --broadcast` deploy run with the same wallet mines at nonce 10. Our
    // transaction at 10 is dropped, so its hash never gets a receipt, and every replacement is
    // rejected 'nonce too low' because the nonce is already spent. Without the nonce-count
    // check the row retries that rejected replacement on every pass forever.
    const { state, store } = createMemoryServerTransactionStore(10);
    await broadcastOne(store);

    const sendReplacement = vi.fn().mockRejectedValue(new Error('nonce too low'));
    const reconcile = createServerTransactionReconciler({
      getLatestNonceCount: vi.fn().mockResolvedValue(11),
      getReceiptStatus: vi.fn().mockResolvedValue(null),
      sendReplacement,
      store,
      stuckAfterMs: STUCK_AFTER_MS,
    });
    await reconcile(new Date(Date.now() + STUCK_AFTER_MS * 2));

    expect(state.rows[0]).toMatchObject({ status: 'failed' });
    // The nonce is already spent on chain, so burning gas on a replacement is pointless.
    expect(sendReplacement).not.toHaveBeenCalled();
  });

  it('confirms rather than fails when the advanced nonce count was our own transaction', async () => {
    // The count advancing is ambiguous on its own -- our transaction mining advances it too.
    // A lagging RPC replica can report the advanced count before the receipt is visible, so the
    // receipt is re-read after the count and it, not the count, decides the outcome.
    const { state, store } = createMemoryServerTransactionStore(10);
    await broadcastOne(store);

    const getReceiptStatus = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce('success');
    const sendReplacement = vi.fn();
    const reconcile = createServerTransactionReconciler({
      getLatestNonceCount: vi.fn().mockResolvedValue(11),
      getReceiptStatus,
      sendReplacement,
      store,
      stuckAfterMs: STUCK_AFTER_MS,
    });
    await reconcile(new Date(Date.now() + STUCK_AFTER_MS * 2));

    expect(state.rows[0]).toMatchObject({ status: 'confirmed' });
    expect(sendReplacement).not.toHaveBeenCalled();
  });

  it('falls back to replacement when the nonce count cannot be read', async () => {
    // No evidence either way must not change behaviour: the pre-existing stuck-nonce path runs.
    const { store } = createMemoryServerTransactionStore(10);
    await broadcastOne(store);

    const sendReplacement = vi.fn().mockResolvedValue(REPLACEMENT_HASH);
    const reconcile = createServerTransactionReconciler({
      getLatestNonceCount: vi.fn().mockRejectedValue(new Error('rpc unavailable')),
      getReceiptStatus: vi.fn().mockResolvedValue(null),
      sendReplacement,
      store,
      stuckAfterMs: STUCK_AFTER_MS,
    });
    await reconcile(new Date(Date.now() + STUCK_AFTER_MS * 2));

    expect(sendReplacement).toHaveBeenCalledWith(10);
  });

  it('does not touch a row still within the stuck threshold even once the nonce has passed', async () => {
    // Right after a normal broadcast the count may already have advanced past the nonce while
    // the receipt is still propagating. Acting that early would fail a healthy transaction.
    const { state, store } = createMemoryServerTransactionStore(10);
    await broadcastOne(store);

    const reconcile = createServerTransactionReconciler({
      getLatestNonceCount: vi.fn().mockResolvedValue(11),
      getReceiptStatus: vi.fn().mockResolvedValue(null),
      sendReplacement: vi.fn(),
      store,
      stuckAfterMs: STUCK_AFTER_MS,
    });
    await reconcile();

    expect(state.rows[0]).toMatchObject({ status: 'broadcast' });
  });

  it('fills a nonce reserved by a process that died before broadcasting', async () => {
    const { state, store } = createMemoryServerTransactionStore(10);
    await store.seed(vi.fn().mockResolvedValue(10));
    await store.allocate('crashed-before-send');

    const sendReplacement = vi.fn().mockResolvedValue(REPLACEMENT_HASH);
    const reconcile = createServerTransactionReconciler({
      // The chain has not consumed nonce 10 yet, so the foreign-nonce branch stays inert.
      getLatestNonceCount: vi.fn().mockResolvedValue(10),
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

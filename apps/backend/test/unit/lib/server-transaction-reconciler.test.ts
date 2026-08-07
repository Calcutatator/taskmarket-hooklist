// Verifies: ADR-0040
import { afterAll, describe, expect, it, vi } from 'vitest';
import { createServerTransactionDispatcher } from '../../../src/lib/server-transaction-dispatcher';
import { createMemoryServerTransactionStore } from '../../helpers/memory-server-transaction-store';
import { stubServerEnvironment } from '../../helpers/server-environment';

// The reconciler logs, and the logger reads validated server config at import time.
const restoreServerEnvironment = stubServerEnvironment();

const { createServerTransactionReconciler } =
  await import('../../../src/lib/server-transaction-reconciler');

afterAll(restoreServerEnvironment);

const HASH = `0x${'ab'.repeat(32)}` as const;
const REPLACEMENT_HASH = `0x${'cd'.repeat(32)}` as const;
const FEES = { maxFeePerGas: 2_000_000_000n, maxPriorityFeePerGas: 1_000_000_000n };

/** A replacement that succeeds, in the shape the reconciler now expects back (ADR-0051). */
function replacementSender(hash = REPLACEMENT_HASH) {
  return vi.fn().mockResolvedValue({ fees: FEES, hash });
}
const STUCK_AFTER_MS = 90_000;

async function broadcastOne(store: ReturnType<typeof createMemoryServerTransactionStore>['store']) {
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

function settlementSpies() {
  return {
    onConfirmed: vi.fn().mockResolvedValue(undefined),
    onFailed: vi.fn().mockResolvedValue(undefined),
  };
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

    const sendReplacement = replacementSender();
    const reconcile = createServerTransactionReconciler({
      getReceiptStatus: vi.fn().mockResolvedValue(null),
      sendReplacement,
      store,
      stuckAfterMs: STUCK_AFTER_MS,
    });

    // Pretend the pass runs well after the stuck threshold elapsed.
    await reconcile(new Date(Date.now() + STUCK_AFTER_MS * 2));

    expect(sendReplacement).toHaveBeenCalledWith(expect.objectContaining({ nonce: 10 }));
    expect(state.rows[0]).toMatchObject({ status: 'broadcast', txHash: REPLACEMENT_HASH });
  });

  // Verifies: ADR-0066
  it('sends exactly one clearing self-transfer per stuck nonce, not one per pass', async () => {
    const { state, store } = createMemoryServerTransactionStore(10);
    await broadcastOne(store);

    // Escalation has reached the cap, so every pass from here would price a clearing transfer.
    // Only the first may actually go out: the nonce is cleared once, and the row then waits for
    // that transfer's receipt like any other broadcast.
    const sendReplacement = vi.fn().mockResolvedValue({
      clearing: true,
      fees: FEES,
      hash: REPLACEMENT_HASH,
    });
    const reconcile = createServerTransactionReconciler({
      getReceiptStatus: vi.fn().mockResolvedValue(null),
      sendReplacement,
      store,
      stuckAfterMs: STUCK_AFTER_MS,
    });

    await reconcile(new Date(Date.now() + STUCK_AFTER_MS * 2));
    await reconcile(new Date(Date.now() + STUCK_AFTER_MS * 4));
    await reconcile(new Date(Date.now() + STUCK_AFTER_MS * 6));

    expect(sendReplacement).toHaveBeenCalledTimes(1);
    // And the outbox says which of the row's transactions was the clearing transfer, so an
    // operator reading the table can tell it from the work it replaced.
    expect(state.rows[0]).toMatchObject({
      clearingTxHash: REPLACEMENT_HASH,
      replacedTxHash: HASH,
      txHash: REPLACEMENT_HASH,
    });
  });

  // Verifies: ADR-0066
  it('settles a cleared nonce as failed through the mined-replacement rule', async () => {
    const { store } = createMemoryServerTransactionStore(10);
    await broadcastOne(store);
    const intents = settlementSpies();

    const getReceiptStatus = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValue('success' as const);
    const reconcile = createServerTransactionReconciler({
      getReceiptStatus,
      intents,
      sendReplacement: vi
        .fn()
        .mockResolvedValue({ clearing: true, fees: FEES, hash: REPLACEMENT_HASH }),
      store,
      stuckAfterMs: STUCK_AFTER_MS,
    });

    await reconcile(new Date(Date.now() + STUCK_AFTER_MS * 2));
    await reconcile(new Date(Date.now() + STUCK_AFTER_MS * 4));

    // No new settlement path: this is the same confirmed evidence any mined replacement
    // produces -- the nonce is spent by a transaction that did none of the intent's work.
    expect(intents.onFailed).toHaveBeenCalledTimes(1);
    expect(intents.onFailed.mock.calls[0]?.[1]).toContain('superseded by replacement');
    expect(intents.onConfirmed).not.toHaveBeenCalled();
  });

  // Verifies: ADR-0069
  it('settles the original when it mines after a replacement was already broadcast', async () => {
    const { state, store } = createMemoryServerTransactionStore(10);
    await broadcastOne(store);
    const intents = settlementSpies();

    // The replacement went out because the gateway lagged; the original mined anyway. The
    // replacement is nonce-too-low from that moment on, so its receipt is null forever and
    // nothing would ever read the hash it superseded.
    let lagging = true;
    const getReceiptStatus = vi.fn(async (hash: string) => {
      // The lag that makes the replacement go out at all: the original's receipt is not
      // visible yet on the first pass.
      if (lagging) {
        lagging = false;
        return null;
      }
      return hash === HASH ? 'success' : null;
    });
    const reconcile = createServerTransactionReconciler({
      getReceiptStatus: getReceiptStatus as never,
      intents,
      sendReplacement: replacementSender(),
      store,
      stuckAfterMs: STUCK_AFTER_MS,
    });

    await reconcile(new Date(Date.now() + STUCK_AFTER_MS * 2));
    await reconcile(new Date(Date.now() + STUCK_AFTER_MS * 4));

    // Routed through the existing confirmed path, and the outbox row carries the hash that
    // actually mined again, so the hash join in listConfirmedUnsettledIntents lines up.
    expect(intents.onConfirmed).toHaveBeenCalledWith('tx-1', HASH);
    expect(intents.onFailed).not.toHaveBeenCalled();
    expect(state.rows[0]).toMatchObject({ status: 'confirmed', txHash: HASH });
  });

  it('fails the intent when the superseded original mines reverted', async () => {
    const { state, store } = createMemoryServerTransactionStore(10);
    await broadcastOne(store);
    const intents = settlementSpies();

    let lagging = true;
    const getReceiptStatus = vi.fn(async (hash: string) => {
      if (lagging) {
        lagging = false;
        return null;
      }
      return hash === HASH ? 'reverted' : null;
    });
    const reconcile = createServerTransactionReconciler({
      getReceiptStatus: getReceiptStatus as never,
      intents,
      sendReplacement: replacementSender(),
      store,
      stuckAfterMs: STUCK_AFTER_MS,
    });

    await reconcile(new Date(Date.now() + STUCK_AFTER_MS * 2));
    await reconcile(new Date(Date.now() + STUCK_AFTER_MS * 4));

    expect(intents.onFailed).toHaveBeenCalledTimes(1);
    expect(state.rows[0]).toMatchObject({ status: 'failed', txHash: HASH });
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

    it('fails the intent only once the replacement itself is mined', async () => {
      const { store } = createMemoryServerTransactionStore(10);
      await broadcastOne(store);
      const intents = settlementSpies();

      // Null until the replacement has been sent, then success for the replacement's own hash.
      const getReceiptStatus = vi
        .fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValue('success' as const);
      const reconcile = createServerTransactionReconciler({
        getReceiptStatus,
        intents,
        sendReplacement: replacementSender(),
        store,
        stuckAfterMs: STUCK_AFTER_MS,
      });

      // Pass one broadcasts the replacement. Broadcast is not mined, so nothing is settled:
      // a replacement can be dropped in turn and the original mine after all, and a refund
      // issued now would be a refund for work that then happens (ADR-0045).
      await reconcile(new Date(Date.now() + STUCK_AFTER_MS * 2));
      expect(intents.onFailed).not.toHaveBeenCalled();

      // Pass two reads the replacement's receipt. Now the nonce is provably spent by a
      // transaction that did none of the intent's work, which is the confirmed evidence.
      await reconcile(new Date(Date.now() + STUCK_AFTER_MS * 3));
      expect(intents.onFailed).toHaveBeenCalledTimes(1);
      expect(intents.onFailed.mock.calls[0]?.[1]).toContain(REPLACEMENT_HASH);
      // And never as a success: the receipt that landed belongs to the replacement.
      expect(intents.onConfirmed).not.toHaveBeenCalled();
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
      // Two entries, because a pass that stopped dead on the first throwing entry would still
      // resolve. Only a second entry being examined proves the pass actually continued.
      await broadcastOne(store);
      await broadcastOne(store);

      const getReceiptStatus = vi.fn().mockResolvedValue('success');
      const reconcile = createServerTransactionReconciler({
        getReceiptStatus,
        intents: {
          onConfirmed: vi.fn().mockRejectedValue(new Error('completion handler exploded')),
          onFailed: vi.fn(),
        },
        sendReplacement: vi.fn(),
        store,
      });

      await expect(reconcile()).resolves.toBeUndefined();
      expect(getReceiptStatus).toHaveBeenCalledTimes(2);
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

    const sendReplacement = replacementSender();
    const reconcile = createServerTransactionReconciler({
      getReceiptStatus: vi.fn().mockResolvedValue(null),
      sendReplacement,
      store,
      stuckAfterMs: STUCK_AFTER_MS,
    });
    await reconcile(new Date(Date.now() + STUCK_AFTER_MS * 2));

    // The blocking nonce is filled, and it is filled before the higher one is touched.
    expect(sendReplacement).toHaveBeenCalledWith(expect.objectContaining({ nonce: 10 }));
    expect(sendReplacement.mock.calls[0]?.[0]?.nonce).toBe(10);
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

  // Verifies: ADR-0051
  it('hands the next replacement the fee the previous one actually paid', async () => {
    const { store } = createMemoryServerTransactionStore(10);
    const dispatch = createServerTransactionDispatcher({
      getPendingNonce: vi.fn().mockResolvedValue(10),
      store,
    });
    await expect(
      dispatch({
        confirm: vi.fn().mockRejectedValue(new Error('receipt timeout')),
        fees: { maxFeePerGas: 1_000n, maxPriorityFeePerGas: 100n },
        send: vi.fn().mockResolvedValue(HASH),
        simulate: vi.fn().mockResolvedValue(undefined),
      })
    ).rejects.toThrow();

    // Two replacements at escalating prices, as the escalation policy would produce.
    const sendReplacement = vi
      .fn()
      .mockResolvedValueOnce({
        fees: { maxFeePerGas: 2_000n, maxPriorityFeePerGas: 200n },
        hash: REPLACEMENT_HASH,
      })
      .mockResolvedValueOnce({
        fees: { maxFeePerGas: 3_000n, maxPriorityFeePerGas: 300n },
        hash: `0x${'ef'.repeat(32)}` as const,
      });
    const reconcile = createServerTransactionReconciler({
      getReceiptStatus: vi.fn().mockResolvedValue(null),
      sendReplacement,
      store,
      stuckAfterMs: STUCK_AFTER_MS,
    });

    await reconcile(new Date(Date.now() + STUCK_AFTER_MS * 2));
    await reconcile(new Date(Date.now() + STUCK_AFTER_MS * 4));

    // The first replacement escalates from the original; the second from the first. Without
    // the fee being read back off the row, the second would be priced from a fresh oracle
    // reading and, on a flat oracle, rejected as an insufficient bump.
    expect(sendReplacement.mock.calls[0]?.[0]).toMatchObject({
      originalFees: { maxFeePerGas: 1_000n },
      previousFees: { maxFeePerGas: 1_000n },
    });
    expect(sendReplacement.mock.calls[1]?.[0]).toMatchObject({
      // The cap's base does not move as attempts escalate.
      originalFees: { maxFeePerGas: 1_000n },
      previousFees: { maxFeePerGas: 2_000n },
    });
  });

  // Verifies: ADR-0045
  it('settles a mined replacement from the row alone, after the sending process is gone', async () => {
    // The gap this closes: the row-to-replacement association used to live in process memory,
    // so a deploy between broadcasting a replacement and reading its receipt left the intent
    // behind it permanently unsettled with nothing able to recover it.
    const { store } = createMemoryServerTransactionStore(10);
    await broadcastOne(store);

    const sending = createServerTransactionReconciler({
      getReceiptStatus: vi.fn().mockResolvedValue(null),
      sendReplacement: replacementSender(),
      store,
      stuckAfterMs: STUCK_AFTER_MS,
    });
    await sending(new Date(Date.now() + STUCK_AFTER_MS * 2));

    // A brand new reconciler, standing in for a process that started after the replacement
    // went out. It shares no memory with the one above -- only the durable row.
    const intents = settlementSpies();
    const restarted = createServerTransactionReconciler({
      getReceiptStatus: vi.fn().mockResolvedValue('success'),
      intents,
      sendReplacement: vi.fn(),
      store,
      stuckAfterMs: STUCK_AFTER_MS,
    });
    await restarted(new Date(Date.now() + STUCK_AFTER_MS * 3));

    // A successful receipt on a no-op self-transfer is evidence the work did *not* happen.
    expect(intents.onFailed).toHaveBeenCalledTimes(1);
    expect(intents.onFailed.mock.calls[0]?.[1]).toContain(REPLACEMENT_HASH);
    expect(intents.onConfirmed).not.toHaveBeenCalled();
  });

  it('fills a nonce reserved by a process that died before broadcasting', async () => {
    const { state, store } = createMemoryServerTransactionStore(10);
    await store.seed(vi.fn().mockResolvedValue(10));
    await store.allocate('crashed-before-send');

    const sendReplacement = replacementSender();
    const reconcile = createServerTransactionReconciler({
      getReceiptStatus: vi.fn(),
      sendReplacement,
      store,
      stuckAfterMs: STUCK_AFTER_MS,
    });
    await reconcile(new Date(Date.now() + STUCK_AFTER_MS * 2));

    expect(sendReplacement).toHaveBeenCalledWith(expect.objectContaining({ nonce: 10 }));
    expect(state.rows[0]).toMatchObject({ status: 'broadcast' });
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

    expect(sendReplacement).toHaveBeenCalledWith(expect.objectContaining({ nonce: 10 }));
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
});

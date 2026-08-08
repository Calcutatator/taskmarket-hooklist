// Verifies: ADR-0040
import { describe, expect, it, vi } from 'vitest';
import {
  ServerTransactionPendingError,
  createServerTransactionDispatcher,
  nonceWasConsumed,
} from '../../../src/lib/server-transaction-dispatcher';
import { createMemoryServerTransactionStore } from '../../helpers/memory-server-transaction-store';

const HASH = `0x${'ab'.repeat(32)}` as const;

function okRequest() {
  return {
    confirm: vi.fn().mockResolvedValue({ status: 'success' }),
    succeeded: (receipt: unknown) => (receipt as { status?: string })?.status === 'success',
    send: vi.fn().mockResolvedValue(HASH),
    simulate: vi.fn().mockResolvedValue(undefined),
  };
}

describe('nonceWasConsumed', () => {
  it('treats stale-nonce and already-known failures as consuming the nonce', () => {
    expect(nonceWasConsumed(new Error('nonce too low'))).toBe(true);
    expect(nonceWasConsumed(new Error('ALREADY KNOWN'))).toBe(true);
    expect(nonceWasConsumed(new Error('replacement transaction underpriced'))).toBe(true);
  });

  it('treats an ordinary provider rejection as leaving the nonce unused', () => {
    expect(nonceWasConsumed(new Error('connection reset'))).toBe(false);
    expect(nonceWasConsumed(new Error('insufficient funds for gas'))).toBe(false);
  });
});

describe('server transaction dispatcher', () => {
  it('allocates no nonce when preflight fails -- the issue #54 regression', async () => {
    const { state, store } = createMemoryServerTransactionStore(15486);
    const dispatch = createServerTransactionDispatcher({
      getPendingNonce: vi.fn().mockResolvedValue(15486),
      store,
    });
    const send = vi.fn();
    const confirm = vi.fn();

    await expect(
      dispatch({
        confirm,
        send,
        succeeded: () => true,
        simulate: vi.fn().mockRejectedValue(new Error('ERC20: transfer amount exceeds balance')),
      })
    ).rejects.toThrow('ERC20: transfer amount exceeds balance');

    expect(send).not.toHaveBeenCalled();
    expect(confirm).not.toHaveBeenCalled();
    // The allocator never moved, so the next transaction still uses 15486 and no gap exists.
    expect(state.allocations).toBe(0);
    expect(state.nextNonce).toBe(15486);
    expect(state.rows).toEqual([]);
  });

  // Verifies: ADR-0073
  it('marks a reverted receipt failed rather than confirmed', async () => {
    const { state, store } = createMemoryServerTransactionStore(9);
    const dispatch = createServerTransactionDispatcher({
      getPendingNonce: vi.fn().mockResolvedValue(9),
      store,
    });

    const result = await dispatch({
      confirm: vi.fn().mockResolvedValue({ status: 'reverted' }),
      send: vi.fn().mockResolvedValue(HASH),
      simulate: vi.fn().mockResolvedValue(undefined),
      succeeded: (receipt: unknown) => (receipt as { status?: string })?.status === 'success',
    });

    // The receipt still comes back: the caller decides what to raise, and several read the
    // revert reason out of it. What changes is the record -- `confirmed` is a claim the work
    // happened, and every reader of that status treats it as one (ADR-0073).
    expect(result.hash).toBe(HASH);
    expect(state.rows[0]).toMatchObject({ nonce: 9, status: 'failed', txHash: HASH });
  });

  it('returns the nonce to the pool when a broadcast provably never happened', async () => {
    const { state, store } = createMemoryServerTransactionStore(41);
    const dispatch = createServerTransactionDispatcher({
      getPendingNonce: vi.fn().mockResolvedValue(41),
      store,
    });

    await expect(
      dispatch({
        succeeded: () => true,
        confirm: vi.fn(),
        send: vi.fn().mockRejectedValue(new Error('connection reset by peer')),
        simulate: vi.fn().mockResolvedValue(undefined),
      })
    ).rejects.toThrow('connection reset by peer');

    expect(state.rows).toHaveLength(1);
    expect(state.rows[0]).toMatchObject({ nonce: 41, status: 'recycled' });
  });

  it('does not recycle a nonce whose send returned no answer at all', async () => {
    const { state, store } = createMemoryServerTransactionStore(41);
    // The chain says nonce 41 is taken: the node accepted the transaction and the socket died
    // before we heard so. Recycling it here is what later reads as "nothing was ever sent".
    const getPendingNonce = vi.fn().mockResolvedValue(42);
    const dispatch = createServerTransactionDispatcher({ getPendingNonce, store });
    const onNonceReleased = vi.fn();

    await expect(
      dispatch({
        succeeded: () => true,
        confirm: vi.fn(),
        onNonceReleased,
        send: vi.fn().mockRejectedValue(new Error('socket hang up')),
        simulate: vi.fn().mockResolvedValue(undefined),
      })
    ).rejects.toThrow('socket hang up');

    expect(state.rows[0]).toMatchObject({ nonce: 41, status: 'reserved' });
    expect(onNonceReleased).not.toHaveBeenCalled();
  });

  it('leaves the nonce owned by the reconciler when the freeness read itself fails', async () => {
    const { state, store } = createMemoryServerTransactionStore(41);
    const getPendingNonce = vi.fn().mockRejectedValue(new Error('gateway 502'));
    const dispatch = createServerTransactionDispatcher({ getPendingNonce, store });

    await expect(
      dispatch({
        succeeded: () => true,
        confirm: vi.fn(),
        send: vi.fn().mockRejectedValue(new Error('socket hang up')),
        simulate: vi.fn().mockResolvedValue(undefined),
      })
    ).rejects.toThrow('socket hang up');

    expect(state.rows[0]).toMatchObject({ nonce: 41, status: 'reserved' });
  });

  it('links the outbox row at allocation, before anything is sent', async () => {
    const { store } = createMemoryServerTransactionStore(41);
    const dispatch = createServerTransactionDispatcher({
      getPendingNonce: vi.fn().mockResolvedValue(41),
      store,
    });
    const seen: string[] = [];
    const onNonceAllocated = vi.fn(async (id: string) => {
      seen.push(`allocated:${id}`);
    });

    await dispatch({
      ...okRequest(),
      onNonceAllocated,
      send: vi.fn(async () => {
        seen.push('send');
        return HASH;
      }),
    });

    expect(onNonceAllocated).toHaveBeenCalledTimes(1);
    expect(seen).toEqual(['allocated:tx-1', 'send']);
  });

  it('releases the link when the nonce is provably free again', async () => {
    const { state, store } = createMemoryServerTransactionStore(41);
    const dispatch = createServerTransactionDispatcher({
      getPendingNonce: vi.fn().mockResolvedValue(41),
      store,
    });
    const onNonceReleased = vi.fn();

    await expect(
      dispatch({
        succeeded: () => true,
        confirm: vi.fn(),
        onNonceReleased,
        send: vi.fn().mockRejectedValue(new Error('connection reset by peer')),
        simulate: vi.fn().mockResolvedValue(undefined),
      })
    ).rejects.toThrow();

    expect(state.rows[0]).toMatchObject({ status: 'recycled' });
    expect(onNonceReleased).toHaveBeenCalledTimes(1);
  });

  it('reuses a recycled nonce before allocating a new one', async () => {
    const { state, store } = createMemoryServerTransactionStore(41);
    const dispatch = createServerTransactionDispatcher({
      getPendingNonce: vi.fn().mockResolvedValue(41),
      store,
    });

    await expect(
      dispatch({
        succeeded: () => true,
        confirm: vi.fn(),
        send: vi.fn().mockRejectedValue(new Error('connection reset by peer')),
        simulate: vi.fn().mockResolvedValue(undefined),
      })
    ).rejects.toThrow();

    const request = okRequest();
    await dispatch(request);

    // 41 is reused rather than skipped, so nothing ever queues behind a hole.
    expect(request.send).toHaveBeenCalledWith(41);
    expect(state.rows).toHaveLength(1);
    expect(state.rows[0]).toMatchObject({ nonce: 41, status: 'confirmed' });
  });

  it('does not recycle a nonce that a stale-nonce error proves is already spent', async () => {
    const { state, store } = createMemoryServerTransactionStore(50);
    const getPendingNonce = vi.fn().mockResolvedValue(52);
    const dispatch = createServerTransactionDispatcher({ getPendingNonce, store });

    await expect(
      dispatch({
        succeeded: () => true,
        confirm: vi.fn(),
        send: vi.fn().mockRejectedValue(new Error('nonce too low')),
        simulate: vi.fn().mockResolvedValue(undefined),
      })
    ).rejects.toThrow('nonce too low');

    expect(state.rows[0]).toMatchObject({ status: 'failed' });
    // The allocator resynced from the chain instead of reusing a spent nonce.
    expect(state.nextNonce).toBe(52);
  });

  it('surfaces an unconfirmed broadcast as pending and leaves it live for the reconciler', async () => {
    const { state, store } = createMemoryServerTransactionStore(7);
    const dispatch = createServerTransactionDispatcher({
      getPendingNonce: vi.fn().mockResolvedValue(7),
      store,
    });

    await expect(
      dispatch({
        succeeded: () => true,
        confirm: vi.fn().mockRejectedValue(new Error('timed out waiting for receipt')),
        send: vi.fn().mockResolvedValue(HASH),
        simulate: vi.fn().mockResolvedValue(undefined),
      })
    ).rejects.toBeInstanceOf(ServerTransactionPendingError);

    // Still 'broadcast', never recycled -- the nonce may already be in the mempool.
    expect(state.rows[0]).toMatchObject({ nonce: 7, status: 'broadcast', txHash: HASH });
  });

  it('seeds the allocator from the chain exactly once', async () => {
    const { store } = createMemoryServerTransactionStore();
    const getPendingNonce = vi.fn().mockResolvedValue(100);
    const dispatch = createServerTransactionDispatcher({ getPendingNonce, store });

    await dispatch(okRequest());
    await dispatch(okRequest());

    expect(getPendingNonce).toHaveBeenCalledTimes(1);
  });

  it('gives concurrent transactions distinct nonces instead of serializing them', async () => {
    const { store } = createMemoryServerTransactionStore(300);
    const dispatch = createServerTransactionDispatcher({
      getPendingNonce: vi.fn().mockResolvedValue(300),
      store,
    });
    const nonces: number[] = [];
    let concurrentSends = 0;
    let peakConcurrency = 0;

    await Promise.all(
      [0, 1, 2].map(() =>
        dispatch({
          succeeded: () => true,
          confirm: async () => {
            concurrentSends -= 1;
            return { status: 'success' };
          },
          send: async (nonce) => {
            nonces.push(nonce);
            concurrentSends += 1;
            peakConcurrency = Math.max(peakConcurrency, concurrentSends);
            await new Promise((resolve) => setTimeout(resolve, 5));
            return HASH;
          },
          simulate: async () => undefined,
        })
      )
    );

    expect([...nonces].sort((a, b) => a - b)).toEqual([300, 301, 302]);
    // The old design held one global lock through confirmation; this must not.
    expect(peakConcurrency).toBeGreaterThan(1);
  });
});

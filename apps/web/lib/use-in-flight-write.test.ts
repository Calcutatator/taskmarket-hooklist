import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useInFlightWrite } from './use-in-flight-write';

const { fetchIntentStatus, refresh } = vi.hoisted(() => ({
  fetchIntentStatus: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock('wagmi', () => ({
  useAccount: () => ({ address: '0x1111111111111111111111111111111111111111' }),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh }),
}));

vi.mock('sonner', () => ({ toast: { info: vi.fn() } }));

vi.mock('@/lib/api/intent-status', () => ({
  fetchIntentStatus: (...args: unknown[]) => fetchIntentStatus(...args),
}));

// The signature is the hook's gate on reading the intent at all, so the two states worth
// testing are "signed" and "not signed". Driven by a mock rather than a real wallet because
// what is under test here is the polling, not the signing.
let readAuthReady = true;
const requestSignature = vi.fn();
vi.mock('@/lib/use-read-auth-signature', () => ({
  useReadAuthSignatureState: () => ({
    error: null,
    ready: readAuthReady,
    requestSignature,
    status: readAuthReady ? 'ready' : 'idle',
  }),
}));

const IN_FLIGHT = { ok: false, pending: true, idempotencyKey: 'key-1', error: 'in flight' };

function statusOf(status: string, extra: Record<string, unknown> = {}) {
  return {
    kind: 'status' as const,
    status: {
      intentId: 'intent-1',
      idempotencyKey: 'key-1',
      operation: 'tasks.create',
      status,
      txHash: null,
      terminalReason: null,
      taskId: null,
      refund: null,
      ...extra,
    },
  };
}

describe('useInFlightWrite', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    readAuthReady = true;
    fetchIntentStatus.mockReset();
    refresh.mockReset();
    requestSignature.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  async function goInFlight() {
    const hook = renderHook(() => useInFlightWrite('Submitted, confirming'));
    await act(async () => {
      expect(await hook.result.current.submit(async () => IN_FLIGHT)).toEqual({ handled: true });
    });
    return hook;
  }

  /** Runs one submission and reports the key the hook handed the transport. */
  async function keyUsedBy(
    hook: ReturnType<typeof renderHook<ReturnType<typeof useInFlightWrite>, unknown>>,
    result: Record<string, unknown>
  ): Promise<string> {
    let seen = '';
    await act(async () => {
      await hook.result.current.submit(async (idempotencyKey) => {
        seen = idempotencyKey;
        return result as never;
      });
    });
    return seen;
  }

  it('asks for a read-auth signature only once a write is actually in flight', async () => {
    const hook = renderHook(() => useInFlightWrite('Submitted, confirming'));
    expect(requestSignature).not.toHaveBeenCalled();

    await act(async () => {
      await hook.result.current.submit(async () => IN_FLIGHT);
    });
    expect(requestSignature).toHaveBeenCalled();
  });

  // The defect this shape exists to make unrepresentable. A plain failure leaves the form
  // rendered, so the next submission is an ordinary thing for a user to do -- and on ten of the
  // sixteen surfaces it carries materially different arguments (a different reward, a different
  // worker, a different artifact set). Presenting the failed operation's key for it would name
  // two different writes with one key.
  it('retires the key after a settled failure, so a corrected retry is a new operation', async () => {
    const hook = renderHook(() => useInFlightWrite('Submitted, confirming'));

    const first = await keyUsedBy(hook, { ok: false, error: 'Reward below the minimum' });
    const second = await keyUsedBy(hook, { ok: false, error: 'Reward below the minimum' });

    expect(first).not.toBe('');
    expect(second).not.toBe(first);
  });

  it('retires the key after a success', async () => {
    const hook = renderHook(() => useInFlightWrite('Submitted, confirming'));

    const first = await keyUsedBy(hook, { ok: true });
    const second = await keyUsedBy(hook, { ok: true });

    expect(second).not.toBe(first);
  });

  // The other half of the rule, and the one ADR-0052 is about: while the outcome is unknown the
  // key is the handle to the write that may already have landed, so it must not move. The
  // fixed-payload buttons depend on this -- a wallet rejection sends nothing, so pressing the
  // button again is a retry of the same operation rather than a second one.
  it('keeps the key across an in-flight outcome and a wallet rejection', async () => {
    const hook = renderHook(() => useInFlightWrite('Submitted, confirming'));

    const first = await keyUsedBy(hook, {
      ok: false,
      rejected: true,
      error: 'Cancelled in wallet',
    });
    const second = await keyUsedBy(hook, { ok: false, pending: true, error: 'in flight' });

    expect(second).toBe(first);
    expect(hook.result.current.state?.idempotencyKey).toBe(first);
  });

  // No result at all is the ambiguous case, not the terminal one: the write may well have
  // landed. Retiring the key here would hand the retry a fresh one and buy the write twice.
  it('keeps the key when the submission throws', async () => {
    const hook = renderHook(() => useInFlightWrite('Submitted, confirming'));

    let first = '';
    await act(async () => {
      await expect(
        hook.result.current.submit(async (idempotencyKey) => {
          first = idempotencyKey;
          throw new Error('Failed to fetch');
        })
      ).rejects.toThrow('Failed to fetch');
    });

    expect(await keyUsedBy(hook, { ok: true })).toBe(first);
  });

  it('reports a failed intent with its reason and refund state', async () => {
    fetchIntentStatus.mockResolvedValue(
      statusOf('failed', {
        terminalReason: 'escrow deposit reverted',
        refund: { status: 'refunded', txHash: '0xabc' },
      })
    );
    const hook = await goInFlight();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });

    expect(hook.result.current.failure).toEqual({
      reason: 'escrow deposit reverted',
      refund: { status: 'refunded', txHash: '0xabc' },
    });

    // Terminal: the answer has arrived, so there is nothing left to poll for.
    const callsAtFailure = fetchIntentStatus.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15000);
    });
    expect(fetchIntentStatus.mock.calls.length).toBe(callsAtFailure);
  });

  it('keeps waiting on a reservation, which is not an outcome', async () => {
    // ADR-0067's pre-payment state. It is readable by the holder of the idempotency key, which
    // is this viewer, and it says only that the write has not finished being paid for -- so the
    // notice must keep saying "confirming" rather than settling on a verdict there is none of.
    fetchIntentStatus.mockResolvedValue(statusOf('reserved', { operation: 'x402.reservation' }));
    const hook = await goInFlight();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(15000);
    });

    expect(fetchIntentStatus.mock.calls.length).toBeGreaterThan(1);
    expect(hook.result.current.failure).toBeNull();
    expect(hook.result.current.stalled).toBe(false);
  });

  it('stops asking once the intent comes back unreadable, and keeps refreshing the page', async () => {
    // The viewer is not the intent's initiator (ADR-0059) -- a third-party-funded submission.
    // The surface must degrade to what it did before this read existed, not show an error.
    fetchIntentStatus.mockResolvedValue({ kind: 'unreadable' });
    const hook = await goInFlight();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(15000);
    });

    expect(fetchIntentStatus).toHaveBeenCalledTimes(1);
    expect(refresh.mock.calls.length).toBeGreaterThan(1);
    expect(hook.result.current.failure).toBeNull();
  });

  it('does not read the intent while no signature is held', async () => {
    readAuthReady = false;
    await goInFlight();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(15000);
    });

    expect(fetchIntentStatus).not.toHaveBeenCalled();
    expect(refresh).toHaveBeenCalled();
  });

  it('treats an unavailable answer as no news and asks again', async () => {
    fetchIntentStatus.mockResolvedValue({ kind: 'unavailable' });
    const hook = await goInFlight();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(15000);
    });

    expect(fetchIntentStatus.mock.calls.length).toBeGreaterThan(1);
    expect(hook.result.current.failure).toBeNull();
  });
});

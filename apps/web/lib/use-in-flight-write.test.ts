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
    act(() => {
      expect(hook.result.current.capture(IN_FLIGHT)).toBe(true);
    });
    return hook;
  }

  it('asks for a read-auth signature only once a write is actually in flight', async () => {
    const hook = renderHook(() => useInFlightWrite('Submitted, confirming'));
    expect(requestSignature).not.toHaveBeenCalled();

    act(() => {
      hook.result.current.capture(IN_FLIGHT);
    });
    expect(requestSignature).toHaveBeenCalled();
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

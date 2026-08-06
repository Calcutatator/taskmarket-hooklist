import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { actionQueueUseQuery, invalidateActionQueue } = vi.hoisted(() => ({
  actionQueueUseQuery: vi.fn(() => ({ data: undefined, isLoading: false })),
  invalidateActionQueue: vi.fn(() => Promise.resolve()),
}));

vi.mock('@/lib/api/client', () => ({
  trpc: {
    agents: {
      actionQueue: {
        useQuery: actionQueueUseQuery,
      },
    },
    useUtils: () => ({
      agents: {
        actionQueue: {
          invalidate: invalidateActionQueue,
        },
      },
    }),
  },
}));

import {
  ACTION_QUEUE_POLL_INTERVAL_MS,
  useActionQueue,
  useInvalidateActionQueue,
} from './use-action-queue';

const ADDRESS = '0x1111111111111111111111111111111111111111' as const;

describe('useActionQueue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shares the canonical query with bounded polling and focus refresh', () => {
    renderHook(() => useActionQueue(ADDRESS));

    expect(actionQueueUseQuery).toHaveBeenCalledWith(
      { address: ADDRESS },
      {
        enabled: true,
        refetchInterval: ACTION_QUEUE_POLL_INTERVAL_MS,
        refetchOnWindowFocus: true,
      }
    );
    expect(ACTION_QUEUE_POLL_INTERVAL_MS).toBe(30_000);
  });

  it('renders the public queue without requiring wallet verification', () => {
    const { result } = renderHook(() => useActionQueue(ADDRESS, { readAuthReady: false }));

    expect(actionQueueUseQuery).toHaveBeenCalled();
    expect(invalidateActionQueue).not.toHaveBeenCalled();
    expect(result.current.callerScopedReady).toBe(false);
  });

  it('invalidates once when read authentication adds private and unlisted actions', async () => {
    const { rerender, result } = renderHook(
      ({ readAuthReady }) => useActionQueue(ADDRESS, { readAuthReady }),
      { initialProps: { readAuthReady: false } }
    );

    rerender({ readAuthReady: true });

    expect(result.current.callerScopedReady).toBe(false);

    await waitFor(() => expect(invalidateActionQueue).toHaveBeenCalledTimes(1));
    expect(invalidateActionQueue).toHaveBeenCalledWith({ address: ADDRESS });
    await waitFor(() => expect(result.current.callerScopedReady).toBe(true));

    rerender({ readAuthReady: true });
    expect(invalidateActionQueue).toHaveBeenCalledTimes(1);
  });

  it('refreshes before exposing caller-scoped data when authentication is ready at mount', async () => {
    let finishInvalidation: (() => void) | undefined;
    invalidateActionQueue.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishInvalidation = resolve;
        })
    );

    const { result } = renderHook(() => useActionQueue(ADDRESS, { readAuthReady: true }));

    expect(invalidateActionQueue).toHaveBeenCalledWith({ address: ADDRESS });
    expect(result.current.callerScopedReady).toBe(false);

    await act(async () => finishInvalidation?.());
    await waitFor(() => expect(result.current.callerScopedReady).toBe(true));
  });

  it('refreshes the caller scope before exposing a switched wallet projection', async () => {
    const otherAddress = '0x2222222222222222222222222222222222222222' as const;
    const { rerender, result } = renderHook(
      ({ address }: { address: `0x${string}` }) => useActionQueue(address, { readAuthReady: true }),
      { initialProps: { address: ADDRESS as `0x${string}` } }
    );

    await waitFor(() => expect(result.current.callerScopedReady).toBe(true));
    rerender({ address: otherAddress });

    expect(result.current.callerScopedReady).toBe(false);
    await waitFor(() =>
      expect(invalidateActionQueue).toHaveBeenCalledWith({ address: otherAddress })
    );
    await waitFor(() => expect(result.current.callerScopedReady).toBe(true));
  });

  it('provides explicit invalidation for successful lifecycle mutations', async () => {
    const { result } = renderHook(() => useInvalidateActionQueue());

    await act(async () => result.current());

    expect(invalidateActionQueue).toHaveBeenCalledWith();
  });

  it('does not query until an address is connected', () => {
    renderHook(() => useActionQueue(undefined));

    expect(actionQueueUseQuery).toHaveBeenCalledWith(
      { address: '' },
      expect.objectContaining({ enabled: false })
    );
  });
});

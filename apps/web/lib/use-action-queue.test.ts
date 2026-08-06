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
    renderHook(() => useActionQueue(ADDRESS, { readAuthReady: false }));

    expect(actionQueueUseQuery).toHaveBeenCalled();
    expect(invalidateActionQueue).not.toHaveBeenCalled();
  });

  it('invalidates once when read authentication adds private and unlisted actions', async () => {
    const { rerender } = renderHook(
      ({ readAuthReady }) => useActionQueue(ADDRESS, { readAuthReady }),
      { initialProps: { readAuthReady: false } }
    );

    rerender({ readAuthReady: true });

    await waitFor(() => expect(invalidateActionQueue).toHaveBeenCalledTimes(1));
    expect(invalidateActionQueue).toHaveBeenCalledWith({ address: ADDRESS });

    rerender({ readAuthReady: true });
    expect(invalidateActionQueue).toHaveBeenCalledTimes(1);
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

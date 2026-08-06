'use client';

import { useCallback, useEffect, useRef } from 'react';

import { trpc } from '@/lib/api/client';

export const ACTION_QUEUE_POLL_INTERVAL_MS = 30_000;

type UseActionQueueOptions = {
  enabled?: boolean;
  readAuthReady?: boolean;
};

export function useActionQueue(
  address: `0x${string}` | undefined,
  { enabled = true, readAuthReady = false }: UseActionQueueOptions = {}
) {
  const utils = trpc.useUtils();
  const previousReadAuthReady = useRef(readAuthReady);
  const query = trpc.agents.actionQueue.useQuery(
    { address: address ?? '' },
    {
      enabled: Boolean(enabled && address),
      refetchInterval: ACTION_QUEUE_POLL_INTERVAL_MS,
      refetchOnWindowFocus: true,
    }
  );

  // The hook deliberately does not request a wallet signature. Its first render is the
  // anonymous, discoverable-only queue. A surface that intentionally verifies the wallet
  // passes readAuthReady once the shared headers are cached, triggering exactly one refresh.
  useEffect(() => {
    if (address && readAuthReady && !previousReadAuthReady.current) {
      void utils.agents.actionQueue.invalidate({ address });
    }
    previousReadAuthReady.current = readAuthReady;
  }, [address, readAuthReady, utils]);

  return query;
}

export function useInvalidateActionQueue(): () => Promise<void> {
  const utils = trpc.useUtils();
  return useCallback(async () => {
    await utils.agents.actionQueue.invalidate();
  }, [utils]);
}

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

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
  const [callerScopedReadyFor, setCallerScopedReadyFor] = useState<string | null>(null);
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
    let active = true;
    const normalizedAddress = address?.toLowerCase() ?? null;
    if (!normalizedAddress || !readAuthReady) {
      setCallerScopedReadyFor(null);
      previousReadAuthReady.current = readAuthReady;
      return () => {
        active = false;
      };
    }

    if (address && readAuthReady && !previousReadAuthReady.current) {
      setCallerScopedReadyFor(null);
      void utils.agents.actionQueue.invalidate({ address }).then(() => {
        if (active) setCallerScopedReadyFor(normalizedAddress);
      });
    } else if (callerScopedReadyFor !== normalizedAddress) {
      setCallerScopedReadyFor(null);
      void utils.agents.actionQueue.invalidate({ address }).then(() => {
        if (active) setCallerScopedReadyFor(normalizedAddress);
      });
    }
    previousReadAuthReady.current = readAuthReady;
    return () => {
      active = false;
    };
  }, [address, callerScopedReadyFor, readAuthReady, utils]);

  return {
    ...query,
    callerScopedReady: Boolean(
      address && readAuthReady && callerScopedReadyFor === address.toLowerCase()
    ),
  };
}

export function useInvalidateActionQueue(): () => Promise<void> {
  const utils = trpc.useUtils();
  return useCallback(async () => {
    await utils.agents.actionQueue.invalidate();
  }, [utils]);
}

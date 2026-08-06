import { useCallback, useEffect, useRef, useState } from 'react';
import { useSignMessage } from 'wagmi';
import {
  buildReadAuthMessage,
  READ_AUTH_ADDRESS_HEADER,
  READ_AUTH_SIGNATURE_HEADER,
} from '@taskmarket/shared';
import {
  getCachedReadAuthAddress,
  getOrCreateCachedReadAuthHeaders,
  removeReadAuthConsumer,
  updateReadAuthConsumerAddress,
} from './read-auth';

// Proves ownership of the connected wallet (Phase 2's ctx.caller mechanism,
// ADR-0016/ADR-0023) so reads that branch on caller identity -- agents.inbox's
// own unlisted tasks, submission-visibility gating, etc. -- see this wallet as
// authenticated. Signs taskmarket:read:<address> once per address per
// in-memory wallet session and caches the resulting headers (read globally by the
// tRPC client in api/client.tsx) so a poll or refetch reuses them rather than
// re-prompting the wallet. A rejected or failed signature is non-fatal --
// callers still run their query, just without caller-scoped data, same as any
// other anonymous reader. Returns whether a verified signature is currently
// cached, so callers can invalidate/refetch once it becomes available.
export type ReadAuthSignatureState = {
  error: string | null;
  ready: boolean;
  requestSignature: () => void;
  status: 'idle' | 'signing' | 'ready' | 'error';
};

export function useReadAuthSignatureState(
  address: `0x${string}` | undefined,
  { autoStart = true }: { autoStart?: boolean } = {}
): ReadAuthSignatureState {
  const { signMessageAsync } = useSignMessage();
  const [readyFor, setReadyFor] = useState<string | undefined>(() => {
    const normalizedAddress = address?.toLowerCase();
    return normalizedAddress && getCachedReadAuthAddress() === normalizedAddress
      ? normalizedAddress
      : undefined;
  });
  const [attempt, setAttempt] = useState(autoStart ? 1 : 0);
  const [requestedFor, setRequestedFor] = useState<string | undefined>(undefined);
  const [status, setStatus] = useState<ReadAuthSignatureState['status']>('idle');
  const [error, setError] = useState<string | null>(null);
  const consumerRef = useRef<object>({});
  const requestIdRef = useRef(0);
  const pendingRef = useRef<{
    attempt: number;
    normalizedAddress: string;
    promise: Promise<`0x${string}`>;
    requestId: number;
  } | null>(null);
  const normalizedAddress = address?.toLowerCase();

  const requestSignature = useCallback(() => {
    if (!normalizedAddress) return;
    setRequestedFor(normalizedAddress);
    setAttempt((current) => current + 1);
  }, [normalizedAddress]);

  useEffect(() => {
    updateReadAuthConsumerAddress(consumerRef.current, address);
  }, [address]);

  useEffect(
    () => () => {
      removeReadAuthConsumer(consumerRef.current);
    },
    []
  );

  useEffect(() => {
    if (!address) {
      requestIdRef.current += 1;
      pendingRef.current = null;
      setReadyFor(undefined);
      setRequestedFor(undefined);
      setError(null);
      setStatus('idle');
      return;
    }

    const currentNormalizedAddress = address.toLowerCase();
    if (getCachedReadAuthAddress() === currentNormalizedAddress) {
      pendingRef.current = null;
      setReadyFor(currentNormalizedAddress);
      setError(null);
      setStatus('ready');
      return;
    }

    if (!autoStart && requestedFor !== normalizedAddress) {
      requestIdRef.current += 1;
      pendingRef.current = null;
      setReadyFor(undefined);
      setError(null);
      setStatus('idle');
      return;
    }

    let pending = pendingRef.current;
    if (
      !pending ||
      pending.normalizedAddress !== currentNormalizedAddress ||
      pending.attempt !== attempt
    ) {
      const requestId = ++requestIdRef.current;
      setReadyFor(undefined);
      setError(null);
      setStatus('signing');
      pending = {
        attempt,
        normalizedAddress: currentNormalizedAddress,
        promise: getOrCreateCachedReadAuthHeaders(address, async () => {
          const signature = await signMessageAsync({ message: buildReadAuthMessage(address) });
          return {
            [READ_AUTH_ADDRESS_HEADER]: address,
            [READ_AUTH_SIGNATURE_HEADER]: signature,
          };
        }).then((headers) => headers[READ_AUTH_SIGNATURE_HEADER] as `0x${string}`),
        requestId,
      };
      pendingRef.current = pending;
    }

    let active = true;
    const currentPending = pending;
    currentPending.promise
      .then(() => {
        if (!active || requestIdRef.current !== currentPending.requestId) return;
        if (getCachedReadAuthAddress() !== currentPending.normalizedAddress) return;
        setReadyFor(currentPending.normalizedAddress);
        setError(null);
        setStatus('ready');
      })
      .catch(() => {
        if (!active || requestIdRef.current !== currentPending.requestId) return;
        setReadyFor(undefined);
        setError('The wallet did not approve the verification request. Try again.');
        setStatus('error');
      });

    // A wallet signature can settle after this consumer has unmounted. The shared
    // session still caches it, but this disposed consumer must not update local state.
    return () => {
      active = false;
    };
  }, [address, attempt, autoStart, normalizedAddress, requestedFor, signMessageAsync]);

  return {
    error,
    ready: Boolean(normalizedAddress && readyFor === normalizedAddress),
    requestSignature,
    status,
  };
}

export function useReadAuthSignature(address: `0x${string}` | undefined): boolean {
  return useReadAuthSignatureState(address).ready;
}

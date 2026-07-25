import { useEffect, useRef, useState } from 'react';
import { useSignMessage } from 'wagmi';
import {
  buildReadAuthMessage,
  READ_AUTH_ADDRESS_HEADER,
  READ_AUTH_SIGNATURE_HEADER,
} from '@taskmarket/shared';
import { clearCachedReadAuthHeaders, setCachedReadAuthHeaders } from './read-auth';

// Proves ownership of the connected wallet (Phase 2's ctx.caller mechanism,
// ADR-0016/ADR-0022) so reads that branch on caller identity -- agents.inbox's
// own unlisted tasks, submission-visibility gating, etc. -- see this wallet as
// authenticated. Signs taskmarket:read:<address> once per address per
// component lifetime and caches the resulting headers (read globally by the
// tRPC client in api/client.tsx) so a poll or refetch reuses them rather than
// re-prompting the wallet. A rejected or failed signature is non-fatal --
// callers still run their query, just without caller-scoped data, same as any
// other anonymous reader. Returns whether a verified signature is currently
// cached, so callers can invalidate/refetch once it becomes available.
export function useReadAuthSignature(address: `0x${string}` | undefined): boolean {
  const { signMessageAsync } = useSignMessage();
  const [readyFor, setReadyFor] = useState<string | undefined>(undefined);
  const requestIdRef = useRef(0);
  const pendingRef = useRef<{
    address: `0x${string}`;
    normalizedAddress: string;
    promise: Promise<`0x${string}`>;
    requestId: number;
  } | null>(null);
  const normalizedAddress = address?.toLowerCase();

  useEffect(() => {
    if (!address) {
      requestIdRef.current += 1;
      pendingRef.current = null;
      clearCachedReadAuthHeaders();
      setReadyFor(undefined);
      return;
    }

    const currentNormalizedAddress = address.toLowerCase();
    let pending = pendingRef.current;
    if (!pending || pending.normalizedAddress !== currentNormalizedAddress) {
      const requestId = ++requestIdRef.current;
      clearCachedReadAuthHeaders();
      setReadyFor(undefined);
      pending = {
        address,
        normalizedAddress: currentNormalizedAddress,
        promise: signMessageAsync({ message: buildReadAuthMessage(address) }),
        requestId,
      };
      pendingRef.current = pending;
    }

    let active = true;
    const currentPending = pending;
    currentPending.promise
      .then((signature) => {
        if (!active || requestIdRef.current !== currentPending.requestId) return;
        setCachedReadAuthHeaders(currentPending.address, {
          [READ_AUTH_ADDRESS_HEADER]: currentPending.address,
          [READ_AUTH_SIGNATURE_HEADER]: signature,
        });
        setReadyFor(currentPending.normalizedAddress);
      })
      .catch(() => {
        if (!active || requestIdRef.current !== currentPending.requestId) return;
        clearCachedReadAuthHeaders();
        setReadyFor(undefined);
      });

    // A wallet signature can settle after this consumer has unmounted. Keep the
    // pending promise reusable across React's effect replay, but prevent this
    // effect instance from mutating the process-wide auth cache once disposed.
    return () => {
      active = false;
    };
  }, [address, normalizedAddress, signMessageAsync]);

  return Boolean(normalizedAddress && readyFor === normalizedAddress);
}

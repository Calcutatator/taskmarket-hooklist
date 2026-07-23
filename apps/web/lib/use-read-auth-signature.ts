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
  const [ready, setReady] = useState(false);
  const attemptedForRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (!address) {
      clearCachedReadAuthHeaders();
      setReady(false);
      attemptedForRef.current = undefined;
      return;
    }
    if (attemptedForRef.current === address) {
      return;
    }
    attemptedForRef.current = address;
    setReady(false);
    signMessageAsync({ message: buildReadAuthMessage(address) })
      .then((signature) => {
        setCachedReadAuthHeaders(address, {
          [READ_AUTH_ADDRESS_HEADER]: address,
          [READ_AUTH_SIGNATURE_HEADER]: signature,
        });
        setReady(true);
      })
      .catch(() => {
        clearCachedReadAuthHeaders();
        setReady(false);
      });
  }, [address, signMessageAsync]);

  return ready;
}

import { useEffect, useRef, useState } from 'react';
import { useSignMessage } from 'wagmi';
import { buildInboxSelfAuthMessage } from '@taskmarket/shared';

// Proves ownership of the connected wallet so agents.inbox also returns this
// wallet's own unlisted tasks (ADR-0015). Signs taskmarket:inbox:<address> once
// per address per component lifetime and caches the result, so a poll or
// refetch reuses it rather than re-prompting the wallet. A rejected or failed
// signature is non-fatal -- callers should still run the query, just without
// unlisted tasks, same as any other reader.
export function useInboxSelfAuthSignature(address: `0x${string}` | undefined) {
  const { signMessageAsync } = useSignMessage();
  const [signature, setSignature] = useState<string | undefined>(undefined);
  const attemptedForRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (!address) {
      setSignature(undefined);
      attemptedForRef.current = undefined;
      return;
    }
    if (attemptedForRef.current === address) {
      return;
    }
    attemptedForRef.current = address;
    signMessageAsync({ message: buildInboxSelfAuthMessage(address) })
      .then((sig) => setSignature(sig))
      .catch(() => setSignature(undefined));
  }, [address, signMessageAsync]);

  return signature;
}

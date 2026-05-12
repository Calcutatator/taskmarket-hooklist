'use client';

import { useState } from 'react';
import { useAccount, useSignMessage } from 'wagmi';

import { Button } from '@/components/ui/button';
import { getBrowserApiBaseUrl } from '@/lib/api/config';
import { signAndPost } from '@/lib/wallet-sign-action';

import { ConnectPrompt } from './connect-prompt';
import type { TaskActionComponentProps } from './types';

export function ClaimButton({ disabled, task }: TaskActionComponentProps) {
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  if (!isConnected || !address) {
    return <ConnectPrompt label="Connect a worker wallet to claim this task." />;
  }

  async function handleClaim() {
    setPending(true);
    setError(null);
    const result = await signAndPost<{ claimId: string }>({
      deps: { address: address!, apiUrl: getBrowserApiBaseUrl(), signMessageAsync },
      path: `/api/tasks/${task.id}/claim`,
      taskId: task.id,
      verbForMessage: 'claim',
    });
    setPending(false);
    if (result.ok) {
      setDone(true);
    } else if (!result.rejected) {
      setError(result.error);
    }
  }

  if (done) {
    return <span className="font-mono text-sm text-primary">✓ Claimed</span>;
  }

  return (
    <div className="grid gap-2">
      <Button disabled={disabled || pending} onClick={handleClaim} size="sm">
        {pending ? 'Claiming…' : 'Claim task'}
      </Button>
      <p className="text-xs text-muted-foreground">Wallet signature only. No payment needed.</p>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}

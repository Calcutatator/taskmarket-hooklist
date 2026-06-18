'use client';

import { CircleCheckIcon } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { useAccount, useSignMessage } from 'wagmi';

import { Button } from '@/components/ui/button';
import { getBrowserApiBaseUrl } from '@/lib/api/config';
import { signAndPost } from '@/lib/wallet-sign-action';

import { ConnectPrompt } from './connect-prompt';
import type { TaskActionComponentProps } from './types';

export function ClaimButton({ disabled, onSuccess, task }: TaskActionComponentProps) {
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
      onSuccess?.();
      toast.success('Claimed');
    } else if (!result.rejected) {
      setError(result.error);
      toast.error(result.error);
    }
  }

  if (done) {
    return (
      <div className="grid gap-1 text-sm">
        <span className="flex items-center gap-1.5 font-mono text-primary">
          <CircleCheckIcon aria-hidden="true" className="size-4" />
          Claimed
        </span>
        <p className="text-xs text-muted-foreground">
          Start the work and submit your deliverable when ready.
        </p>
      </div>
    );
  }

  return (
    <div className="grid gap-2">
      <Button disabled={disabled || pending} onClick={handleClaim} size="sm">
        {pending ? 'Claiming...' : 'Claim task'}
      </Button>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}

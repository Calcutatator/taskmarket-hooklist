'use client';

import { CircleCheckIcon } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { useAccount, useSignMessage } from 'wagmi';

import { InFlightWriteNotice } from '@/components/market/in-flight-write-notice';
import { Button } from '@/components/ui/button';
import { getBrowserApiBaseUrl } from '@/lib/api/config';
import { useInFlightWrite } from '@/lib/use-in-flight-write';
import { signAndPost } from '@/lib/wallet-sign-action';

import { ConnectPrompt } from './connect-prompt';
import type { TaskActionComponentProps } from './types';

export function ClaimButton({ disabled, onSuccess, task }: TaskActionComponentProps) {
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const inFlight = useInFlightWrite('Claim submitted, confirming');

  // Checked before every other branch, including the disconnected one: the write is already
  // out there, so this state must survive anything that would otherwise swap the surface.
  // A claim is relayed but unpaid, so `paid` is false -- resubmitting costs nothing, but it
  // is still a second write rather than a retry.
  if (inFlight.state) {
    return (
      <InFlightWriteNotice
        idempotencyKey={inFlight.state.idempotencyKey}
        paid={false}
        stalled={inFlight.stalled}
        subject="claim"
        title="Claim submitted, confirming"
      />
    );
  }

  if (!isConnected || !address) {
    return <ConnectPrompt label="Connect a worker wallet to claim this task." />;
  }

  async function handleClaim() {
    setPending(true);
    setError(null);
    const result = await signAndPost<{ claimId: string }>({
      deps: { address: address!, apiUrl: getBrowserApiBaseUrl(), signMessageAsync },
      idempotencyKey: inFlight.idempotencyKey,
      path: `/api/tasks/${task.id}/claim`,
      taskId: task.id,
      verbForMessage: 'claim',
    });
    setPending(false);
    if (result.ok) {
      setDone(true);
      onSuccess?.();
      toast.success('Claimed');
      return;
    }
    // Neither success nor failure, so it must not reach the error path below, which leaves
    // the claim button live.
    if (inFlight.capture(result)) return;
    if (!result.rejected) {
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

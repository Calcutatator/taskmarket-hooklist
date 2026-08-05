'use client';

import { CircleCheckIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { useAccount, useSignMessage } from 'wagmi';

import { InFlightWriteNotice } from '@/components/market/in-flight-write-notice';
import { Button } from '@/components/ui/button';
import { getBrowserApiBaseUrl } from '@/lib/api/config';
import { useInFlightWrite } from '@/lib/use-in-flight-write';
import { signAndPost } from '@/lib/wallet-sign-action';

import { ConnectPrompt } from './connect-prompt';
import type { TaskActionComponentProps } from './types';

export function SelectWinnerButton({ disabled, onSuccess, task }: TaskActionComponentProps) {
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const inFlight = useInFlightWrite('Winner selection submitted, confirming');

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  // Checked before every other branch, including the disconnected one: the write is already
  // out there, so this state must survive anything that would otherwise swap the surface.
  // Selecting a winner is relayed but unpaid, so `paid` is false.
  if (inFlight.state) {
    return (
      <InFlightWriteNotice
        failure={inFlight.failure}
        idempotencyKey={inFlight.state.idempotencyKey}
        paid={false}
        stalled={inFlight.stalled}
        subject="winner selection"
        title="Winner selection submitted, confirming"
      />
    );
  }

  if (!isConnected || !address) {
    return <ConnectPrompt label="Connect the requester wallet to select the winning bid." />;
  }

  const bidDeadline = (task as { bidDeadline?: string | null }).bidDeadline;
  const remainingMs = bidDeadline ? new Date(bidDeadline).getTime() - now : null;
  const stillOpen = remainingMs !== null && remainingMs > 0;
  const countdown =
    stillOpen && remainingMs !== null
      ? `${Math.floor(remainingMs / 60000)}m ${Math.floor((remainingMs % 60000) / 1000)}s`
      : null;

  async function handleSelect() {
    setPending(true);
    setError(null);

    // Signs `taskmarket:select-winner:<taskId>` and posts `{ taskId, requesterAddress,
    // signature }` -- exactly what `signAndPost` builds, so the hand-rolled copy that used to
    // live here is gone and this path picks up the in-flight outcome with everything else.
    const outcome = await inFlight.submit((idempotencyKey) =>
      signAndPost<{ txHash?: string }>({
        addressField: 'requesterAddress',
        deps: { address: address!, apiUrl: getBrowserApiBaseUrl(), signMessageAsync },
        idempotencyKey,
        path: `/api/tasks/${task.id}/bids/select-winner`,
        taskId: task.id,
        verbForMessage: 'select-winner',
      })
    );
    setPending(false);

    // Neither success nor failure, so it must not reach the error path below, which leaves
    // the select button live.
    if (outcome.handled) return;
    const result = outcome.result;
    if (result.ok) {
      setDone(true);
      onSuccess?.();
      toast.success('Winner selected');
      return;
    }
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
          Winner selected
        </span>
        <p className="text-xs text-muted-foreground">
          The winning bidder can now begin work on this task.
        </p>
      </div>
    );
  }

  if (stillOpen) {
    return (
      <div className="grid gap-2">
        <Button aria-disabled disabled size="sm">
          Select winner - available in {countdown}
        </Button>
        <p className="text-xs text-muted-foreground">Available after the bid deadline passes.</p>
      </div>
    );
  }

  return (
    <div className="grid gap-2">
      <Button disabled={disabled || pending} onClick={handleSelect} size="sm">
        {pending ? 'Confirming...' : 'Select winner'}
      </Button>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}

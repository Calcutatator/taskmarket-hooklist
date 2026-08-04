'use client';

import { CircleCheckIcon } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { useAccount, useSignMessage } from 'wagmi';

import { InFlightWriteNotice } from '@/components/market/in-flight-write-notice';
import { Button } from '@/components/ui/button';
import { getBrowserApiBaseUrl } from '@/lib/api/config';
import { explorerTxUrl } from '@/lib/explorer';
import { useInFlightWrite } from '@/lib/use-in-flight-write';
import { signAndPost } from '@/lib/wallet-sign-action';

import { ConfirmDialog } from './confirm-dialog';
import { ConnectPrompt } from './connect-prompt';
import type { TaskActionComponentProps } from './types';

export function ForfeitButton({ disabled, onSuccess, task }: TaskActionComponentProps) {
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const inFlight = useInFlightWrite('Forfeit submitted, confirming');

  // Checked before every other branch, including the disconnected one: the write is already
  // out there, so this state must survive anything that would otherwise swap the surface.
  // A forfeit is relayed but unpaid, so `paid` is false.
  if (inFlight.state) {
    return (
      <InFlightWriteNotice
        idempotencyKey={inFlight.state.idempotencyKey}
        paid={false}
        stalled={inFlight.stalled}
        subject="forfeit"
        title="Forfeit submitted, confirming"
      />
    );
  }

  if (!isConnected || !address) {
    return <ConnectPrompt label="Connect the requester wallet to forfeit this claim." />;
  }

  async function handleForfeit() {
    setPending(true);
    setError(null);
    const result = await signAndPost<{ txHash: string }>({
      addressField: 'requesterAddress',
      deps: { address: address!, apiUrl: getBrowserApiBaseUrl(), signMessageAsync },
      idempotencyKey: inFlight.idempotencyKey,
      path: `/api/tasks/${task.id}/forfeit`,
      taskId: task.id,
      verbForMessage: 'forfeit',
    });
    setPending(false);
    if (result.ok) {
      setDone(true);
      const resolvedTxHash = result.data.txHash ?? result.txHash ?? null;
      setTxHash(resolvedTxHash);
      onSuccess?.();
      const url = resolvedTxHash ? explorerTxUrl(resolvedTxHash) : null;
      toast.success(
        'Forfeited',
        url
          ? { action: { label: 'View on explorer', onClick: () => window.open(url, '_blank') } }
          : undefined
      );
      return;
    }
    // Neither success nor failure, so it must not reach the error path below, which leaves
    // the forfeit button live.
    if (inFlight.capture(result)) return;
    if (!result.rejected) {
      setError(result.error);
      toast.error(result.error);
    }
  }

  if (done) {
    const url = txHash ? explorerTxUrl(txHash) : null;
    return (
      <div className="grid gap-1 text-sm">
        <span className="flex items-center gap-1.5 font-mono text-primary">
          <CircleCheckIcon aria-hidden="true" className="size-4" />
          Forfeited
        </span>
        {url ? (
          <a
            className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            href={url}
            rel="noreferrer"
            target="_blank"
          >
            View on explorer
          </a>
        ) : null}
      </div>
    );
  }

  return (
    <div className="grid gap-2">
      <ConfirmDialog
        confirmCta="Forfeit claim"
        description="Reclaim this task from the current worker because their claim has expired. The task returns to 'open' and any stake is forfeited to you. The contract enforces the expiry - if the worker's claim is still active this will revert."
        disabled={disabled || pending}
        loadingCta="Forfeiting..."
        onConfirm={handleForfeit}
        title="Forfeit this claim?"
      >
        <Button disabled={disabled || pending} size="sm" variant="destructive">
          Forfeit claim
        </Button>
      </ConfirmDialog>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}

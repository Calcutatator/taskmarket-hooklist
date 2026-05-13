'use client';

import { useState } from 'react';
import { useAccount, useSignMessage } from 'wagmi';

import { Button } from '@/components/ui/button';
import { getBrowserApiBaseUrl } from '@/lib/api/config';
import { explorerTxUrl } from '@/lib/explorer';
import { signAndPost } from '@/lib/wallet-sign-action';

import { ConfirmDialog } from './confirm-dialog';
import { ConnectPrompt } from './connect-prompt';
import type { TaskActionComponentProps } from './types';

export function ForfeitButton({ disabled, task }: TaskActionComponentProps) {
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  if (!isConnected || !address) {
    return <ConnectPrompt label="Connect the requester wallet to forfeit this claim." />;
  }

  async function handleForfeit() {
    setPending(true);
    setError(null);
    const result = await signAndPost<{ txHash: string }>({
      addressField: 'requesterAddress',
      deps: { address: address!, apiUrl: getBrowserApiBaseUrl(), signMessageAsync },
      path: `/api/tasks/${task.id}/forfeit`,
      taskId: task.id,
      verbForMessage: 'forfeit',
    });
    setPending(false);
    if (result.ok) {
      setDone(true);
      setTxHash(result.data.txHash ?? result.txHash ?? null);
    } else if (!result.rejected) {
      setError(result.error);
    }
  }

  if (done) {
    const url = txHash ? explorerTxUrl(txHash) : null;
    return (
      <div className="grid gap-1 text-sm">
        <span className="font-mono text-primary">✓ Forfeited</span>
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
        description="Reclaim this task from the current worker because their claim has expired. The task returns to 'open' and any stake is forfeited to you. The contract enforces the expiry — if the worker's claim is still active this will revert."
        disabled={disabled || pending}
        loadingCta="Forfeiting…"
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

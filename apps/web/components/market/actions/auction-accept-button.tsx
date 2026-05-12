'use client';

import { useEffect, useState } from 'react';
import { useAccount, useSignTypedData, useSwitchChain } from 'wagmi';

import { Button } from '@/components/ui/button';
import { getBrowserApiBaseUrl } from '@/lib/api/config';
import { explorerTxUrl } from '@/lib/explorer';
import { payX402Post, type X402Step } from '@/lib/x402-client';

import { ConnectPrompt } from './connect-prompt';
import type { TaskActionComponentProps } from './types';

function formatUsdc(value: string | null | undefined): string {
  const parsed = Number(value ?? 0) / 1_000_000;
  if (!Number.isFinite(parsed)) return '0.000';
  return parsed.toFixed(3);
}

export function AuctionAcceptButton({ disabled, task }: TaskActionComponentProps) {
  const { address, isConnected } = useAccount();
  const { signTypedDataAsync } = useSignTypedData();
  const { switchChainAsync } = useSwitchChain();
  const [step, setStep] = useState<X402Step | 'done' | 'idle'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);

  // Refresh the clock price every 5s by re-fetching the task — dutch/reverse_dutch
  // price changes on the wall clock, so a stale SSR snapshot would mislead.
  const [livePrice, setLivePrice] = useState<string | null>(
    (task as { currentAuctionPrice?: string | null }).currentAuctionPrice ?? null
  );

  useEffect(() => {
    if (!isConnected) return;
    let cancelled = false;

    async function poll() {
      try {
        const res = await fetch(`${getBrowserApiBaseUrl()}/api/tasks/${task.id}`);
        if (!res.ok) return;
        const data = (await res.json()) as { currentAuctionPrice?: string | null };
        if (!cancelled && data.currentAuctionPrice) setLivePrice(data.currentAuctionPrice);
      } catch {
        // ignore polling errors
      }
    }

    const id = window.setInterval(poll, 5000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [task.id, isConnected]);

  if (!isConnected || !address) {
    return <ConnectPrompt label="Connect a worker wallet to accept this auction price." />;
  }

  const bidDeadline = (task as { bidDeadline?: string | null }).bidDeadline;
  const expired = bidDeadline ? new Date(bidDeadline) <= new Date() : false;

  if (expired) {
    return (
      <p className="text-sm text-muted-foreground">Auction ended; no more accepts accepted.</p>
    );
  }

  const busy = step !== 'idle' && step !== 'done';

  async function handleAccept() {
    setError(null);
    const result = await payX402Post<{ txHash?: string }>(
      `/api/tasks/${task.id}/bids/accept`,
      { taskId: task.id },
      { address: address!, apiUrl: getBrowserApiBaseUrl(), signTypedDataAsync, switchChainAsync },
      setStep
    );
    if (result.ok) {
      setStep('done');
      setTxHash(result.txHash ?? null);
    } else {
      setStep('idle');
      if (!result.rejected) setError(result.error);
    }
  }

  if (step === 'done') {
    const url = txHash ? explorerTxUrl(txHash) : null;
    return (
      <div className="grid gap-1 text-sm">
        <span className="font-mono text-primary">✓ Accepted at {formatUsdc(livePrice)} USDC</span>
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

  const label =
    step === 'payment'
      ? 'Fetching payment terms…'
      : step === 'signing'
        ? 'Sign payment…'
        : step === 'submitting'
          ? 'Confirming…'
          : `Accept at ${formatUsdc(livePrice)} USDC`;

  return (
    <div className="grid gap-2">
      <Button disabled={disabled || busy} onClick={handleAccept} size="sm">
        {label}
      </Button>
      <p className="text-xs text-muted-foreground">
        Live clock price refreshes every 5s. Costs 0.001 USDC.
      </p>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}

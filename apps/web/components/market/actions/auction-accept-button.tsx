'use client';

import { CircleCheckIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { useAccount, useSignTypedData, useSwitchChain } from 'wagmi';

import { InFlightWriteNotice } from '@/components/market/in-flight-write-notice';
import { Button } from '@/components/ui/button';
import { getBrowserApiBaseUrl } from '@/lib/api/config';
import { explorerTxUrl } from '@/lib/explorer';
import { useInFlightWrite } from '@/lib/use-in-flight-write';
import { payX402Post, type X402Step } from '@/lib/x402-client';

import { ConnectPrompt } from './connect-prompt';
import type { TaskActionComponentProps } from './types';

function formatUsdc(value: string | null | undefined): string {
  const parsed = Number(value ?? 0) / 1_000_000;
  if (!Number.isFinite(parsed)) return '0.000';
  return parsed.toFixed(3);
}

export function AuctionAcceptButton({ disabled, onSuccess, task }: TaskActionComponentProps) {
  const { address, isConnected } = useAccount();
  const { signTypedDataAsync } = useSignTypedData();
  const { switchChainAsync } = useSwitchChain();
  const [step, setStep] = useState<X402Step | 'done' | 'idle'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const inFlight = useInFlightWrite('Auction acceptance submitted, confirming');

  // Refresh the clock price every 5s by re-fetching the task - dutch/reverse_dutch
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

  // Checked before every other branch, including the disconnected and expired ones: the write
  // is already out there, and an auction deadline passing under it must not replace this
  // state with "auction ended".
  if (inFlight.state) {
    return (
      <InFlightWriteNotice
        failure={inFlight.failure}
        idempotencyKey={inFlight.state.idempotencyKey}
        stalled={inFlight.stalled}
        subject="auction acceptance"
        title="Auction acceptance submitted, confirming"
      />
    );
  }

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
      setStep,
      inFlight.idempotencyKey
    );
    if (result.ok) {
      setStep('done');
      setTxHash(result.txHash ?? null);
      onSuccess?.();
      const url = result.txHash ? explorerTxUrl(result.txHash) : null;
      toast.success(
        'Auction accepted',
        url
          ? { action: { label: 'View on explorer', onClick: () => window.open(url, '_blank') } }
          : undefined
      );
    } else {
      setStep('idle');
      // Neither success nor failure, so it must not reach the error path below: that path
      // leaves the button live, and pressing it again is a second payment.
      if (inFlight.capture(result)) return;
      if (!result.rejected) {
        setError(result.error);
        toast.error(result.error);
      }
    }
  }

  if (step === 'done') {
    const url = txHash ? explorerTxUrl(txHash) : null;
    return (
      <div className="grid gap-1 text-sm">
        <span className="flex items-center gap-1.5 font-mono text-primary">
          <CircleCheckIcon aria-hidden="true" className="size-4" />
          Accepted at {formatUsdc(livePrice)} USDC
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

  const label =
    step === 'payment'
      ? 'Fetching payment terms...'
      : step === 'signing'
        ? 'Sign payment...'
        : step === 'submitting'
          ? 'Confirming...'
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

'use client';

import { CircleCheckIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { useAccount, useSignTypedData, useSwitchChain } from 'wagmi';

import { InFlightWriteNotice } from '@/components/market/in-flight-write-notice';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { getBrowserApiBaseUrl } from '@/lib/api/config';
import { explorerTxUrl } from '@/lib/explorer';
import { useInFlightWrite } from '@/lib/use-in-flight-write';
import { payX402Post, type X402Step } from '@/lib/x402-client';

import { ConnectPrompt } from './connect-prompt';
import type { TaskActionComponentProps } from './types';

function formatUsdc(base: string | null | undefined): string {
  return (Number(base ?? 0) / 1_000_000).toFixed(3);
}

export function BidForm({ disabled, onSuccess, task }: TaskActionComponentProps) {
  const { address, isConnected } = useAccount();
  const { signTypedDataAsync } = useSignTypedData();
  const { switchChainAsync } = useSwitchChain();
  const [priceUsdc, setPriceUsdc] = useState<string>('');
  const [step, setStep] = useState<X402Step | 'done' | 'idle'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [txHash, setTxHash] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const inFlight = useInFlightWrite('Bid submitted, confirming');

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  // Checked before every other branch, including the disconnected and expired ones: the write
  // is already out there, and the bid deadline passing under it must not replace this state.
  if (inFlight.state) {
    return (
      <InFlightWriteNotice
        idempotencyKey={inFlight.state.idempotencyKey}
        stalled={inFlight.stalled}
        subject="bid"
        title="Bid submitted, confirming"
      />
    );
  }

  if (!isConnected || !address) {
    return <ConnectPrompt label="Connect a worker wallet to place a bid." />;
  }

  const bidDeadline = (task as { bidDeadline?: string | null }).bidDeadline;
  const remainingMs = bidDeadline ? new Date(bidDeadline).getTime() - now : null;
  const expired = remainingMs !== null && remainingMs <= 0;
  const countdown =
    remainingMs !== null && remainingMs > 0
      ? `${Math.floor(remainingMs / 60000)}m ${Math.floor((remainingMs % 60000) / 1000)}s`
      : null;

  if (expired) {
    return <p className="text-sm text-muted-foreground">Bid deadline has passed.</p>;
  }

  const busy = step !== 'idle' && step !== 'done';

  async function handleBid(event?: React.FormEvent) {
    event?.preventDefault();
    setError(null);
    setFieldErrors({});

    const priceNum = Number(priceUsdc);
    if (!Number.isFinite(priceNum) || priceNum <= 0) {
      setFieldErrors({ price: 'Price must be a positive USDC amount' });
      return;
    }

    const priceBaseUnits = Math.floor(priceNum * 1_000_000).toString();

    const result = await payX402Post<{ txHash?: string; bidId?: string }>(
      `/api/tasks/${task.id}/bids`,
      { taskId: task.id, price: priceBaseUnits },
      { address: address!, apiUrl: getBrowserApiBaseUrl(), signTypedDataAsync, switchChainAsync },
      setStep,
      inFlight.idempotencyKey
    );
    if (result.ok) {
      setStep('done');
      setTxHash(result.txHash ?? null);
      onSuccess?.();
      const successUrl = result.txHash ? explorerTxUrl(result.txHash) : null;
      toast.success(
        'Bid placed',
        successUrl
          ? {
              action: {
                label: 'View on explorer',
                onClick: () => window.open(successUrl, '_blank'),
              },
            }
          : undefined
      );
    } else {
      setStep('idle');
      // Neither success nor failure, so it must not reach the error path below: that path
      // leaves the submit button live, and pressing it again is a second payment.
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
          Bid placed
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
      ? 'Fetching payment...'
      : step === 'signing'
        ? 'Sign payment...'
        : step === 'submitting'
          ? 'Confirming...'
          : 'Place bid';

  const currentLowest = (task as { currentLowestBid?: string | null }).currentLowestBid;

  return (
    <form className="grid gap-3" onSubmit={handleBid}>
      <div className="grid gap-1">
        <Label htmlFor="bid-price">Your price (USDC)</Label>
        <Input
          aria-describedby={fieldErrors.price ? 'bid-price-error' : undefined}
          aria-invalid={Boolean(fieldErrors.price)}
          id="bid-price"
          inputMode="decimal"
          onChange={(e) => setPriceUsdc(e.currentTarget.value)}
          placeholder="0.001"
          type="text"
          value={priceUsdc}
        />
        {fieldErrors.price ? (
          <p className="text-xs text-destructive" id="bid-price-error">
            {fieldErrors.price}
          </p>
        ) : null}
        {currentLowest ? (
          <p className="text-xs text-muted-foreground">
            Current lowest bid: {formatUsdc(currentLowest)} USDC
          </p>
        ) : null}
        {countdown ? (
          <p className="text-xs text-muted-foreground">Deadline: {countdown} remaining</p>
        ) : null}
      </div>
      <Button disabled={disabled || busy} size="sm" type="submit">
        {label}
      </Button>
      <p className="text-xs text-muted-foreground">Costs 0.001 USDC.</p>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </form>
  );
}

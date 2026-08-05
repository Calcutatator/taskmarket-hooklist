'use client';

import { CircleCheckIcon } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { useAccount, useSignTypedData, useSwitchChain } from 'wagmi';

import { InFlightWriteNotice } from '@/components/market/in-flight-write-notice';
import { Button } from '@/components/ui/button';
import { getBrowserApiBaseUrl } from '@/lib/api/config';
import { explorerTxUrl } from '@/lib/explorer';
import { useInFlightWrite } from '@/lib/use-in-flight-write';
import { payX402Post, type X402Step } from '@/lib/x402-client';

import { ConfirmDialog } from './confirm-dialog';
import { ConnectPrompt } from './connect-prompt';
import type { TaskActionComponentProps } from './types';

export function RefundExpiredButton({ disabled, onSuccess, task }: TaskActionComponentProps) {
  const { address, isConnected } = useAccount();
  const { signTypedDataAsync } = useSignTypedData();
  const { switchChainAsync } = useSwitchChain();
  const [step, setStep] = useState<X402Step | 'done' | 'idle'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const inFlight = useInFlightWrite('Escrow recovery submitted, confirming');

  // Checked before every other branch, including the disconnected one: the write is already
  // out there, so this state must survive anything that would otherwise swap the surface.
  if (inFlight.state) {
    return (
      <InFlightWriteNotice
        failure={inFlight.failure}
        idempotencyKey={inFlight.state.idempotencyKey}
        stalled={inFlight.stalled}
        subject="escrow recovery"
        title="Escrow recovery submitted, confirming"
      />
    );
  }

  if (!isConnected || !address) {
    return <ConnectPrompt label="Connect the requester wallet to recover escrowed funds." />;
  }

  const busy = step !== 'idle' && step !== 'done';

  async function handleRefund() {
    setError(null);
    const outcome = await inFlight.submit((idempotencyKey) =>
      payX402Post<{ txHash?: string }>(
        `/api/tasks/${task.id}/refund-expired`,
        { taskId: task.id },
        { address: address!, apiUrl: getBrowserApiBaseUrl(), signTypedDataAsync, switchChainAsync },
        setStep,
        idempotencyKey
      )
    );
    // Neither success nor failure, so it must not reach the error path below: that path
    // leaves the recover button live, and pressing it again is a second payment.
    if (outcome.handled) return;
    const result = outcome.result;
    if (result.ok) {
      setStep('done');
      setTxHash(result.txHash ?? null);
      onSuccess?.();
      const url = result.txHash ? explorerTxUrl(result.txHash) : null;
      toast.success(
        'Escrowed reward refunded',
        url
          ? { action: { label: 'View on explorer', onClick: () => window.open(url, '_blank') } }
          : undefined
      );
    } else {
      setStep('idle');
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
          Refunded
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
        confirmCta="Recover escrow"
        description="This task has expired with no submissions. Recover the escrowed reward to your wallet. This cannot be undone."
        disabled={disabled || busy}
        loadingCta={
          step === 'payment'
            ? 'Fetching payment...'
            : step === 'signing'
              ? 'Sign payment...'
              : step === 'submitting'
                ? 'Recovering...'
                : 'Recovering...'
        }
        onConfirm={handleRefund}
        title="Recover escrowed reward?"
      >
        <Button
          className="w-fit justify-self-start px-5"
          disabled={disabled || busy}
          size="sm"
          variant="destructive"
        >
          Recover escrow
        </Button>
      </ConfirmDialog>
      <p className="text-xs text-muted-foreground">
        Costs 0.001 USDC. Refunds the full escrowed reward.
      </p>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}

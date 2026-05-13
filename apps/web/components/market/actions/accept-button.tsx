'use client';

import { useState } from 'react';
import { useAccount, useSignTypedData, useSwitchChain } from 'wagmi';

import { Button } from '@/components/ui/button';
import { getBrowserApiBaseUrl } from '@/lib/api/config';
import { explorerTxUrl } from '@/lib/explorer';
import { compactAddress, formatUsdcUnits } from '@/lib/format';
import { payX402Post, type X402Step } from '@/lib/x402-client';

import { ConnectPrompt } from './connect-prompt';
import type { TaskActionComponentProps } from './types';

function workerFromCommand(command: string) {
  const worker = command.match(/(?:^|\s)--worker\s+(0x[a-fA-F0-9]{40})(?:\s|$)/)?.[1];
  return worker ?? null;
}

export function getAcceptWorkerAddress(
  action: TaskActionComponentProps['action'],
  task: TaskActionComponentProps['task']
) {
  return task.worker ?? task.claimedBy ?? workerFromCommand(action.command);
}

function sameAddress(left?: string | null, right?: string | null) {
  return Boolean(left && right && left.toLowerCase() === right.toLowerCase());
}

export function AcceptButton({ action, disabled, task }: TaskActionComponentProps) {
  const { address, isConnected } = useAccount();
  const { signTypedDataAsync } = useSignTypedData();
  const { switchChainAsync } = useSwitchChain();
  const [step, setStep] = useState<X402Step | 'done' | 'idle'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);

  if (!isConnected || !address) {
    return <ConnectPrompt label="Connect the requester wallet to release payout." />;
  }

  const worker = getAcceptWorkerAddress(action, task);
  const busy = step !== 'idle' && step !== 'done';
  const wrongRequester = !sameAddress(address, task.requester);
  const blocked = disabled || wrongRequester || busy;
  const workerLabel = worker ? compactAddress(worker) : 'selected worker';

  async function handleAccept() {
    if (!worker) {
      setError('No worker on this task');
      return;
    }
    const confirmed = window.confirm(
      `Release ${formatUsdcUnits(task.reward)} to ${workerLabel}? This accepts the deliverable and cannot be undone.`
    );
    if (!confirmed) {
      return;
    }
    setError(null);
    const result = await payX402Post<{ txHash?: string }>(
      `/api/tasks/${task.id}/accept`,
      { taskId: task.id, worker },
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
        <span className="font-mono text-primary">Payout released</span>
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
          ? 'Releasing payout...'
          : `Release payout`;

  return (
    <div className="grid gap-2">
      <Button disabled={blocked} onClick={handleAccept} size="sm">
        {label}
      </Button>
      <p className="text-xs leading-5 text-muted-foreground">
        Accepts the deliverable and releases {formatUsdcUnits(task.reward)} to {workerLabel}. Costs
        0.001 USDC.
      </p>
      {wrongRequester ? (
        <p className="text-xs text-destructive">Connect the requester wallet to release payout.</p>
      ) : null}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}

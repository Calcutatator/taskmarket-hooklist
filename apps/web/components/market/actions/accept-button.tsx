'use client';

import { useState } from 'react';
import { useAccount, useSignTypedData, useSwitchChain } from 'wagmi';

import { Button } from '@/components/ui/button';
import { getBrowserApiBaseUrl } from '@/lib/api/config';
import { explorerTxUrl } from '@/lib/explorer';
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

export function AcceptButton({ action, disabled, task }: TaskActionComponentProps) {
  const { address, isConnected } = useAccount();
  const { signTypedDataAsync } = useSignTypedData();
  const { switchChainAsync } = useSwitchChain();
  const [step, setStep] = useState<X402Step | 'done' | 'idle'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);

  if (!isConnected || !address) {
    return <ConnectPrompt label="Connect the requester wallet to accept this submission." />;
  }

  const worker = getAcceptWorkerAddress(action, task);
  const busy = step !== 'idle' && step !== 'done';

  async function handleAccept() {
    if (!worker) {
      setError('No worker on this task');
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
        <span className="font-mono text-primary">✓ Accepted</span>
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
          : 'Accept submission';

  return (
    <div className="grid gap-2">
      <Button disabled={disabled || busy} onClick={handleAccept} size="sm">
        {label}
      </Button>
      <p className="text-xs text-muted-foreground">Costs 0.001 USDC. Releases reward to worker.</p>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}

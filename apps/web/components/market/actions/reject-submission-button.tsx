'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { useAccount, useSignTypedData, useSwitchChain } from 'wagmi';

import { Button } from '@/components/ui/button';
import { getBrowserApiBaseUrl } from '@/lib/api/config';
import { payX402Post, type X402Step } from '@/lib/x402-client';

import { ConnectPrompt } from './connect-prompt';
import type { TaskActionComponentProps } from './types';

function parseWorkerFromCommand(command: string): string | null {
  const match = command.match(/--worker\s+(0x[0-9a-fA-F]+)/);
  return match?.[1] ?? null;
}

export function RejectSubmissionButton({
  disabled,
  onSuccess,
  task,
  action,
}: TaskActionComponentProps & { action?: { command: string } }) {
  const { address, isConnected } = useAccount();
  const { signTypedDataAsync } = useSignTypedData();
  const { switchChainAsync } = useSwitchChain();
  const [step, setStep] = useState<X402Step | 'done' | 'idle'>('idle');
  const [error, setError] = useState<string | null>(null);

  if (!isConnected || !address) {
    return <ConnectPrompt label="Connect the requester wallet to reject this submission." />;
  }

  const worker = action?.command ? parseWorkerFromCommand(action.command) : null;
  if (!worker) {
    return (
      <p className="text-xs text-muted-foreground">
        Use CLI: <code>taskmarket task reject-submission {task.id} --worker &lt;address&gt;</code>
      </p>
    );
  }

  const busy = step !== 'idle' && step !== 'done';

  async function handleReject() {
    setError(null);
    const result = await payX402Post<{ txHash?: string }>(
      `/api/tasks/${task.id}/reject-submission`,
      { taskId: task.id, worker },
      { address: address!, apiUrl: getBrowserApiBaseUrl(), signTypedDataAsync, switchChainAsync },
      setStep
    );
    if (result.ok) {
      setStep('done');
      onSuccess?.();
      toast.success('Submission rejected');
    } else {
      setStep('idle');
      if (!result.rejected) {
        setError(result.error);
        toast.error(result.error);
      }
    }
  }

  if (step === 'done') {
    return <p className="text-xs text-muted-foreground">Submission rejected.</p>;
  }

  return (
    <div className="grid gap-2">
      <Button
        className="w-fit justify-self-start px-5"
        disabled={disabled || busy}
        onClick={handleReject}
        size="sm"
        variant="destructive"
      >
        {busy ? 'Rejecting...' : 'Reject submission'}
      </Button>
      <p className="text-xs text-muted-foreground">
        Costs 0.01 USDC relay fee. Rejected workers cannot resubmit. Once all submissions are
        rejected, the task can be cancelled.
      </p>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}

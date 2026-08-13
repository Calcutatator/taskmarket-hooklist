'use client';

import { CircleCheckIcon } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { useAccount, useSignTypedData, useSwitchChain } from 'wagmi';

import { InFlightWriteNotice } from '@/components/market/in-flight-write-notice';
import { Button } from '@/components/ui/button';
import { getBrowserApiBaseUrl } from '@/lib/api/config';
import { explorerTxUrl } from '@/lib/explorer';
import { actorDisplayName, formatUsdcUnits } from '@/lib/format';
import { workerAgentIdFor } from '@/lib/market/worker-identity';
import { useInvalidateActionQueue } from '@/lib/use-action-queue';
import { useInFlightWrite } from '@/lib/use-in-flight-write';
import { payX402Post, type X402Step } from '@/lib/x402-client';

import { ConfirmDialog } from './confirm-dialog';
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
  return task.claimedBy ?? workerFromCommand(action.command);
}

function sameAddress(left?: string | null, right?: string | null) {
  return Boolean(left && right && left.toLowerCase() === right.toLowerCase());
}

export function AcceptButton({
  action,
  disabled,
  onSuccess,
  presentation = 'default',
  task,
}: TaskActionComponentProps & { presentation?: 'award' | 'default' }) {
  const { address, isConnected } = useAccount();
  const { signTypedDataAsync } = useSignTypedData();
  const { switchChainAsync } = useSwitchChain();
  const invalidateActionQueue = useInvalidateActionQueue();
  const [step, setStep] = useState<X402Step | 'done' | 'idle'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const inFlight = useInFlightWrite('Payout release submitted, confirming');

  // Checked before every other branch, including the disconnected one: the write is already
  // out there, so the state has to survive a wallet disconnect or a status change that would
  // otherwise swap this surface for a control or a prompt.
  if (inFlight.state) {
    return (
      <InFlightWriteNotice
        failure={inFlight.failure}
        idempotencyKey={inFlight.state.idempotencyKey}
        stalled={inFlight.stalled}
        subject="payout release"
        title="Payout release submitted, confirming"
      />
    );
  }

  if (!isConnected || !address) {
    return <ConnectPrompt label="Connect the requester wallet to release payout." />;
  }

  const worker = getAcceptWorkerAddress(action, task);
  const busy = step !== 'idle' && step !== 'done';
  const wrongRequester = !sameAddress(address, task.requester);
  const blocked = disabled || wrongRequester || busy;
  const workerLabel = worker
    ? actorDisplayName({ address: worker, agentId: workerAgentIdFor(task, worker) })
    : 'selected worker';
  const awardPresentation = presentation === 'award';
  const rewardLabel = formatUsdcUnits(task.reward);

  async function handleAccept() {
    if (!worker) {
      setError('No worker on this task');
      return;
    }
    setError(null);
    const outcome = await inFlight.submit((idempotencyKey) =>
      payX402Post<{ txHash?: string }>(
        `/api/tasks/${task.id}/accept`,
        { taskId: task.id, worker },
        { address: address!, apiUrl: getBrowserApiBaseUrl(), signTypedDataAsync, switchChainAsync },
        setStep,
        idempotencyKey
      )
    );
    // In flight is neither success nor failure, so it must not reach the error path below:
    // that path leaves the button live, and pressing it again is a second payment.
    if (outcome.handled) return;
    const result = outcome.result;
    if (result.ok) {
      setStep('done');
      setTxHash(result.txHash ?? null);
      onSuccess?.();
      void invalidateActionQueue();
      const url = result.txHash ? explorerTxUrl(result.txHash) : null;
      toast.success(
        'Payout released',
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
          Payout released
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
        confirmCta={awardPresentation ? 'Award and release' : 'Release payout'}
        description={`${awardPresentation ? 'Award' : 'Release'} ${rewardLabel} to ${workerLabel}. This accepts the deliverable and cannot be undone.`}
        disabled={blocked}
        loadingCta="Releasing..."
        onConfirm={handleAccept}
        title={awardPresentation ? `Award ${rewardLabel}?` : 'Release payout?'}
      >
        <Button disabled={blocked} size="sm">
          {awardPresentation ? `Award ${rewardLabel}` : 'Release payout'}
        </Button>
      </ConfirmDialog>
      {!awardPresentation ? (
        <p className="text-xs leading-5 text-muted-foreground">
          Accepts the deliverable and releases escrow to the worker. Costs 0.001 USDC.
        </p>
      ) : null}
      {wrongRequester ? (
        <p className="text-xs text-destructive">Connect the requester wallet to release payout.</p>
      ) : null}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}

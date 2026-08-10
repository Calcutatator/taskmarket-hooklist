'use client';

import type { PendingAction } from '@taskmarket/shared';
import { useState } from 'react';
import { toast } from 'sonner';
import { useAccount, useSignTypedData, useSwitchChain } from 'wagmi';

import { FundingGuard, usePaidActionFundingPrompt } from '@/components/market/fund-wallet-button';
import { InFlightWriteNotice } from '@/components/market/in-flight-write-notice';
import { Button } from '@/components/ui/button';
import { getBrowserApiBaseUrl } from '@/lib/api/config';
import { formatUsdcUnits } from '@/lib/format';
import { useInFlightWrite } from '@/lib/use-in-flight-write';
import { payX402Post, type X402Step } from '@/lib/x402-client';

import { ConfirmDialog } from './confirm-dialog';
import { ConnectPrompt } from './connect-prompt';
import type { TaskActionComponentProps } from './types';

function parseWorkerFromCommand(command: string): string | null {
  const match = command.match(/--worker\s+(0x[0-9a-fA-F]+)/);
  return match?.[1] ?? null;
}

function sameAddress(left?: string | null, right?: string | null) {
  return Boolean(left && right && left.toLowerCase() === right.toLowerCase());
}

export type WorkerRejectionTarget = {
  activeSubmissionCount: number;
  workerAddress: string;
};

export type RejectSubmissionButtonProps = Omit<TaskActionComponentProps, 'action'> & {
  action?: Pick<PendingAction, 'command'>;
  onRejectSuccess?: (workerKey: string) => void;
  target?: WorkerRejectionTarget;
};

export function RejectSubmissionButton({
  disabled,
  onRejectSuccess,
  onSuccess,
  task,
  action,
  target,
}: RejectSubmissionButtonProps) {
  const { address, isConnected } = useAccount();
  const { signTypedDataAsync } = useSignTypedData();
  const { switchChainAsync } = useSwitchChain();
  const [step, setStep] = useState<X402Step | 'done' | 'idle'>('idle');
  const [error, setError] = useState<string | null>(null);
  const requesterConnected = sameAddress(address, task.requester);
  const { actionFundingPrompt, recheckActionFunding } = usePaidActionFundingPrompt({
    address,
    enabled: Boolean(target && requesterConnected),
  });
  const inFlight = useInFlightWrite('Rejection submitted, confirming');

  // Checked before every other branch, including the disconnected one and the missing-worker
  // one: the write is already out there, so this state must survive anything that would
  // otherwise swap the surface.
  if (inFlight.state) {
    return (
      <InFlightWriteNotice
        failure={inFlight.failure}
        idempotencyKey={inFlight.state.idempotencyKey}
        stalled={inFlight.stalled}
        subject="rejection"
        title="Rejection submitted, confirming"
      />
    );
  }

  if (!isConnected || !address) {
    return <ConnectPrompt label="Connect the requester wallet to reject submissions." />;
  }

  const worker =
    target?.workerAddress ?? (action?.command ? parseWorkerFromCommand(action.command) : null);
  if (!worker) {
    return (
      <p className="text-xs text-muted-foreground">
        Use CLI: <code>taskmarket task reject-submission {task.id} --worker &lt;address&gt;</code>
      </p>
    );
  }
  const workerAddress = worker;

  const busy = step !== 'idle' && step !== 'done';
  const wrongRequester = Boolean(target && !requesterConnected);
  const blocked = disabled || busy || wrongRequester || Boolean(actionFundingPrompt);
  const submissionLabel =
    target?.activeSubmissionCount === 1
      ? '1 submission'
      : `${target?.activeSubmissionCount ?? 0} submissions`;

  async function handleReject() {
    if (target && !requesterConnected) {
      return;
    }

    setError(null);
    const outcome = await inFlight.submit((idempotencyKey) =>
      payX402Post<{ txHash?: string }>(
        `/api/tasks/${task.id}/reject-submission`,
        { taskId: task.id, worker: workerAddress },
        { address: address!, apiUrl: getBrowserApiBaseUrl(), signTypedDataAsync, switchChainAsync },
        setStep,
        idempotencyKey
      )
    );
    // Neither success nor failure, so it must not reach the error path below: that path
    // leaves the reject button live, and pressing it again is a second payment.
    if (outcome.handled) return;
    const result = outcome.result;
    if (result.ok) {
      setStep('done');
      onRejectSuccess?.(workerAddress.toLowerCase());
      onSuccess?.();
      toast.success(target ? 'Submitter rejected' : 'Submission rejected');
    } else {
      setStep('idle');
      if (!result.rejected) {
        setError(result.error);
        toast.error(result.error);
      }
    }
  }

  if (step === 'done') {
    return (
      <p className="text-xs text-muted-foreground">
        {target ? 'Submitter rejected.' : 'Submission rejected.'}
      </p>
    );
  }

  const trigger = (
    <Button
      className="w-fit justify-self-start px-5"
      disabled={blocked}
      onClick={target ? undefined : handleReject}
      size="sm"
      variant="destructive"
    >
      {busy
        ? 'Rejecting...'
        : target
          ? `Reject submitter and all ${submissionLabel}`
          : 'Reject submission'}
    </Button>
  );

  return (
    <div className="grid gap-2">
      {target ? (
        <ConfirmDialog
          confirmCta="Reject all submissions"
          description={
            <span className="grid gap-2">
              <span>
                All {submissionLabel} from{' '}
                <span className="break-all font-mono">{workerAddress}</span> will be rejected. This
                worker cannot submit again to this task.
              </span>
              <span>The relay fee is 0.001 USDC.</span>
            </span>
          }
          disabled={blocked}
          loadingCta="Rejecting..."
          onConfirm={handleReject}
          title="Reject this submitter?"
        >
          {trigger}
        </ConfirmDialog>
      ) : (
        trigger
      )}
      {target && actionFundingPrompt ? (
        <FundingGuard
          address={address}
          defaultAmount={actionFundingPrompt.defaultAmount}
          message={`Wallet has ${actionFundingPrompt.balanceUsdc} USDC. Add ${formatUsdcUnits(
            actionFundingPrompt.shortfallBaseUnits
          )} before rejecting this submitter.`}
          onStatus={(status) => {
            if (status === 'confirmed') {
              recheckActionFunding();
            }
          }}
        />
      ) : null}
      <p className="text-xs text-muted-foreground">
        Costs 0.001 USDC relay fee. Rejected workers cannot resubmit. Once all submissions are
        rejected, the task can be cancelled.
      </p>
      {wrongRequester ? (
        <p className="text-xs text-destructive">
          Connect the requester wallet to reject submissions.
        </p>
      ) : null}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}

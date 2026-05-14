'use client';

import type { PendingAction, TaskDetailResponse, TaskResponse } from '@taskmarket/shared';
import { useAccount, useConnect, useDisconnect } from 'wagmi';

import { AcceptButton } from '@/components/market/actions/accept-button';
import { Button } from '@/components/ui/button';
import { compactAddress } from '@/lib/format';

function sameAddress(left?: string | null, right?: string | null) {
  return Boolean(left && right && left.toLowerCase() === right.toLowerCase());
}

export function SubmissionPayoutAction({
  action,
  task,
}: {
  action: PendingAction;
  task: TaskDetailResponse | TaskResponse;
}) {
  const { address, isConnected } = useAccount();
  const { connect, connectors } = useConnect();
  const { disconnect } = useDisconnect();
  const firstConnector = connectors[0];

  if (sameAddress(address, task.requester)) {
    return (
      <div className="grid min-w-0 gap-2 rounded-xl border border-primary/28 bg-primary/10 p-3">
        <p className="text-sm font-semibold tracking-tight text-foreground">Release payout</p>
        <AcceptButton action={action} disabled={false} task={task} />
      </div>
    );
  }

  const requiredRequester = compactAddress(task.requester);
  const connectedWallet = address ? compactAddress(address) : null;

  return (
    <div
      aria-label="Payout release requirement"
      className="grid min-w-0 gap-3 rounded-xl border border-border/72 bg-surface/48 p-3 shadow-[var(--shadow-soft)]"
      role="group"
    >
      <div className="grid gap-1">
        <p className="text-sm font-semibold tracking-tight text-foreground">
          {isConnected ? 'Requester wallet required' : 'Connect requester wallet to release payout'}
        </p>
        <p className="text-sm leading-5 text-muted-foreground">
          Only the requester wallet can approve this submission and release escrow.
        </p>
      </div>
      <div className="grid gap-1 rounded-lg border border-border/60 bg-background/48 p-3 font-mono text-xs text-muted-foreground">
        <span>
          Required requester: <span className="text-foreground">{requiredRequester}</span>
        </span>
        {connectedWallet ? (
          <span>
            Connected wallet: <span className="text-foreground">{connectedWallet}</span>
          </span>
        ) : null}
      </div>
      {isConnected ? (
        <Button onClick={() => disconnect()} type="button" variant="outline">
          Switch wallet
        </Button>
      ) : (
        <Button
          disabled={!firstConnector}
          onClick={() => firstConnector && connect({ connector: firstConnector })}
          type="button"
          variant="outline"
        >
          Connect wallet
        </Button>
      )}
    </div>
  );
}

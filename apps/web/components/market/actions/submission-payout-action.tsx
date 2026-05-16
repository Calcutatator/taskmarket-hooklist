'use client';

import type { PendingAction, TaskDetailResponse, TaskResponse } from '@taskmarket/shared';
import { usePrivy } from '@privy-io/react-auth';
import { useAccount } from 'wagmi';

import { AcceptButton } from '@/components/market/actions/accept-button';
import {
  FundingGuard,
  PAID_ACTION_COST_BASE_UNITS,
  usePaidActionFundingPrompt,
} from '@/components/market/fund-wallet-button';
import { Button } from '@/components/ui/button';
import { compactAddress, formatUsdcUnits } from '@/lib/format';
import { isPrivyConfigured } from '@/lib/privy-config';

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
  const requesterConnected = sameAddress(address, task.requester);
  const { actionFundingPrompt, recheckActionFunding } = usePaidActionFundingPrompt({
    address,
    enabled: requesterConnected,
  });

  if (requesterConnected) {
    return (
      <div className="grid min-w-0 gap-2 rounded-xl border border-primary/28 bg-primary/10 p-3">
        <p className="text-sm font-semibold tracking-tight text-foreground">Release payout</p>
        {actionFundingPrompt ? (
          <FundingGuard
            address={address}
            defaultAmount={actionFundingPrompt.defaultAmount}
            message={`Wallet has ${actionFundingPrompt.balanceUsdc} USDC. Add ${formatUsdcUnits(
              actionFundingPrompt.shortfallBaseUnits
            )} before releasing payout.`}
            onStatus={(status) => {
              if (status === 'confirmed') {
                recheckActionFunding();
              }
            }}
          >
            <p className="text-xs leading-5 text-muted-foreground">
              Payout release requires {formatUsdcUnits(PAID_ACTION_COST_BASE_UNITS.toString())}.
            </p>
          </FundingGuard>
        ) : null}
        <AcceptButton action={action} disabled={Boolean(actionFundingPrompt)} task={task} />
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
        <PrivyWalletActionButton label="Switch wallet" />
      ) : (
        <PrivyWalletActionButton label="Connect wallet" />
      )}
    </div>
  );
}

function PrivyWalletActionButton({ label }: { label: string }) {
  if (!isPrivyConfigured()) {
    return (
      <Button disabled type="button" variant="outline">
        {label}
      </Button>
    );
  }

  return <PrivyWalletActionButtonInner label={label} />;
}

function PrivyWalletActionButtonInner({ label }: { label: string }) {
  const { connectOrCreateWallet, ready } = usePrivy();

  return (
    <Button
      disabled={!ready}
      onClick={() => connectOrCreateWallet()}
      type="button"
      variant="outline"
    >
      {label}
    </Button>
  );
}

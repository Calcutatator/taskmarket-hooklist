'use client';

import type { PendingAction, TaskDetailResponse, TaskResponse } from '@taskmarket/shared';
import { usePrivy } from '@privy-io/react-auth';
import { useState } from 'react';
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
  const [walletOptionsOpen, setWalletOptionsOpen] = useState(false);
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

  if (connectedWallet) {
    return (
      <div
        aria-label="Payout release requirement"
        className="min-w-0 rounded-lg border border-border/58 bg-background/30"
        role="group"
      >
        <button
          aria-expanded={walletOptionsOpen}
          className="block w-full cursor-pointer px-3 py-2 text-left"
          onClick={() => setWalletOptionsOpen((open) => !open)}
          type="button"
        >
          <span className="block text-xs font-semibold tracking-tight text-foreground">
            Release payout options
          </span>
          <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">
            Connected as <span className="font-mono text-foreground">{connectedWallet}</span>. Only
            requester{' '}
            <span className="font-mono text-foreground" title={task.requester}>
              {requiredRequester}
            </span>{' '}
            can release escrow.
          </span>
        </button>
        {walletOptionsOpen ? (
          <div className="border-t border-border/52 p-3">
            <PrivyWalletActionButton label="Switch wallet" />
          </div>
        ) : null}
      </div>
    );
  }

  // Non-requester viewers get a single quiet row, not a panel: on a review grid
  // this state repeats on every card and must not compete with the deliverable.
  return (
    <div
      aria-label="Payout release requirement"
      className="flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-lg border border-border/58 bg-background/30 px-3 py-2"
      role="group"
    >
      <p className="min-w-0 text-xs leading-5 text-muted-foreground">
        Only requester{' '}
        <span className="font-mono text-foreground" title={task.requester}>
          {requiredRequester}
        </span>{' '}
        can release escrow.
      </p>
      <PrivyWalletActionButton label={isConnected ? 'Switch wallet' : 'Connect wallet'} />
    </div>
  );
}

export function PrivyWalletActionButton({ label }: { label: string }) {
  if (!isPrivyConfigured()) {
    return (
      <Button disabled size="sm" type="button" variant="outline">
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
      size="sm"
      type="button"
      variant="outline"
    >
      {label}
    </Button>
  );
}

'use client';

import type { PendingAction, TaskDetailResponse, TaskResponse } from '@taskmarket/shared';
import { Clock3Icon, LoaderCircleIcon } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import { useAccount } from 'wagmi';

import { AcceptButton } from '@/components/market/actions/accept-button';
import {
  FundingGuard,
  PAID_ACTION_COST_BASE_UNITS,
  usePaidActionFundingPrompt,
} from '@/components/market/fund-wallet-button';
import { Button } from '@/components/ui/button';
import { usePrivyAccountState } from '@/components/privy-account-control';
import { compactAddress, formatUsdcUnits } from '@/lib/format';
import { emitActionInboxEvent } from '@/lib/market/action-inbox-events';
import { isPrivyConfigured } from '@/lib/privy-config';

export const SETTLEMENT_CONFIRMATION_INTERVAL_MS = 2_000;
export const SETTLEMENT_CONFIRMATION_MAX_REFRESHES = 6;

type SettlementState = {
  owner: string | null;
  phase: 'confirming' | 'delayed' | 'idle';
};

const IDLE_SETTLEMENT: SettlementState = { owner: null, phase: 'idle' };
const settlementByTask = new Map<string, SettlementState>();
const settlementListeners = new Set<() => void>();

function setTaskSettlement(taskId: string, state: SettlementState) {
  settlementByTask.set(taskId, state);
  for (const listener of settlementListeners) listener();
}

function subscribeToSettlements(listener: () => void) {
  settlementListeners.add(listener);
  return () => settlementListeners.delete(listener);
}

function useTaskSettlement(taskId: string) {
  return useSyncExternalStore(
    subscribeToSettlements,
    () => settlementByTask.get(taskId) ?? IDLE_SETTLEMENT,
    () => IDLE_SETTLEMENT
  );
}

export function SettlementConfirmation({
  delayed = false,
  onRetry,
}: {
  delayed?: boolean;
  onRetry?: () => void;
}) {
  if (delayed) {
    return (
      <div className="grid gap-2" role="alert">
        <span className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
          <Clock3Icon aria-hidden="true" className="size-4 text-warning" />
          Settlement confirmation is taking longer than expected
        </span>
        <p className="text-xs leading-5 text-muted-foreground">
          The payout was submitted. Check again before retrying the payment itself.
        </p>
        {onRetry ? (
          <Button className="w-fit" onClick={onRetry} size="sm" type="button" variant="outline">
            Check again
          </Button>
        ) : null}
      </div>
    );
  }

  return (
    <div aria-label="Confirming settlement" className="grid gap-2" role="status">
      <span className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
        <LoaderCircleIcon
          aria-hidden="true"
          className="size-4 animate-spin text-primary motion-reduce:animate-none"
        />
        Confirming settlement
      </span>
      <p className="text-xs leading-5 text-muted-foreground">
        Payout submitted. Rating will appear here as soon as the settlement is indexed.
      </p>
    </div>
  );
}

function sameAddress(left?: string | null, right?: string | null) {
  return Boolean(left && right && left.toLowerCase() === right.toLowerCase());
}

export function SubmissionPayoutAction({
  action,
  onSuccess,
  task,
}: {
  action: PendingAction;
  onSuccess?: () => void;
  task: TaskDetailResponse | TaskResponse;
}) {
  const { address, isConnected } = useAccount();
  const router = useRouter();
  const settlementOwner = useId();
  const [walletOptionsOpen, setWalletOptionsOpen] = useState(false);
  const settlementState = useTaskSettlement(task.id);
  const settlementRefreshes = useRef(0);
  const requesterConnected = sameAddress(address, task.requester);
  const { actionFundingPrompt, recheckActionFunding } = usePaidActionFundingPrompt({
    address,
    enabled: requesterConnected,
  });

  useEffect(() => {
    if (settlementState.phase !== 'confirming' || settlementState.owner !== settlementOwner) return;

    let timeout: number;
    function refreshSettlement() {
      settlementRefreshes.current += 1;
      router.refresh();
      if (settlementRefreshes.current >= SETTLEMENT_CONFIRMATION_MAX_REFRESHES) {
        setTaskSettlement(task.id, { owner: settlementOwner, phase: 'delayed' });
        return;
      }
      timeout = window.setTimeout(refreshSettlement, SETTLEMENT_CONFIRMATION_INTERVAL_MS);
    }
    timeout = window.setTimeout(refreshSettlement, SETTLEMENT_CONFIRMATION_INTERVAL_MS);

    return () => window.clearTimeout(timeout);
  }, [router, settlementOwner, settlementState, task.id]);

  function beginSettlementConfirmation() {
    settlementRefreshes.current = 0;
    setTaskSettlement(task.id, { owner: settlementOwner, phase: 'confirming' });
    router.refresh();
  }

  function handlePayoutSuccess() {
    emitActionInboxEvent({
      action: action.action,
      event: 'lifecycle_action_completed',
      taskId: task.id,
    });
    beginSettlementConfirmation();
    onSuccess?.();
  }

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
        {settlementState.phase === 'idle' ? (
          <>
            <AcceptButton
              action={action}
              disabled={Boolean(actionFundingPrompt)}
              onSuccess={handlePayoutSuccess}
              task={task}
            />
            <p className="text-xs leading-5 text-muted-foreground">
              Releases payout to this worker using their latest active submission.
            </p>
          </>
        ) : (
          <SettlementConfirmation
            delayed={settlementState.phase === 'delayed'}
            onRetry={beginSettlementConfirmation}
          />
        )}
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
  const { beginWalletAccess, connectOrCreateWallet, readyTimedOut, walletActionStatus } =
    usePrivyAccountState();
  const loading = walletActionStatus === 'initializing' || walletActionStatus === 'wallet-loading';
  const buttonLabel =
    walletActionStatus === 'initializing'
      ? readyTimedOut
        ? 'Retry sign in'
        : 'Loading sign in'
      : walletActionStatus === 'wallet-loading'
        ? readyTimedOut
          ? 'Retry wallet'
          : 'Loading wallet'
        : walletActionStatus === 'signed-out'
          ? 'Sign in'
          : walletActionStatus === 'walletless'
            ? 'Connect wallet'
            : label;

  return (
    <Button
      disabled={loading && !readyTimedOut}
      onClick={() => {
        if (loading && readyTimedOut) {
          window.location.reload();
        } else if (walletActionStatus === 'connected') {
          void connectOrCreateWallet();
        } else {
          beginWalletAccess();
        }
      }}
      size="sm"
      type="button"
      variant="outline"
    >
      {buttonLabel}
    </Button>
  );
}

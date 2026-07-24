'use client';

import {
  PAID_PENDING_ACTION_NAMES,
  type PendingAction,
  type TaskDetailResponse,
  type TaskResponse,
} from '@taskmarket/shared';
import { BotIcon, Terminal, UploadIcon, UserRoundIcon } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useAccount } from 'wagmi';

import { COMPONENT_BY_ACTION } from '@/components/market/actions';
import { CopyButton } from '@/components/market/copy-button';
import {
  FundingGuard,
  PAID_ACTION_COST_BASE_UNITS,
  usePaidActionFundingPrompt,
} from '@/components/market/fund-wallet-button';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { formatUsdcUnits } from '@/lib/format';
import { absoluteUrl } from '@/lib/seo';

type TaskActionPanelProps = {
  claimedBy?: string | null;
  emptyReason: string;
  hideWhenNoVisibleActions?: boolean;
  pendingActions: PendingAction[];
  requester: string;
  task: TaskDetailResponse | TaskResponse;
  title?: string;
  worker?: string | null;
};

const PAID_ACTIONS = new Set<PendingAction['action']>(PAID_PENDING_ACTION_NAMES);
const SKILL_URL = absoluteUrl('/skill.md');

// Evaluator and dispute controls are not built yet (their components only render
// "coming soon" copy), so we do not surface them. The components stay wired in
// COMPONENT_BY_ACTION to keep the dispatcher exhaustive; this set just hides the
// dead controls from users until the flows ship.
const UNRELEASED_ACTIONS = new Set([
  'appeal',
  'evaluate',
  'evaluator_timeout',
  'finalize_verdict',
  'resolve_dispute',
]);

function isReleasedAction(action: PendingAction) {
  return !UNRELEASED_ACTIONS.has(action.action);
}

function sameAddress(left?: string | null, right?: string | null) {
  return Boolean(left && right && left.toLowerCase() === right.toLowerCase());
}

function isPaidAction(action: PendingAction) {
  return action.requiresPayment ?? PAID_ACTIONS.has(action.action);
}

type ActionVisibilityParams = {
  action: PendingAction;
  address?: string;
  claimedBy?: string | null;
  requester: string;
  worker?: string | null;
};

export function canViewAction({
  action,
  address,
  claimedBy,
  requester,
  worker,
}: ActionVisibilityParams) {
  if (action.role === 'anyone') {
    return true;
  }

  if (action.eligibleAddress) {
    return sameAddress(address, action.eligibleAddress);
  }

  if (action.role === 'requester') {
    return sameAddress(address, requester);
  }

  if (sameAddress(address, requester)) {
    return false;
  }

  const assignedWorker = worker ?? claimedBy;
  if (assignedWorker) {
    return sameAddress(address, assignedWorker);
  }

  return true;
}

function canRunAction(params: ActionVisibilityParams) {
  return Boolean(params.address) && canViewAction(params);
}

export function TaskActionsPanel({
  claimedBy,
  emptyReason,
  hideWhenNoVisibleActions = false,
  pendingActions,
  requester,
  task,
  title = 'Next actions',
  worker,
}: TaskActionPanelProps) {
  const { address } = useAccount();
  const router = useRouter();
  const visibleActions = pendingActions.filter(
    (action) =>
      isReleasedAction(action) && canViewAction({ action, address, claimedBy, requester, worker })
  );
  const hasPaidAction = visibleActions.some(isPaidAction);
  const { actionFundingPrompt, recheckActionFunding } = usePaidActionFundingPrompt({
    address,
    enabled: hasPaidAction,
  });
  const emptyTitle =
    pendingActions.length > 0 ? 'No actions for this wallet' : 'No pending commands';
  const emptyDescription =
    pendingActions.length > 0
      ? 'Connect the requester or assigned worker wallet to manage this task.'
      : emptyReason;

  if (hideWhenNoVisibleActions && visibleActions.length === 0) {
    return null;
  }

  return (
    <section className="grid min-w-0 gap-4 border-t border-border/58 pt-5">
      <h2 className="font-display font-semibold leading-none tracking-tight text-foreground">
        {title}
      </h2>
      <div className="grid gap-3">
        {actionFundingPrompt ? (
          <FundingGuard
            address={address}
            defaultAmount={actionFundingPrompt.defaultAmount}
            message={`Wallet has ${actionFundingPrompt.balanceUsdc} USDC. Add ${formatUsdcUnits(
              actionFundingPrompt.shortfallBaseUnits
            )} before running paid task actions.`}
            onStatus={(status) => {
              if (status === 'confirmed') {
                recheckActionFunding();
              }
            }}
          >
            <p className="text-xs leading-5 text-muted-foreground">
              Paid task actions require {formatUsdcUnits(PAID_ACTION_COST_BASE_UNITS.toString())}.
            </p>
          </FundingGuard>
        ) : null}
        {visibleActions.length > 0 ? (
          visibleActions.map((action) => {
            const Component = COMPONENT_BY_ACTION[action.action];
            const canRun = canRunAction({ action, address, claimedBy, requester, worker });
            const blockedByFunding = Boolean(actionFundingPrompt && isPaidAction(action));

            if (action.action === 'submit') {
              return (
                <div
                  className="grid min-w-0 gap-3 sm:grid-cols-2"
                  key={`${action.role}-${action.action}-${action.command}`}
                >
                  <article
                    aria-label="For agents"
                    className="grid min-w-0 content-between gap-5 rounded-lg border border-border/58 bg-surface/40 p-4"
                  >
                    <div className="grid gap-3">
                      <span className="flex size-9 items-center justify-center rounded-full border border-border/58 bg-background/68 text-primary">
                        <BotIcon aria-hidden="true" className="size-4" />
                      </span>
                      <div className="grid gap-1">
                        <h3 className="font-display font-semibold tracking-tight text-foreground">
                          For agents
                        </h3>
                        <p className="text-sm leading-5 text-muted-foreground">
                          Give your agent the Taskmarket skill so it can complete and submit the
                          work.
                        </p>
                      </div>
                    </div>
                    <div className="grid min-w-0 gap-2">
                      <div className="flex min-w-0 items-center gap-2 rounded-lg border border-border/52 bg-background/68 p-2 pl-3">
                        <span className="min-w-0 flex-1 truncate font-mono text-xs text-foreground">
                          {SKILL_URL}
                        </span>
                        <CopyButton label="Copy skill.md link" text={SKILL_URL} />
                      </div>
                      <details className="min-w-0">
                        <summary className="cursor-pointer select-none font-mono text-xs uppercase text-muted-foreground hover:text-foreground">
                          Task command
                        </summary>
                        <div className="mt-2 grid min-w-0 gap-2 rounded-lg bg-background/76 p-2">
                          <div className="flex justify-end">
                            <CopyButton
                              label={`Copy ${action.action} command`}
                              text={action.command}
                            />
                          </div>
                          <pre className="max-w-full overflow-x-auto rounded-md bg-surface/60 p-2 font-mono text-xs leading-5 text-foreground">
                            <code className="block min-w-0">{action.command}</code>
                          </pre>
                        </div>
                      </details>
                    </div>
                  </article>

                  <article
                    aria-label="For humans"
                    className="grid min-w-0 content-between gap-5 rounded-lg border border-border/58 bg-surface/40 p-4"
                  >
                    <div className="grid gap-3">
                      <span className="flex size-9 items-center justify-center rounded-full border border-border/58 bg-background/68 text-primary">
                        <UserRoundIcon aria-hidden="true" className="size-4" />
                      </span>
                      <div className="grid gap-1">
                        <h3 className="font-display font-semibold tracking-tight text-foreground">
                          For humans
                        </h3>
                        <p className="text-sm leading-5 text-muted-foreground">
                          Upload finished files from this browser and submit them for review.
                        </p>
                      </div>
                    </div>
                    <Dialog>
                      <DialogTrigger asChild>
                        <Button className="w-full" type="button" variant="outline">
                          <UploadIcon aria-hidden="true" className="size-4" />
                          Upload files
                        </Button>
                      </DialogTrigger>
                      <DialogContent className="max-h-[90vh] overflow-y-auto">
                        <DialogHeader>
                          <DialogTitle>Submit work</DialogTitle>
                          <DialogDescription>
                            Add your deliverables, choose their roles, and submit them for requester
                            review.
                          </DialogDescription>
                        </DialogHeader>
                        <Component
                          action={action}
                          disabled={blockedByFunding || (!canRun && Boolean(address))}
                          onSuccess={() => router.refresh()}
                          task={task}
                        />
                      </DialogContent>
                    </Dialog>
                  </article>
                </div>
              );
            }

            return (
              <article
                className="grid min-w-0 gap-2 rounded-lg border border-border/52 bg-surface/40 p-3"
                key={`${action.role}-${action.action}-${action.command}`}
              >
                <div className="min-w-0">
                  <Component
                    action={action}
                    disabled={blockedByFunding || (!canRun && Boolean(address))}
                    onSuccess={() => router.refresh()}
                    task={task}
                  />
                </div>
                <details className="min-w-0">
                  <summary
                    aria-label={`Show ${action.action} command`}
                    className="ml-auto flex size-11 cursor-pointer list-none items-center justify-center rounded-full border border-transparent text-muted-foreground/40 transition-[color,background-color,border-color,opacity] duration-200 hover:border-border/58 hover:bg-background/52 hover:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/35 focus-visible:outline-none md:size-7 [&::-webkit-details-marker]:hidden"
                    title="Show command"
                  >
                    <Terminal aria-hidden="true" className="size-3.5" />
                  </summary>
                  <div className="mt-2 grid min-w-0 gap-2 rounded-lg bg-background/76 p-2">
                    <div className="flex min-w-0 items-center justify-end gap-2">
                      <CopyButton label={`Copy ${action.action} command`} text={action.command} />
                    </div>
                    <pre className="max-w-full overflow-x-auto rounded-md bg-surface/60 p-2 font-mono text-xs leading-5 text-foreground">
                      <code className="block min-w-0">{action.command}</code>
                    </pre>
                  </div>
                </details>
              </article>
            );
          })
        ) : pendingActions.length > 0 ? (
          <div className="rounded-lg border border-dashed border-border/58 bg-background/30 p-4">
            <p className="text-sm font-semibold tracking-tight text-foreground">{emptyTitle}</p>
            <p className="mt-1 text-sm leading-5 text-muted-foreground">{emptyDescription}</p>
          </div>
        ) : (
          <p className="text-sm leading-5 text-muted-foreground">
            <span className="font-medium text-foreground">{emptyTitle}.</span> {emptyDescription}
          </p>
        )}
      </div>
    </section>
  );
}

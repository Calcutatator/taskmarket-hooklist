'use client';

import {
  PAID_PENDING_ACTION_NAMES,
  type PendingAction,
  type TaskDetailResponse,
  type TaskResponse,
} from '@taskmarket/shared';
import { Terminal } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useAccount } from 'wagmi';

import { COMPONENT_BY_ACTION } from '@/components/market/actions';
import { CopyButton } from '@/components/market/copy-button';
import {
  canViewAction,
  type ActionVisibilityParams,
} from '@/components/market/task-action-visibility';
import {
  FundingGuard,
  PAID_ACTION_COST_BASE_UNITS,
  usePaidActionFundingPrompt,
} from '@/components/market/fund-wallet-button';
import { formatUsdcUnits } from '@/lib/format';
import { emitActionInboxEvent } from '@/lib/market/action-inbox-events';
import { taskRatingProgress } from '@/lib/market/task-badges';
import { useInvalidateActionQueue } from '@/lib/use-action-queue';

type TaskActionPanelProps = {
  claimedBy?: string | null;
  emptyReason: string;
  evidenceReady?: boolean;
  hideWhenNoVisibleActions?: boolean;
  pendingActions: PendingAction[];
  requester: string;
  task: TaskDetailResponse | TaskResponse;
  title?: string;
  worker?: string | null;
};

const PAID_ACTIONS = new Set<PendingAction['action']>(PAID_PENDING_ACTION_NAMES);
const SELF_INVALIDATING_ACTIONS = new Set<PendingAction['action']>([
  'accept',
  'appeal',
  'evaluate',
  'evaluator_timeout',
  'finalize_verdict',
  'rate',
  'resolve_dispute',
]);

function isPaidAction(action: PendingAction) {
  return action.requiresPayment ?? PAID_ACTIONS.has(action.action);
}

export { canViewAction };

function canRunAction(params: ActionVisibilityParams) {
  return Boolean(params.address) && canViewAction(params);
}

export function TaskActionsPanel({
  claimedBy,
  emptyReason,
  evidenceReady,
  hideWhenNoVisibleActions = false,
  pendingActions,
  requester,
  task,
  title = 'Next actions',
  worker,
}: TaskActionPanelProps) {
  const { address } = useAccount();
  const router = useRouter();
  const invalidateActionQueue = useInvalidateActionQueue();
  const visibleActions = pendingActions.filter((action) =>
    canViewAction({
      action,
      address,
      claimedBy,
      disputeResolver: task.disputeResolver,
      evidenceReady,
      evaluator: task.evaluator,
      requester,
      worker,
    })
  );
  const hasPaidAction = visibleActions.some(isPaidAction);
  const visibleRatingActions = visibleActions.filter((action) => action.action === 'rate');
  const ratingProgress = visibleRatingActions.length > 0 ? taskRatingProgress(task) : null;
  const { actionFundingPrompt, recheckActionFunding } = usePaidActionFundingPrompt({
    address,
    enabled: hasPaidAction,
  });
  const hasEvidenceAction = pendingActions.some(
    (action) => action.action === 'evaluate' || action.action === 'resolve_dispute'
  );
  const restrictedEvidenceRole =
    task.taskVisibility === 'private' || task.submissionVisibility !== 'public'
      ? visibleActions.find(
          (action) => action.action === 'evaluate' || action.action === 'resolve_dispute'
        )?.role
      : undefined;
  const evidenceUnavailable = hasEvidenceAction && evidenceReady !== true;
  const emptyTitle = evidenceUnavailable
    ? 'Decision evidence unavailable'
    : pendingActions.length > 0
      ? 'No actions for this wallet'
      : 'No pending commands';
  const emptyDescription = evidenceUnavailable
    ? 'Evaluation and dispute controls stay unavailable until the submitted evidence is visible on this page.'
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
        {restrictedEvidenceRole ? (
          <div
            aria-label="Confidential evidence access"
            className="grid gap-1 rounded-lg border border-primary/35 bg-primary/8 p-3"
            role="status"
          >
            <p className="text-sm font-semibold tracking-tight text-foreground">
              Confidential evidence access
            </p>
            <p className="text-xs leading-5 text-muted-foreground">
              Your current{' '}
              {restrictedEvidenceRole === 'dispute_resolver' ? 'dispute resolver' : 'evaluator'}{' '}
              assignment grants access to every submitted item for this decision. Access ends if the
              role is cleared. It does not publish the task or submissions, and it grants no task
              actions beyond those assigned to you.
            </p>
          </div>
        ) : null}
        {ratingProgress ? (
          <div
            aria-label="Rating progress"
            className="grid gap-1 rounded-lg border border-border/60 bg-background/42 p-3"
            role="status"
          >
            <p className="text-sm font-semibold tracking-tight text-foreground">
              {ratingProgress.rated} of {ratingProgress.total} ratings recorded
            </p>
            <p className="text-xs leading-5 text-muted-foreground">
              {ratingProgress.remaining}{' '}
              {ratingProgress.remaining === 1 ? 'rating remains' : 'ratings remaining'} before every
              payout recipient has feedback.
            </p>
          </div>
        ) : null}
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
            const canRun = canRunAction({
              action,
              address,
              claimedBy,
              disputeResolver: task.disputeResolver,
              evidenceReady,
              evaluator: task.evaluator,
              requester,
              worker,
            });
            const blockedByFunding = Boolean(actionFundingPrompt && isPaidAction(action));

            return (
              <article
                className="grid min-w-0 gap-2 rounded-lg border border-border/52 bg-surface/40 p-3"
                key={`${action.role}-${action.action}-${action.command}`}
              >
                <div className="min-w-0">
                  <Component
                    action={action}
                    disabled={blockedByFunding || (!canRun && Boolean(address))}
                    onSuccess={() => {
                      emitActionInboxEvent({
                        action: action.action,
                        event: 'lifecycle_action_completed',
                        taskId: task.id,
                      });
                      if (!SELF_INVALIDATING_ACTIONS.has(action.action)) {
                        void invalidateActionQueue();
                      }
                      router.refresh();
                    }}
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

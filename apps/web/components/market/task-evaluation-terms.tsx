import type { TaskDetailResponse, TaskResponse } from '@taskmarket/shared';
import type { ReactNode } from 'react';

import { AgentAvatar } from '@/components/market/agent-avatar';
import { CopyButton } from '@/components/market/copy-button';
import { InfoTooltip } from '@/components/market/info-tooltip';
import { TaskEvaluationSection } from '@/components/market/task-evaluation-section';
import { ActorLink, taskDisplayReward } from '@/components/market/tasks';
import {
  bpsShareOfBaseUnits,
  formatBps,
  formatDateTime,
  formatDurationSeconds,
  formatUsdcUnits,
} from '@/lib/format';

/**
 * Whether a task's evaluation terms are worth showing at all.
 *
 * An evaluator changes the deal a worker is deciding on: someone other than the requester
 * judges the work, a slice of the advertised reward goes to them, and there are windows in
 * which a verdict lands and can be appealed. None of that was rendered anywhere, so the
 * advertised reward was not what a worker would receive and nothing said so.
 */
export function hasEvaluationTerms(task: TaskDetailResponse | TaskResponse): boolean {
  return Boolean(task.evaluator || task.disputeResolver);
}

function Party({
  address,
  agentId,
  label,
  labelTooltip,
  profileBasePath,
}: {
  address: string;
  agentId?: string | null;
  label: string;
  labelTooltip: string;
  profileBasePath: string;
}) {
  return (
    <div className="grid gap-2 py-3">
      <InfoTooltip label={labelTooltip}>
        <p className="font-mono text-[0.68rem] uppercase text-muted-foreground">{label}</p>
      </InfoTooltip>
      <div className="flex min-w-0 items-center gap-2">
        <AgentAvatar address={address} agentId={agentId ?? undefined} size="sm" />
        {/* ActorLink prefers a registered agent's name over raw hex when an id is known, and
            falls back to a compact address when it is not -- an unregistered evaluator is a
            real, common case, not an error state. */}
        <ActorLink
          address={address}
          agentId={agentId}
          className="min-w-0 truncate font-mono text-sm text-foreground hover:text-primary"
          profileBasePath={profileBasePath}
          title={address}
        />
        <CopyButton label={`Copy ${label.toLowerCase()} address`} text={address} />
      </div>
    </div>
  );
}

function Term({
  caption,
  label,
  labelTooltip,
  value,
}: {
  caption?: ReactNode;
  label: string;
  labelTooltip: string;
  value: ReactNode;
}) {
  return (
    <div className="grid gap-1 py-3">
      <InfoTooltip label={labelTooltip}>
        <p className="font-mono text-[0.68rem] uppercase text-muted-foreground">{label}</p>
      </InfoTooltip>
      <div className="text-sm leading-6 text-foreground">{value}</div>
      {caption ? <p className="text-xs leading-5 text-muted-foreground">{caption}</p> : null}
    </div>
  );
}

/**
 * Evaluation terms on task detail, for a task that actually has them.
 *
 * Pure and props-only, with no data fetching of its own -- identity resolution lives in
 * `TaskEvaluationCard`, so this view stays renderable in isolation. It renders nothing when
 * no evaluator is appointed: "No evaluator" on every task on the platform is noise, and the
 * state that is worth showing to a viewer who can act on it -- appointing one -- depends on
 * the connected wallet and therefore belongs to `AssignEvaluatorAction`, on the other side of
 * the client boundary.
 */
export function TaskEvaluationTerms({
  className,
  disputeResolverAgentId,
  evaluatorAgentId,
  profileBasePath = '/dashboard/agents',
  task,
}: {
  className?: string;
  disputeResolverAgentId?: string | null;
  evaluatorAgentId?: string | null;
  profileBasePath?: string;
  task: TaskDetailResponse | TaskResponse;
}) {
  if (!hasEvaluationTerms(task)) {
    return null;
  }

  const reward = taskDisplayReward(task);
  const feeBaseUnits = bpsShareOfBaseUnits(reward, task.evaluatorFeeBps);
  // For an auction the operative price is still moving, and any task can still be updated
  // while it is open, so this is an estimate against the reward as it stands right now --
  // never quoted as the amount the evaluator will actually be paid.
  const feeMoves = task.mode === 'auction' || task.status === 'open';

  return (
    <TaskEvaluationSection className={className}>
      <p className="text-sm leading-6 text-muted-foreground">
        An independent evaluator judges this work instead of the requester deciding alone. Their fee
        comes out of the reward, so the payout to the worker is less than the advertised reward.
      </p>
      <div className="divide-y divide-border/52 border-y border-border/52">
        {task.evaluator ? (
          <Party
            address={task.evaluator}
            agentId={evaluatorAgentId}
            label="Evaluator"
            labelTooltip="Judges the submitted work and issues the verdict, in place of the requester deciding unilaterally."
            profileBasePath={profileBasePath}
          />
        ) : null}
        <Term
          caption={
            feeBaseUnits
              ? `About ${formatUsdcUnits(feeBaseUnits)} of the ${formatUsdcUnits(reward)} reward${
                  feeMoves ? ', which can still change while the task is open' : ''
                }. The worker receives the remainder, less platform fees.`
              : 'The full reward goes to the worker, less platform fees.'
          }
          label="Evaluator fee"
          labelTooltip="Share of the reward paid to the evaluator rather than to the worker."
          value={<span className="font-mono">{formatBps(task.evaluatorFeeBps)}</span>}
        />
        <Term
          caption={
            task.evaluatorDeadline
              ? `Verdict due ${formatDateTime(task.evaluatorDeadline)}`
              : 'The clock starts when work is submitted.'
          }
          label="Evaluation window"
          labelTooltip="How long the evaluator has to return a verdict once work is submitted. Missing it opens the evaluator-timeout path."
          value={<span className="font-mono">{formatDurationSeconds(task.evaluationWindow)}</span>}
        />
        <Term
          caption={
            task.appealDeadline
              ? `Appeals close ${formatDateTime(task.appealDeadline)}`
              : 'The clock starts when the verdict is issued.'
          }
          label="Appeal window"
          labelTooltip="How long the worker has to appeal the verdict once it is issued. After it closes the verdict is final."
          value={<span className="font-mono">{formatDurationSeconds(task.appealWindow)}</span>}
        />
        {task.disputeResolver ? (
          <Party
            address={task.disputeResolver}
            agentId={disputeResolverAgentId}
            label="Dispute resolver"
            labelTooltip="Decides the outcome if the verdict is appealed."
            profileBasePath={profileBasePath}
          />
        ) : (
          <Term
            label="Dispute resolver"
            labelTooltip="Decides the outcome if the verdict is appealed."
            value={<span className="text-muted-foreground">Not appointed</span>}
          />
        )}
      </div>
    </TaskEvaluationSection>
  );
}

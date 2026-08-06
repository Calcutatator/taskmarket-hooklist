import type { TaskDetailResponse, TaskResponse } from '@taskmarket/shared';
import type { ReactNode } from 'react';

import { CopyButton } from '@/components/market/copy-button';
import { Badge } from '@/components/ui/badge';
import { compactAddress, formatDateTime } from '@/lib/format';

const VERDICT_LABEL = {
  APPROVE: 'Approved',
  PARTIAL: 'Partially approved',
  REJECT: 'Rejected',
} as const;

function EvidenceRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="grid gap-1 border-t border-border/52 py-3 first:border-t-0 first:pt-0 sm:grid-cols-[10rem_minmax(0,1fr)] sm:gap-4">
      <dt className="font-mono text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-sm text-foreground">{value}</dd>
    </div>
  );
}

const unavailable = <span className="text-muted-foreground">Unavailable</span>;

export function VerdictEvidencePanel({
  forceVisible = false,
  task,
}: {
  forceVisible?: boolean;
  task: TaskDetailResponse | TaskResponse;
}) {
  const hasDecisionContext = Boolean(
    task.evaluator ||
    task.disputeResolver ||
    task.evaluatorDeadline ||
    task.appealDeadline ||
    task.verdictType ||
    task.status === 'review' ||
    task.status === 'appealing' ||
    task.status === 'disputed'
  );
  if (!forceVisible && !hasDecisionContext) return null;

  const hasVerdict = Boolean(task.verdictType);

  return (
    <section
      aria-label="Verdict and decision evidence"
      className="grid scroll-mt-24 gap-4 border-t border-border/58 pt-5"
      id="task-verdict"
      tabIndex={-1}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="grid gap-1">
          <h2 className="font-display font-semibold leading-none tracking-tight text-foreground">
            Verdict and decision evidence
          </h2>
          <p className="text-sm text-muted-foreground">
            Inspect the recorded decision context before appealing or finalizing.
          </p>
        </div>
        {task.verdictType ? (
          <Badge variant="outline">{VERDICT_LABEL[task.verdictType]}</Badge>
        ) : null}
      </div>

      {hasVerdict ? (
        <dl className="rounded-lg border border-border/58 bg-card/38 p-4">
          <EvidenceRow label="Verdict type" value={VERDICT_LABEL[task.verdictType!]} />
          <EvidenceRow
            label="Score"
            value={task.verdictScore != null ? `${task.verdictScore} / 1000` : unavailable}
          />
          <EvidenceRow
            label="Confidence"
            value={
              task.verdictConfidence != null ? `${task.verdictConfidence} / 1000` : unavailable
            }
          />
          <EvidenceRow
            label="Evidence hash"
            value={
              task.verdictEvidenceHash ? (
                <span className="flex min-w-0 items-start gap-2">
                  <span className="min-w-0 break-all font-mono text-xs leading-5">
                    {task.verdictEvidenceHash}
                  </span>
                  <CopyButton label="Copy verdict evidence hash" text={task.verdictEvidenceHash} />
                </span>
              ) : (
                unavailable
              )
            }
          />
        </dl>
      ) : (
        <p className="rounded-lg border border-border/58 bg-card/38 p-4 text-sm text-muted-foreground">
          No verdict has been recorded yet. Review the task activity and submitted evidence before
          making a decision.
        </p>
      )}

      <dl className="rounded-lg border border-border/58 bg-card/38 p-4">
        <EvidenceRow
          label="Evaluator"
          value={
            task.evaluator ? (
              <span className="font-mono">{compactAddress(task.evaluator)}</span>
            ) : (
              unavailable
            )
          }
        />
        <EvidenceRow
          label="Dispute resolver"
          value={
            task.disputeResolver ? (
              <span className="font-mono">{compactAddress(task.disputeResolver)}</span>
            ) : (
              unavailable
            )
          }
        />
        <EvidenceRow
          label="Evaluation deadline"
          value={
            task.evaluatorDeadline ? (
              <time dateTime={task.evaluatorDeadline}>
                {formatDateTime(task.evaluatorDeadline)}
              </time>
            ) : (
              unavailable
            )
          }
        />
        <EvidenceRow
          label="Appeal deadline"
          value={
            task.appealDeadline ? (
              <time dateTime={task.appealDeadline}>{formatDateTime(task.appealDeadline)}</time>
            ) : (
              unavailable
            )
          }
        />
      </dl>
    </section>
  );
}

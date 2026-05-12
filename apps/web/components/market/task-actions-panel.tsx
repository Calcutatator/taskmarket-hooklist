'use client';

import type { PendingAction, TaskDetailResponse, TaskResponse } from '@taskmarket/shared';
import { useAccount } from 'wagmi';

import { COMPONENT_BY_ACTION } from '@/components/market/actions';
import { CopyButton } from '@/components/market/copy-button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

type TaskActionPanelProps = {
  claimedBy?: string | null;
  emptyReason: string;
  pendingActions: PendingAction[];
  requester: string;
  task: TaskDetailResponse | TaskResponse;
  worker?: string | null;
};

const actionCopy: Record<string, string> = {
  accept: 'Review the latest submission and release the escrowed payout.',
  auction_accept: 'Accept the live auction price and claim the work.',
  bid: 'Place a bid before the auction deadline.',
  cancel: 'Close the task while it is still cancellable.',
  claim: 'Reserve the task before submitting work.',
  forfeit: 'Reclaim the task from a worker whose claim has expired.',
  pitch: 'Send a proposal for the requester to review.',
  rate: 'Rate completed work after the payout is accepted.',
  select_winner: 'Finalize the auction by selecting the winning bid.',
  select_worker: 'Choose a pitch and move the selected worker into delivery.',
  submit: 'Upload the deliverable for requester review.',
  submit_proof: 'Submit benchmark proof data for verification.',
  update: 'Adjust reward, expiry, or task details while open.',
};

function sameAddress(left?: string | null, right?: string | null) {
  return Boolean(left && right && left.toLowerCase() === right.toLowerCase());
}

function roleTitle(role: PendingAction['role'], connectedRole?: PendingAction['role']) {
  if (role === connectedRole) {
    return 'Your actions';
  }

  return role === 'requester' ? 'Requester actions' : 'Worker actions';
}

function roleTone(role: PendingAction['role']) {
  return role === 'requester'
    ? 'Requester-only actions for managing selection, review, and settlement.'
    : 'Worker actions for claiming, bidding, pitching, or submitting work.';
}

export function TaskActionsPanel({
  claimedBy,
  emptyReason,
  pendingActions,
  requester,
  task,
  worker,
}: TaskActionPanelProps) {
  const { address } = useAccount();
  const connectedRole: PendingAction['role'] | undefined = sameAddress(address, requester)
    ? 'requester'
    : sameAddress(address, worker) || sameAddress(address, claimedBy)
      ? 'worker'
      : undefined;

  const groupedActions = (['requester', 'worker'] as const)
    .map((role) => ({
      actions: pendingActions.filter((action) => action.role === role),
      role,
    }))
    .filter((group) => group.actions.length > 0);

  return (
    <Card className="min-w-0 border-border/68 bg-card/90">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="grid min-w-0 gap-1">
            <CardTitle>Next actions</CardTitle>
            <p className="text-sm leading-5 text-muted-foreground">
              Click an action to run it from the connected wallet. CLI commands stay available under
              each action for agents and operators.
            </p>
          </div>
          {connectedRole ? <Badge variant="terminal">{connectedRole}</Badge> : null}
        </div>
      </CardHeader>
      <CardContent className="grid gap-4">
        {groupedActions.length > 0 ? (
          groupedActions.map((group) => (
            <section
              className="grid min-w-0 gap-3 rounded-xl border border-border/64 bg-background/42 p-3"
              key={group.role}
            >
              <div className="grid min-w-0 gap-1">
                <h3 className="text-sm font-semibold tracking-tight">
                  {roleTitle(group.role, connectedRole)}
                </h3>
                <p className="text-xs leading-5 text-muted-foreground">{roleTone(group.role)}</p>
              </div>
              <div className="grid min-w-0 gap-2">
                {group.actions.map((action) => {
                  const Component = COMPONENT_BY_ACTION[action.action];
                  const wrongRole = connectedRole !== undefined && action.role !== connectedRole;
                  return (
                    <div
                      className="grid min-w-0 gap-2 rounded-xl border border-border/58 bg-surface/72 p-3 shadow-[var(--shadow-soft)]"
                      key={`${action.role}-${action.action}-${action.command}`}
                    >
                      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                        <div className="flex min-w-0 flex-wrap items-center gap-2">
                          <Badge variant="outline">{action.action.replaceAll('_', ' ')}</Badge>
                          <span className="text-xs text-muted-foreground">
                            {actionCopy[action.action] ?? 'Action available.'}
                          </span>
                        </div>
                        <CopyButton label={`Copy ${action.action} command`} text={action.command} />
                      </div>
                      <Component action={action} disabled={wrongRole} task={task} />
                      <details className="grid min-w-0 gap-1">
                        <summary className="cursor-pointer text-xs text-muted-foreground">
                          Show CLI
                        </summary>
                        <pre className="max-w-full overflow-x-auto rounded-lg bg-background/76 p-2 font-mono text-xs leading-5 text-foreground">
                          <code>{action.command}</code>
                        </pre>
                      </details>
                    </div>
                  );
                })}
              </div>
            </section>
          ))
        ) : (
          <div className="rounded-xl border border-dashed border-border/68 bg-background/35 p-4">
            <p className="text-sm font-semibold tracking-tight text-foreground">
              No pending commands
            </p>
            <p className="mt-1 text-sm leading-5 text-muted-foreground">{emptyReason}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

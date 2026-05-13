'use client';

import type { PendingAction, TaskDetailResponse, TaskResponse } from '@taskmarket/shared';
import { useAccount } from 'wagmi';

import { COMPONENT_BY_ACTION } from '@/components/market/actions';
import { CopyButton } from '@/components/market/copy-button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

type TaskActionPanelProps = {
  claimedBy?: string | null;
  emptyReason: string;
  pendingActions: PendingAction[];
  requester: string;
  task: TaskDetailResponse | TaskResponse;
  worker?: string | null;
};

function sameAddress(left?: string | null, right?: string | null) {
  return Boolean(left && right && left.toLowerCase() === right.toLowerCase());
}

type ActionVisibilityParams = {
  action: PendingAction;
  address?: string;
  claimedBy?: string | null;
  requester: string;
  worker?: string | null;
};

function canViewAction({ action, address, claimedBy, requester, worker }: ActionVisibilityParams) {
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
  pendingActions,
  requester,
  task,
  worker,
}: TaskActionPanelProps) {
  const { address } = useAccount();
  const visibleActions = pendingActions.filter((action) =>
    canViewAction({ action, address, claimedBy, requester, worker })
  );
  const emptyTitle =
    pendingActions.length > 0 ? 'No actions for this wallet' : 'No pending commands';
  const emptyDescription =
    pendingActions.length > 0
      ? 'Connect the requester or assigned worker wallet to manage this task.'
      : emptyReason;

  return (
    <Card className="min-w-0 border-border/68 bg-card/90">
      <CardHeader>
        <CardTitle>Next actions</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3">
        {visibleActions.length > 0 ? (
          visibleActions.map((action) => {
            const Component = COMPONENT_BY_ACTION[action.action];
            const canRun = canRunAction({ action, address, claimedBy, requester, worker });

            return (
              <article
                className="grid min-w-0 gap-2 rounded-xl border border-border/58 bg-surface/72 p-3"
                key={`${action.role}-${action.action}-${action.command}`}
              >
                <div className="min-w-0">
                  <Component action={action} disabled={!canRun && Boolean(address)} task={task} />
                </div>
                <details className="min-w-0">
                  <summary className="cursor-pointer text-xs text-muted-foreground">CLI</summary>
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
        ) : (
          <div className="rounded-xl border border-dashed border-border/68 bg-background/35 p-4">
            <p className="text-sm font-semibold tracking-tight text-foreground">{emptyTitle}</p>
            <p className="mt-1 text-sm leading-5 text-muted-foreground">{emptyDescription}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

'use client';

import type { PendingAction, TaskDetailResponse, TaskResponse } from '@taskmarket/shared';
import { useAccount } from 'wagmi';

import { AcceptButton } from '@/components/market/actions/accept-button';

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
  const { address } = useAccount();

  if (!sameAddress(address, task.requester)) {
    return null;
  }

  return (
    <div className="grid min-w-0 gap-2 rounded-xl border border-primary/28 bg-primary/10 p-3">
      <p className="text-sm font-semibold tracking-tight text-foreground">Release payout</p>
      <AcceptButton action={action} disabled={false} task={task} />
    </div>
  );
}

'use client';

import type { PendingAction, TaskDetailResponse, TaskResponse } from '@taskmarket/shared';
import { useRouter } from 'next/navigation';

import { RejectSubmissionButton } from '@/components/market/actions/reject-submission-button';
import { SubmissionPayoutAction } from '@/components/market/actions/submission-payout-action';
import { commandForTaskWorker } from '@/lib/market/task-action-command';
import type { WorkerSubmissionGroup } from '@/lib/market/submission-review';

export type WorkerSubmissionActionsProps = {
  acceptAction?: PendingAction;
  group: WorkerSubmissionGroup;
  onRejectSuccess: (workerKey: string) => void;
  rejectAction?: PendingAction;
  task: TaskDetailResponse | TaskResponse;
};

export function WorkerSubmissionActions({
  acceptAction,
  group,
  onRejectSuccess,
  rejectAction,
  task,
}: WorkerSubmissionActionsProps) {
  const router = useRouter();

  if (group.rejected || (!acceptAction && !rejectAction)) {
    return null;
  }

  const targetedAcceptAction = acceptAction
    ? {
        ...acceptAction,
        command: commandForTaskWorker(acceptAction.command, group.workerAddress),
      }
    : null;

  return (
    <div className="grid min-w-0 gap-3" role="group" aria-label="Submitter decisions">
      {targetedAcceptAction ? (
        <SubmissionPayoutAction
          action={targetedAcceptAction}
          onSuccess={() => router.refresh()}
          task={task}
        />
      ) : null}
      {rejectAction ? (
        <RejectSubmissionButton
          action={rejectAction}
          disabled={false}
          onRejectSuccess={onRejectSuccess}
          onSuccess={() => router.refresh()}
          target={{
            activeSubmissionCount: group.submissions.length,
            workerAddress: group.workerAddress,
          }}
          task={task}
        />
      ) : null}
    </div>
  );
}

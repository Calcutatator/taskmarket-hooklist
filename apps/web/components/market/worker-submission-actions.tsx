'use client';

import type { PendingAction, TaskDetailResponse, TaskResponse } from '@taskmarket/shared';
import { useRouter } from 'next/navigation';

import { RejectSubmissionButton } from '@/components/market/actions/reject-submission-button';
import { SubmissionPayoutAction } from '@/components/market/actions/submission-payout-action';
import { emitActionInboxEvent } from '@/lib/market/action-inbox-events';
import { commandForTaskWorker } from '@/lib/market/task-action-command';
import type { WorkerSubmissionGroup } from '@/lib/market/submission-review';
import { useInvalidateActionQueue } from '@/lib/use-action-queue';

export type WorkerSubmissionActionsProps = {
  acceptAction?: PendingAction;
  group: WorkerSubmissionGroup;
  presentation?: 'bar' | 'default';
  onRejectSuccess: (workerKey: string) => void;
  rejectAction?: PendingAction;
  task: TaskDetailResponse | TaskResponse;
};

export function WorkerSubmissionActions({
  acceptAction,
  group,
  onRejectSuccess,
  presentation = 'default',
  rejectAction,
  task,
}: WorkerSubmissionActionsProps) {
  const router = useRouter();
  const invalidateActionQueue = useInvalidateActionQueue();

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
    <div
      className={
        presentation === 'bar' ? 'flex min-w-0 flex-wrap items-start gap-2' : 'grid min-w-0 gap-3'
      }
      role="group"
      aria-label="Submitter decisions"
    >
      {targetedAcceptAction ? (
        <SubmissionPayoutAction
          action={targetedAcceptAction}
          presentation={presentation}
          task={task}
        />
      ) : null}
      {rejectAction ? (
        <RejectSubmissionButton
          action={rejectAction}
          disabled={false}
          onRejectSuccess={(workerKey) => {
            emitActionInboxEvent({
              action: 'reject_submission',
              event: 'lifecycle_action_completed',
              taskId: task.id,
            });
            void invalidateActionQueue();
            onRejectSuccess(workerKey);
          }}
          onSuccess={() => router.refresh()}
          presentation={presentation === 'bar' ? 'compact' : 'default'}
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

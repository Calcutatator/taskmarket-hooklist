import type { TaskActionIntentValue, TaskActionQueueItem } from '@taskmarket/shared';

export type TaskActionPresentation = {
  anchor:
    | 'settlement-payouts'
    | 'task-activity'
    | 'task-next-actions'
    | 'task-participation'
    | 'task-verdict';
  description: string;
  focusLabel: string;
  title: string;
};

export const TASK_ACTION_PRESENTATION: Record<TaskActionIntentValue, TaskActionPresentation> = {
  appeal_verdict: {
    anchor: 'task-verdict',
    description: 'Review the verdict and supporting evidence before the appeal window closes.',
    focusLabel: 'Review and appeal the verdict',
    title: 'Review and appeal the verdict',
  },
  evaluate_work: {
    anchor: 'task-activity',
    description: 'Review the submitted evidence and record your independent verdict.',
    focusLabel: 'Evaluate submitted work',
    title: 'Evaluate submitted work',
  },
  finalize_verdict: {
    anchor: 'task-verdict',
    description: 'The verdict window is complete. Finalize it to move the task forward.',
    focusLabel: 'Finalize the verdict',
    title: 'Finalize the verdict',
  },
  rate_workers: {
    anchor: 'settlement-payouts',
    description: 'Share feedback after settlement to complete the task relationship.',
    focusLabel: 'Rate settlement recipients',
    title: 'Rate the worker',
  },
  resolve_dispute: {
    anchor: 'task-activity',
    description: 'Review the task evidence and issue the dispute decision.',
    focusLabel: 'Resolve the dispute',
    title: 'Resolve the dispute',
  },
  review_work: {
    anchor: 'task-activity',
    description: 'Review the delivered evidence before accepting, rejecting, or releasing payment.',
    focusLabel: 'Review submitted work',
    title: 'Review submitted work',
  },
  select_auction_winner: {
    anchor: 'task-activity',
    description: 'Compare the eligible bids before assigning the work.',
    focusLabel: 'Select the auction winner',
    title: 'Select the auction winner',
  },
  select_worker: {
    anchor: 'task-activity',
    description: 'Compare the pitches and choose who should complete the task.',
    focusLabel: 'Select a worker',
    title: 'Select a worker',
  },
  settle_expired: {
    anchor: 'task-next-actions',
    description: 'Resolve the expired assignment so the task can reach a terminal state.',
    focusLabel: 'Settle the expired task',
    title: 'Settle the expired task',
  },
  submit_work: {
    anchor: 'task-participation',
    description: 'Upload the requested deliverables before the task deadline.',
    focusLabel: 'Submit your work',
    title: 'Submit your work',
  },
};

export function taskActionTitle(
  intent: TaskActionIntentValue,
  progress?: TaskActionQueueItem['progress']
): string {
  const total = progress?.total;
  const remaining = total ? total - (progress?.completed ?? 0) : null;

  if (intent === 'rate_workers') {
    return remaining && remaining > 1 ? `Rate ${remaining} workers` : 'Rate the worker';
  }
  if (intent === 'review_work') {
    return total && total > 1 ? `Review ${total} submissions` : 'Review submitted work';
  }
  if (intent === 'select_worker') {
    return total && total > 1 ? `Compare ${total} pitches and select a worker` : 'Select a worker';
  }
  return TASK_ACTION_PRESENTATION[intent].title;
}

export function taskActionHref(
  detailBasePath: string,
  taskId: string,
  intent: TaskActionIntentValue
): string {
  const base = detailBasePath.replace(/\/+$/, '');
  const { anchor } = TASK_ACTION_PRESENTATION[intent];
  return `${base}/${encodeURIComponent(taskId)}?focus=${intent}#${anchor}`;
}

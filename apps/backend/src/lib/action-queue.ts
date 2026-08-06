import type {
  PendingAction,
  TaskActionIntentValue,
  TaskActionPriorityValue,
  TaskActionQueueItem,
  TaskActionWaitingItem,
  TaskResponse,
} from '@taskmarket/shared';

import { computePendingActions, type PendingActionTask } from './task';

// Implements: ADR-0041 (the action queue derives from canonical pending actions)
const SUPPRESSED_ACTIONS = new Set<PendingAction['action']>([
  // Suppressed until the pooled-escrow vulnerability tracked in issue #432 is fixed.
  'refund_expired',
]);

const INTENT_BY_ACTION: Partial<Record<PendingAction['action'], TaskActionIntentValue>> = {
  accept: 'review_work',
  accept_submissions: 'review_work',
  reject_submission: 'review_work',
  select_worker: 'select_worker',
  submit: 'submit_work',
  submit_proof: 'submit_work',
  forfeit: 'settle_expired',
  refund_expired: 'settle_expired',
  evaluate: 'evaluate_work',
  evaluator_timeout: 'evaluate_work',
  appeal: 'appeal_verdict',
  resolve_dispute: 'resolve_dispute',
  finalize_verdict: 'finalize_verdict',
  rate: 'rate_workers',
  select_winner: 'select_auction_winner',
};

export type ActionQueueTask = {
  task: TaskResponse;
  pendingActionTask: PendingActionTask;
  submitterAddresses: string[];
};

type ActionQueueProjection = {
  items: TaskActionQueueItem[];
  waiting: TaskActionWaitingItem[];
};

function sameAddress(left: string | null | undefined, right: string): boolean {
  return left?.toLowerCase() === right.toLowerCase();
}

function actionBelongsToAddress(
  action: PendingAction,
  task: PendingActionTask,
  address: string,
  submitterAddresses: string[]
): boolean {
  if (action.eligibleAddress) return sameAddress(action.eligibleAddress, address);

  // Generic marketplace opportunities (claim/bid/pitch/open contest submission) are
  // intentionally not personal work. The two permissionless closeout actions are only
  // personal when this wallet is already a participant in the task.
  if (action.action === 'select_winner') return sameAddress(task.requester, address);
  if (action.action === 'finalize_verdict') {
    return (
      sameAddress(task.requester, address) ||
      sameAddress(task.claimedBy, address) ||
      submitterAddresses.some((submitter) => sameAddress(submitter, address))
    );
  }

  return false;
}

function earliestDueAt(actions: PendingAction[]): string | null {
  const deadlines = actions
    .map((action) => action.availableUntil)
    .filter((deadline): deadline is string => Boolean(deadline))
    .sort();
  return deadlines[0] ?? null;
}

function priorityFor(
  intent: TaskActionIntentValue,
  dueAt: string | null,
  actions: PendingAction[],
  now: Date
): TaskActionPriorityValue {
  if (intent === 'rate_workers') return 'follow_up';
  if (
    actions.some(
      (action) =>
        action.availableAfter && new Date(action.availableAfter).getTime() <= now.getTime()
    )
  ) {
    return 'urgent';
  }
  if (dueAt && new Date(dueAt).getTime() <= now.getTime() + 24 * 60 * 60 * 1000) return 'urgent';
  return 'required';
}

function actionRole(action: PendingAction, task: PendingActionTask, address: string) {
  if (action.role !== 'anyone') return action.role;
  return sameAddress(task.requester, address) ? ('requester' as const) : ('worker' as const);
}

function progressFor(
  intent: TaskActionIntentValue,
  task: PendingActionTask,
  actions: PendingAction[]
): { completed: number; total: number } | null {
  if (intent === 'review_work') {
    return task.submissionCount > 0 ? { completed: 0, total: task.submissionCount } : null;
  }
  if (intent === 'select_worker') {
    return task.pitchCount > 0 ? { completed: 0, total: task.pitchCount } : null;
  }
  if (intent === 'rate_workers') {
    const workers = new Map<string, boolean>();
    for (const award of task.awardWorkers) {
      const key = award.workerAddress.toLowerCase();
      workers.set(key, Boolean(workers.get(key) || award.rating !== null));
    }
    return {
      completed: [...workers.values()].filter(Boolean).length,
      total: workers.size || actions.length,
    };
  }
  return null;
}

function waitingForTask(
  item: ActionQueueTask,
  address: string,
  now: Date
): TaskActionWaitingItem | null {
  const { pendingActionTask: task, submitterAddresses } = item;
  const isRequester = sameAddress(task.requester, address);
  const isAssignedWorker = sameAddress(task.claimedBy, address);
  const isSubmitter = submitterAddresses.some((submitter) => sameAddress(submitter, address));

  let reason: TaskActionWaitingItem['reason'] | null = null;
  let dueAt: string | null = null;
  let role: TaskActionWaitingItem['role'] = isRequester ? 'requester' : 'worker';

  if (
    task.status === 'open' &&
    isRequester &&
    task.submissionCount === 0 &&
    task.expiryTime <= now
  ) {
    reason = 'waiting_for_settlement';
  } else if (task.status === 'open' && isRequester && task.submissionCount === 0) {
    reason = 'waiting_for_submissions';
    dueAt = task.expiryTime.toISOString();
  } else if ((task.status === 'claimed' || task.status === 'worker_selected') && isRequester) {
    reason = 'waiting_for_worker';
    dueAt = task.expiryTime.toISOString();
  } else if (
    (task.status === 'open' || task.status === 'pending_approval') &&
    (isAssignedWorker || isSubmitter)
  ) {
    reason = 'waiting_for_review';
  } else if (task.status === 'review' && (isRequester || isAssignedWorker || isSubmitter)) {
    reason = 'waiting_for_evaluator';
    dueAt = task.evaluatorDeadline?.toISOString() ?? null;
  } else if (task.status === 'appealing' && isRequester) {
    reason = 'waiting_for_appeal_window';
    dueAt = task.appealDeadline?.toISOString() ?? null;
  } else if (task.status === 'pending_approval' && isRequester) {
    reason = 'waiting_for_settlement';
  }

  if (!reason) return null;
  if (!isRequester && sameAddress(task.evaluator, address)) role = 'evaluator';

  return {
    id: `${task.id}:${reason}`,
    task: item.task,
    role,
    reason,
    dueAt,
  };
}

export function projectActionQueueTask(
  item: ActionQueueTask,
  address: string,
  now: Date
): ActionQueueProjection {
  const pendingActions = computePendingActions(item.pendingActionTask, now).filter(
    (action) =>
      !SUPPRESSED_ACTIONS.has(action.action) &&
      actionBelongsToAddress(action, item.pendingActionTask, address, item.submitterAddresses)
  );

  const grouped = new Map<TaskActionIntentValue, PendingAction[]>();
  for (const action of pendingActions) {
    const intent = INTENT_BY_ACTION[action.action];
    if (!intent) continue;
    const actions = grouped.get(intent) ?? [];
    actions.push(action);
    grouped.set(intent, actions);
  }

  const items: TaskActionQueueItem[] = [...grouped.entries()].map(([intent, actions]) => {
    const dueAt = earliestDueAt(actions);
    return {
      id: `${item.pendingActionTask.id}:${intent}`,
      task: item.task,
      role: actionRole(actions[0]!, item.pendingActionTask, address),
      intent,
      actions,
      priority: priorityFor(intent, dueAt, actions, now),
      dueAt,
      progress: progressFor(intent, item.pendingActionTask, actions),
    };
  });

  if (items.length > 0) return { items, waiting: [] };
  const waiting = waitingForTask(item, address, now);
  return { items: [], waiting: waiting ? [waiting] : [] };
}

const PRIORITY_ORDER: Record<TaskActionPriorityValue, number> = {
  urgent: 0,
  required: 1,
  follow_up: 2,
};

export function sortActionQueueItems(items: TaskActionQueueItem[]): TaskActionQueueItem[] {
  return [...items].sort((left, right) => {
    const byPriority = PRIORITY_ORDER[left.priority] - PRIORITY_ORDER[right.priority];
    if (byPriority !== 0) return byPriority;
    if (left.dueAt && right.dueAt) return left.dueAt.localeCompare(right.dueAt);
    if (left.dueAt) return -1;
    if (right.dueAt) return 1;
    return left.task.createdAt.localeCompare(right.task.createdAt);
  });
}

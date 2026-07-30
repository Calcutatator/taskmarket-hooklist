// Implements: ADR-0021 (cancelled+REJECT verdict counts as ended)
import type { Caller } from '../context';
import { canView, type CanViewTask, type TaskViewabilityContext } from './task-visibility';

export type SubmissionVisibilityMode = 'public' | 'reveal_all' | 'winner_only' | 'never';

/**
 * A task is "ended" for reveal purposes once it reaches a terminal state where
 * no further submissions are expected -- matches the lifecycle table in
 * docs/rfc/0005-task-visibility-and-submission-visibility.md ("Active:
 * open/claimed/...; Ended: completed/expired").
 *
 * `cancelled` is usually NOT a resolution outcome -- tasks.router.ts's plain
 * `cancel` mutation only succeeds with zero active (non-rejected) submissions,
 * so a task cancelled that way has nothing left to reveal either way. But
 * evaluations.router.ts's `finalizeVerdict` also sets status to `cancelled`
 * on a REJECT verdict, after a worker submitted, an evaluator ruled, and the
 * appeal window ran -- that IS a genuine resolved outcome (the contract
 * refunds the requester and terminates the task rather than reopening it),
 * and reveal_all/winner_only's "once it ends" promise should apply to it the
 * same as completed/expired. `verdictType` stays 'REJECT' on the task row
 * after that transition (finalizeVerdict never clears it), so it's the only
 * signal available to tell the two `cancelled` causes apart.
 */
const ENDED_TASK_STATUSES = new Set(['completed', 'expired']);

export function isTaskEnded(status: string, verdictType?: string | null): boolean {
  if (ENDED_TASK_STATUSES.has(status)) return true;
  return status === 'cancelled' && verdictType === 'REJECT';
}

export function isRequester(caller: Caller | undefined, task: { requester: string }): boolean {
  return !!caller && caller.address.toLowerCase() === task.requester.toLowerCase();
}

export function isSubmittingWorker(
  caller: Caller | undefined,
  submission: { workerAddress: string }
): boolean {
  return !!caller && caller.address.toLowerCase() === submission.workerAddress.toLowerCase();
}

// Implements: ADR-0016 (submission visibility as an independent axis, public default)
/**
 * Can `caller` see this one submission, given the task's submissionVisibility
 * mode/status and (for winner_only) the set of task_awards-linked winning
 * addresses? This is Phase 2's role/mode gate (ADR-0016).
 *
 * Phase 3 (ADR-0030) composes the general task-level `canView` predicate here, rather
 * than requiring every call site to check it separately: a private task with the
 * default (`public`) submissionVisibility mode would otherwise leak every submission to
 * any caller, since `mode === 'public'` used to short-circuit the rest of this function
 * to `true` regardless of who's asking. But the composition isn't a simple prerequisite
 * gate in front of everything -- the requester and the submission's own submitting
 * worker must always be able to see it, exactly as Phase 2 already guaranteed,
 * regardless of whether they separately satisfy `canView` (e.g. a worker who submitted
 * to a private bounty-mode task without ever being `claimedBy` or allowlisted -- their
 * own submission is still theirs to see). `canView` only gates the *wider* audience
 * beyond the caller's own participation: an uninvited third party, or an invited viewer
 * who never submitted anything.
 *
 * Truth table (see the RFC's "Time + role gated reveal" section):
 *   - Requester or the submission's own submitting worker: always visible, regardless
 *     of task visibility or submission-visibility mode.
 *   - Anyone else on a task not viewable by caller (per canView): never visible.
 *   - public (once the task itself is viewable): always visible.
 *   - Active task (not yet ended): nobody else sees it, regardless of mode.
 *   - Ended task: reveal_all shows everything (to anyone who can view the task);
 *     winner_only shows only task_awards-linked submissions; never shows nothing beyond
 *     requester/submitting worker.
 */
export function canViewSubmission(params: {
  mode: SubmissionVisibilityMode;
  taskStatus: string;
  taskVerdictType?: string | null;
  caller: Caller | undefined;
  task: CanViewTask;
  submission: { workerAddress: string };
  winningAddresses: ReadonlySet<string>;
  taskViewability?: TaskViewabilityContext;
}): boolean {
  const {
    mode,
    taskStatus,
    taskVerdictType,
    caller,
    task,
    submission,
    winningAddresses,
    taskViewability,
  } = params;

  if (isRequester(caller, task)) return true;
  if (isSubmittingWorker(caller, submission)) return true;

  if (!canView(task, caller, taskViewability)) return false;

  if (mode === 'public') return true;
  if (!isTaskEnded(taskStatus, taskVerdictType)) return false;

  switch (mode) {
    case 'reveal_all':
      return true;
    case 'winner_only':
      return winningAddresses.has(submission.workerAddress.toLowerCase());
    case 'never':
      return false;
  }
}

import type { Caller } from '../context';

export type SubmissionVisibilityMode = 'public' | 'reveal_all' | 'winner_only' | 'never';

/**
 * A task is "ended" for reveal purposes once it reaches a terminal state where
 * no further submissions are expected -- matches the lifecycle table in
 * docs/specs/task-visibility-and-submission-visibility.md ("Active:
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

/**
 * Can `caller` see this one submission, given the task's submissionVisibility
 * mode/status and (for winner_only) the set of task_awards-linked winning
 * addresses? This is Phase 2's role/mode gate (ADR-0016) -- narrower than
 * Phase 3's general canView, which will decide "can this caller see the task
 * at all" rather than "can this caller see this one already-visible task's
 * submission."
 *
 * Truth table (see the RFC's "Time + role gated reveal" section):
 *   - public: always visible.
 *   - Active task (not yet ended): requester sees all, submitting worker sees
 *     their own, everyone else sees nothing, regardless of mode.
 *   - Ended task: reveal_all shows everything; winner_only shows only
 *     task_awards-linked submissions; never shows nothing beyond requester/
 *     submitting worker.
 */
export function canViewSubmission(params: {
  mode: SubmissionVisibilityMode;
  taskStatus: string;
  taskVerdictType?: string | null;
  caller: Caller | undefined;
  task: { requester: string };
  submission: { workerAddress: string };
  winningAddresses: ReadonlySet<string>;
}): boolean {
  const { mode, taskStatus, taskVerdictType, caller, task, submission, winningAddresses } = params;

  if (mode === 'public') return true;
  if (isRequester(caller, task)) return true;
  if (isSubmittingWorker(caller, submission)) return true;
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

import { eq, inArray, notInArray, sql } from 'drizzle-orm';
import type { db as DbType } from '../db/client';
import { taskAllowedViewers, taskAwards, tasks, type Task } from '../db/schema';
import type { Caller, TaskAccessGrant } from '../context';

type Db = Pick<typeof DbType, 'select'>;

/**
 * Shared "exclude tasks Taskmarket's own discovery surfaces shouldn't show" filter,
 * reused by every query that respects task visibility outside a caller's own inbox
 * (browse/search, stats, SEO, Task Drop broadcasts). Originally named `taskNotUnlisted`
 * (Phase 1, unlisted-only); Phase 3 (ADR-0030) generalized it to also exclude `'private'`
 * -- per-viewer allowlist membership can't be a single static SQL condition the way "not
 * unlisted" is (each private task has a different allowlist), so bulk discovery surfaces
 * exclude `private` entirely rather than growing caller-awareness. A private task's own
 * requester/invited workers use `agents.inbox` as their "my tasks" surface instead (see
 * agents.router.ts's `invitedPrivateTasks`). Centralizing this one condition means this
 * single rename is what extends private-task exclusion to every call site at once.
 */
export const taskDiscoverable = notInArray(tasks.taskVisibility, ['unlisted', 'private']);

/** Same filter for raw `sql` template contexts (e.g. stats.ts's aggregate queries). */
export const taskDiscoverableSql = sql`task_visibility NOT IN ('unlisted', 'private')`;

export type CanViewTask = {
  id: string;
  taskVisibility: string;
  requester: string;
  claimedBy: string | null;
};

export type TaskViewabilityContext = {
  taskAccessGrant?: TaskAccessGrant;
  allowedViewerAddresses?: ReadonlySet<string>;
  awardedWorkerAddresses?: ReadonlySet<string>;
};

/**
 * Can `caller` (or a presented password-access grant) view this task at all? This is
 * Phase 3's general access-control predicate (ADR-0030) -- broader than
 * `submission-visibility.ts`'s `canViewSubmission`, which decides "can this caller see
 * this one already-visible task's submission," not "can this caller see the task at
 * all." `canViewSubmission` calls this first as a prerequisite (see that module).
 *
 * Truth table:
 *   - public / unlisted: always true. Unlisted's exclusion is discovery-only (see
 *     `taskDiscoverable` above) -- Phase 1 never gated direct fetch-by-ID for it, and
 *     Phase 3 doesn't change that.
 *   - private:
 *     - true if a presented taskAccessGrant is scoped to this exact task (password path)
 *     - true if caller is the requester
 *     - true if caller's address is `task.claimedBy` (pre-completion assignee --
 *       `tasks.worker` no longer exists per migration 0028, this is the correct field)
 *     - true if caller's address is in a `task_awards` row for this task (post-completion
 *       worker; a task can have more than one row under ranked-payout settlement)
 *     - true if caller's address is in the task's wallet allowlist
 *     - else false
 */
export function canView(
  task: CanViewTask,
  caller: Caller | undefined,
  context?: TaskViewabilityContext
): boolean {
  if (task.taskVisibility !== 'private') return true;

  if (context?.taskAccessGrant?.taskId === task.id) return true;

  if (!caller) return false;
  const address = caller.address.toLowerCase();
  if (address === task.requester.toLowerCase()) return true;
  if (task.claimedBy && address === task.claimedBy.toLowerCase()) return true;
  if (context?.awardedWorkerAddresses?.has(address)) return true;
  if (context?.allowedViewerAddresses?.has(address)) return true;
  return false;
}

/**
 * Fetches the allowlist/award context `canView` needs for a private task. Only ever
 * called for tasks actually flagged `private` -- zero added queries for the
 * public/unlisted majority of traffic.
 */
export async function fetchPrivateViewabilityContext(
  db: Db,
  taskId: string
): Promise<{ allowedViewerAddresses: Set<string>; awardedWorkerAddresses: Set<string> }> {
  const [viewerRows, awardRows] = await Promise.all([
    db
      .select({ viewerAddress: taskAllowedViewers.viewerAddress })
      .from(taskAllowedViewers)
      .where(eq(taskAllowedViewers.taskId, taskId)),
    db
      .select({ workerAddress: taskAwards.workerAddress })
      .from(taskAwards)
      .where(eq(taskAwards.taskId, taskId)),
  ]);
  return {
    allowedViewerAddresses: new Set(viewerRows.map((r) => r.viewerAddress.toLowerCase())),
    awardedWorkerAddresses: new Set(awardRows.map((r) => r.workerAddress.toLowerCase())),
  };
}

/**
 * Batched version of `fetchPrivateViewabilityContext`, for endpoints that list results
 * across MANY tasks at once (submissions.listByWorker, submissions.mySubmissions) rather
 * than gating a single task -- avoids one allowlist/award query per private task in the
 * result set. Callers should only pass the distinct `taskId`s that are actually
 * `taskVisibility === 'private'`; an empty array short-circuits to no queries at all.
 */
export async function fetchPrivateViewabilityContextForTasks(
  db: Db,
  taskIds: readonly string[]
): Promise<
  Map<string, { allowedViewerAddresses: Set<string>; awardedWorkerAddresses: Set<string> }>
> {
  const result = new Map<
    string,
    { allowedViewerAddresses: Set<string>; awardedWorkerAddresses: Set<string> }
  >();
  if (taskIds.length === 0) return result;

  const ensure = (taskId: string) => {
    let entry = result.get(taskId);
    if (!entry) {
      entry = { allowedViewerAddresses: new Set(), awardedWorkerAddresses: new Set() };
      result.set(taskId, entry);
    }
    return entry;
  };
  for (const taskId of taskIds) ensure(taskId);

  const [viewerRows, awardRows] = await Promise.all([
    db
      .select({
        taskId: taskAllowedViewers.taskId,
        viewerAddress: taskAllowedViewers.viewerAddress,
      })
      .from(taskAllowedViewers)
      .where(inArray(taskAllowedViewers.taskId, taskIds as string[])),
    db
      .select({ taskId: taskAwards.taskId, workerAddress: taskAwards.workerAddress })
      .from(taskAwards)
      .where(inArray(taskAwards.taskId, taskIds as string[])),
  ]);

  for (const row of viewerRows) {
    ensure(row.taskId).allowedViewerAddresses.add(row.viewerAddress.toLowerCase());
  }
  for (const row of awardRows) {
    ensure(row.taskId).awardedWorkerAddresses.add(row.workerAddress.toLowerCase());
  }

  return result;
}

/**
 * Shared retrofit helper for the structurally-identical `listByTask`/`list` endpoints
 * (bids, pitches, proofs, feedbacks): looks up the task once, short-circuits non-private
 * tasks (the common case), otherwise resolves full viewability. Lenient on a missing task
 * (`viewable: false`, no throw) to match these endpoints' pre-existing "unknown taskId
 * just returns an empty result" behavior -- this doesn't introduce a new
 * existence-confirming signal.
 */
export async function resolveTaskViewability(
  db: Db,
  taskId: string,
  caller: Caller | undefined,
  taskAccessGrant: TaskAccessGrant | undefined
): Promise<{ task: Task | null; viewable: boolean }> {
  const rows = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
  const task = rows[0] ?? null;
  if (!task) return { task: null, viewable: false };
  if (task.taskVisibility !== 'private') return { task, viewable: true };

  const viewability = await fetchPrivateViewabilityContext(db, taskId);
  return { task, viewable: canView(task, caller, { taskAccessGrant, ...viewability }) };
}

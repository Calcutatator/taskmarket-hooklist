import type { TaskResponse } from '@taskmarket/shared';

import type { StatusDatum, TaskStatusBucket } from '@/components/charts';

// Collapse the ten raw task statuses onto the six chart buckets so distributions
// stay scannable and read the same colour as the status badges. Anything unknown
// falls through to "expired" (the neutral/dead bucket). This is the single source
// of truth shared by the marketplace distribution chart and the personal "You"
// view so a status maps the same way everywhere.
export const STATUS_BUCKET: Record<string, TaskStatusBucket> = {
  appealing: 'pending',
  cancelled: 'expired',
  claimed: 'active',
  completed: 'completed',
  disputed: 'disputed',
  expired: 'expired',
  open: 'open',
  pending_approval: 'pending',
  review: 'pending',
  worker_selected: 'active',
};

export const BUCKET_LABEL: Record<TaskStatusBucket, string> = {
  active: 'Active',
  completed: 'Completed',
  disputed: 'Disputed',
  expired: 'Expired',
  open: 'Open',
  pending: 'Pending',
};

// A stable ordering so slices and the legend keep a predictable sequence run to
// run rather than re-sorting by count.
export const BUCKET_ORDER: TaskStatusBucket[] = [
  'open',
  'active',
  'pending',
  'completed',
  'disputed',
  'expired',
];

// Resolve a raw task status onto its chart bucket, defaulting unknown statuses
// to the neutral "expired" bucket.
export function statusToBucket(status: string): TaskStatusBucket {
  return STATUS_BUCKET[status] ?? 'expired';
}

export type DayBucket = {
  bucket: string;
  count: number;
  // Reward volume for the bucket, in whole USDC (base units scaled by 1e6). Kept
  // separate from count so a chart never mixes a USDC axis with a count axis.
  volume: number;
};

// A 'YYYY-MM-DD' UTC day key for an ISO timestamp. Parsing the parts in UTC keeps
// a task from drifting to the previous/next day across a local-timezone boundary.
function dayKey(iso: string): string | null {
  const ms = new Date(iso).getTime();
  if (Number.isNaN(ms)) {
    return null;
  }
  return new Date(ms).toISOString().slice(0, 10);
}

// Reward arrives as a base-units string (6 decimals). Scale to whole USDC for
// display-friendly magnitudes; non-numeric or missing rewards count as zero.
function rewardToUsdc(value?: string | null): number {
  if (value === null || value === undefined || value === '') {
    return 0;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed / 1_000_000 : 0;
}

// Bucket a task list by UTC day on the given timestamp key, returning one entry
// per day that has at least one task, sorted ascending. Each entry carries both a
// count (tasks that day) and a reward volume (summed reward in whole USDC) so a
// caller can plot either series without mixing the two on one axis. Tasks with an
// unparseable timestamp are skipped.
export function bucketTasksByDay(
  tasks: TaskResponse[],
  key: 'createdAt' | 'claimedAt' = 'createdAt'
): DayBucket[] {
  const byDay = new Map<string, DayBucket>();

  for (const task of tasks) {
    const raw = task[key];
    if (!raw) {
      continue;
    }
    const day = dayKey(raw);
    if (!day) {
      continue;
    }
    const existing = byDay.get(day);
    if (existing) {
      existing.count += 1;
      existing.volume += rewardToUsdc(task.reward);
    } else {
      byDay.set(day, { bucket: day, count: 1, volume: rewardToUsdc(task.reward) });
    }
  }

  return Array.from(byDay.values()).sort((a, b) => a.bucket.localeCompare(b.bucket));
}

// Group a task list into the six status buckets, returning only non-empty buckets
// in the stable BUCKET_ORDER. Shape matches StatusDatum so the result feeds the
// shared StatusBreakdown donut directly.
export function taskStatusDistribution(tasks: TaskResponse[]): StatusDatum[] {
  const totals = new Map<TaskStatusBucket, number>();
  for (const task of tasks) {
    const bucket = statusToBucket(task.status);
    totals.set(bucket, (totals.get(bucket) ?? 0) + 1);
  }

  return BUCKET_ORDER.filter((bucket) => (totals.get(bucket) ?? 0) > 0).map((bucket) => ({
    bucket,
    label: BUCKET_LABEL[bucket],
    value: totals.get(bucket) ?? 0,
  }));
}

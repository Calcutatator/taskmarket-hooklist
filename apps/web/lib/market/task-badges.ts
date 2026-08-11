import type {
  TaskAward,
  TaskDetailResponse,
  TaskModeType,
  TaskResponse,
  TaskStatusType,
} from '@taskmarket/shared';

import { getStatusConfig, type StatusPhase } from '@/lib/market/status-config';

// Shared badge treatments so the same task concept renders identically across the
// listing table, mobile cards, and the detail page. Status carries the semantic
// colour; mode and tags stay neutral so they do not compete with the status signal.

export function settledAwards(task: TaskDetailResponse | TaskResponse): TaskAward[] {
  return 'awards' in task ? (task.awards ?? []) : [];
}

export function taskRatingProgress(
  task: TaskDetailResponse | TaskResponse
): { rated: number; remaining: number; total: number } | null {
  const ratingsByWorker = new Map<string, boolean>();
  for (const award of settledAwards(task)) {
    const key = award.workerAddress.toLowerCase();
    ratingsByWorker.set(key, Boolean(ratingsByWorker.get(key) || award.rating !== null));
  }
  if (ratingsByWorker.size <= 1) return null;

  const rated = [...ratingsByWorker.values()].filter(Boolean).length;
  return { rated, remaining: ratingsByWorker.size - rated, total: ratingsByWorker.size };
}

// Falls back to the settled awards length for responses that don't carry a
// computed awardCount (e.g. TaskResponse from list endpoints). Shared so every
// surface that needs "how many winners" agrees, instead of re-deriving this
// fallback independently.
export function resolvedAwardCount(task: TaskDetailResponse | TaskResponse): number {
  return task.awardCount ?? settledAwards(task).length;
}

// Shared so the listing table, mobile cards, and detail page render the same label
// for the same task instead of re-deriving the "Split payout" string independently.
export function splitPayoutLabel(task: TaskDetailResponse | TaskResponse): string | null {
  const count = resolvedAwardCount(task);
  return count > 1 ? `Split payout · ${count}` : null;
}

export type BadgeVariant =
  | 'default'
  | 'secondary'
  | 'destructive'
  | 'outline'
  | 'ghost'
  | 'link'
  | 'terminal'
  | 'success'
  | 'warning';

export const TASK_TAG_BADGE_VARIANT: BadgeVariant = 'terminal';

const STATUS_BADGE_VARIANT: Record<TaskStatusType, BadgeVariant> = {
  open: 'success',
  claimed: 'default',
  worker_selected: 'default',
  pending_approval: 'warning',
  review: 'warning',
  appealing: 'warning',
  completed: 'secondary',
  disputed: 'destructive',
  expired: 'outline',
  cancelled: 'outline',
};

// Colour-code status so a user can scan for acceptable (open/live) vs dead tasks.
// An open task past its expiry reads neutral, matching statusContext() in tasks.tsx.
export function taskStatusBadgeVariant(
  task: Pick<TaskResponse, 'status' | 'expiryTime'>
): BadgeVariant {
  const expiry = new Date(task.expiryTime).getTime();
  if (task.status === 'open' && Number.isFinite(expiry) && expiry < Date.now()) {
    return 'outline';
  }

  return STATUS_BADGE_VARIANT[task.status] ?? 'outline';
}

// One map for every mode so the listing and detail header stay in lockstep and no
// single mode (previously auction) is arbitrarily highlighted. Per-mode colour can
// be introduced here later without touching call sites.
const MODE_BADGE_VARIANT: Record<TaskModeType, BadgeVariant> = {
  bounty: 'outline',
  claim: 'outline',
  pitch: 'outline',
  benchmark: 'outline',
  auction: 'outline',
};

export function taskModeBadgeVariant(mode: TaskModeType): BadgeVariant {
  return MODE_BADGE_VARIANT[mode] ?? 'outline';
}

// Human-readable status label routed through STATUS_CONFIG (getStatusConfig is safe for
// statuses this client has not mapped yet). Use this everywhere a raw status enum was
// previously shown so a reader sees "Awaiting buyer review" rather than "pending_approval".
export function taskStatusLabel(status: TaskStatusType | string): string {
  return getStatusConfig(status).label;
}

// The lifecycle phase a status belongs to: workable (anyone can pick it up), in-progress
// (a worker or decision is mid-flight), or closed (terminal). Lets a surface visually
// separate live, workable tasks from settled ones without re-deriving the mapping.
export function taskStatusPhase(status: TaskStatusType | string): StatusPhase {
  return getStatusConfig(status).phase;
}

// Same as taskStatusPhase, but downgrades an open task past its expiry from "workable"
// to "in-progress": the submission window has closed, so it no longer reads as freely
// pickable even though the on-chain status is still literally 'open'. Mirrors
// taskStatusBadgeVariant's expiry check so the phase chip never contradicts the badge
// colour on the same task.
export function taskEffectivePhase(task: Pick<TaskResponse, 'status' | 'expiryTime'>): StatusPhase {
  const expiry = new Date(task.expiryTime).getTime();
  if (task.status === 'open' && Number.isFinite(expiry) && expiry < Date.now()) {
    return 'in-progress';
  }

  return taskStatusPhase(task.status);
}

// Phase-driven accent for surfaces that want to group workable vs closed work at a glance
// (e.g. a left border or section heading) rather than per-status colour. open/workable
// reads as the actionable accent; closed reads neutral; in-progress sits between.
export function taskStatusPhaseVariant(status: TaskStatusType | string): BadgeVariant {
  switch (taskStatusPhase(status)) {
    case 'workable':
      return 'success';
    case 'closed':
      return 'outline';
    case 'in-progress':
    default:
      return 'default';
  }
}

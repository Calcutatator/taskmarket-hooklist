import type { TaskModeType, TaskStatusType } from '@taskmarket/shared';

// Centralised, human-readable copy for task statuses, modes, and metric legends so
// every surface (listing, detail header, tooltips, charts) speaks the same language.
// task-badges.ts owns the colour treatment; this module owns the words and the
// workable/in-progress/closed phase a status belongs to.

export type StatusPhase = 'workable' | 'in-progress' | 'closed';

export type StatusConfigEntry = {
  label: string;
  description: string;
  phase: StatusPhase;
};

// Phase separates "you can pick this up" (workable) from work that is mid-flight
// (in-progress) and from terminal states (closed). open is the only freely workable
// status; claimed/worker_selected mean a worker is already engaged. review/appealing/
// disputed are decisions in flight, not yet final. completed/expired/cancelled are done.
export const STATUS_CONFIG: Record<TaskStatusType, StatusConfigEntry> = {
  open: {
    label: 'Open',
    description: 'Accepting workers. Anyone matching the brief can take this on.',
    phase: 'workable',
  },
  claimed: {
    label: 'Claimed',
    description: 'A worker reserved this task and is delivering the work.',
    phase: 'in-progress',
  },
  worker_selected: {
    label: 'Worker selected',
    description: 'A worker was chosen and is delivering the work.',
    phase: 'in-progress',
  },
  pending_approval: {
    label: 'Awaiting buyer review',
    description: 'Work was submitted and is waiting for the requester to accept or reject.',
    phase: 'in-progress',
  },
  review: {
    label: 'Judging',
    description: 'An evaluator is scoring the submitted work against the brief.',
    phase: 'in-progress',
  },
  appealing: {
    label: 'Under appeal',
    description: 'A party contested the outcome and the appeal window is open.',
    phase: 'in-progress',
  },
  disputed: {
    label: 'Disputed',
    description: 'The outcome is contested and is being settled by a dispute resolver.',
    phase: 'in-progress',
  },
  completed: {
    label: 'Completed',
    description: 'Work was accepted and the reward was released. This task is closed.',
    phase: 'closed',
  },
  expired: {
    label: 'Expired',
    description: 'The deadline passed before the task was completed.',
    phase: 'closed',
  },
  cancelled: {
    label: 'Cancelled',
    description: 'The requester cancelled this task before it completed.',
    phase: 'closed',
  },
};

// One-line, plain-language explanation of each mode. Condensed from task-mode-config.ts
// (taskModeOptions.body) so tooltips stay in lockstep with the create flow copy.
export const MODE_TOOLTIPS: Record<TaskModeType, string> = {
  bounty:
    'Open submission pool. Agents submit without reserving the task; the requester picks the strongest delivery.',
  claim: 'One worker reserves the task before starting, so duplicate work does not waste budget.',
  pitch:
    'Workers pitch their approach first; the requester selects a plan before execution begins.',
  benchmark: 'Workers submit measurable proof; a score, threshold, or benchmark decides quality.',
  auction: 'Workers compete on price through open, sealed, or clock-based bidding.',
};

// Plain-language explanation of task visibility, reused by both the "Unlisted"
// detail-page badge tooltip and the create-flow toggle disclaimer so the wording
// never drifts between the two surfaces. Deliberately simple: unlisted only opts
// a task out of Taskmarket's own browse/search listings, never out of the public
// blockchain -- it is never private or confidential, and must never be described
// that way to a user.
export const TASK_VISIBILITY_DISCLAIMER =
  "Unlisted just means this task won't show up when people browse or search Taskmarket. Anyone with the direct link can still open it, and it stays permanently visible on the public blockchain to anyone who looks. It is not private or secret.";

// Plain-language explanation of each submissionVisibility mode, reused by the
// create-flow control and the locked review-step summary so the wording never
// drifts between the two surfaces. This choice is locked in permanently once a
// task is created -- there is no edit path -- so the copy leans on "forever"
// language rather than describing it as changeable later.
export const SUBMISSION_VISIBILITY_DISCLAIMERS: Record<
  'public' | 'reveal_all' | 'winner_only' | 'never',
  string
> = {
  public:
    'Submissions are visible to anyone who can view this task, immediately -- the same as every task today.',
  reveal_all:
    'Submissions stay hidden from everyone but you and each submitting worker while the task is active. Once it ends, every submission becomes visible to anyone who can view the task.',
  winner_only:
    'Submissions stay hidden from everyone but you and each submitting worker while the task is active. Once it ends, only the winning submission(s) become visible; the rest stay hidden.',
  never:
    'Submissions stay hidden from everyone but you and each submitting worker, forever -- even after the task ends.',
};

export const SUBMISSION_VISIBILITY_LABELS: Record<
  'public' | 'reveal_all' | 'winner_only' | 'never',
  string
> = {
  public: 'Public',
  reveal_all: 'Reveal all',
  winner_only: 'Winner only',
  never: 'Never',
};

export const SUBMISSION_VISIBILITY_LOCKED_NOTICE =
  'This choice is locked in permanently once the task is created. There is no way to change it later.';

// Plain-language meaning of the headline agent metrics, mirroring how they are derived
// in components/market/agents.tsx (averageRating 0-100; credibility as a weighted
// share of accepted/rated work). Used to fill metric tooltips/legends consistently.
export const METRIC_LEGENDS: Record<string, string> = {
  rating: "Average score 0-100 from requesters who rated this agent's completed work.",
  credibility:
    "Share of this agent's accepted work that passed verification / completion rate - how much weight to give the rating.",
};

// Titleize an unknown status string ("worker_selected" -> "Worker selected") so the UI
// degrades gracefully if the backend introduces a status the frontend has not mapped yet.
function titleizeStatus(status: string): string {
  const cleaned = status.replace(/[_-]+/g, ' ').trim();
  if (!cleaned) {
    return 'Unknown';
  }
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

// Safe lookup for arbitrary status strings. Known statuses return their curated entry;
// anything else falls back to a titleized label and an 'in-progress' phase (the neutral
// default - an unknown status is more likely mid-flight than freely workable or closed).
export function getStatusConfig(status: string): StatusConfigEntry {
  const known = (STATUS_CONFIG as Record<string, StatusConfigEntry | undefined>)[status];
  if (known) {
    return known;
  }

  return {
    label: titleizeStatus(status),
    description: 'Status not recognised by this client.',
    phase: 'in-progress',
  };
}

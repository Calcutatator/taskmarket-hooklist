import type { SubmissionResponse, TaskModeType, TaskPhaseType } from '@taskmarket/shared';

import { isMediaArtifact } from '@/lib/market/task-cover';

// Lifecycle model for the public Task Drop page.
//
// Lifecycle copy uses the server-computed `phase` from ADR-0024. Entry CTAs use
// `submissionWindowOpen` separately because phase=active also includes pending_approval, where the
// lifecycle is active but delivery is already closed. Keeping those concepts separate prevents a
// task from reading "Open now" when nobody can submit.

export type DropTaskPhase = TaskPhaseType;

export type DropState = 'upcoming' | 'live' | 'judging' | 'settling' | 'finished';

export type DropCover = {
  alt: string;
  kind: 'image' | 'video';
  url: string;
};

// Deliberately carries no amount beyond the task reward. TaskAwardSchema also exposes
// grossAmount / workerPayment / platformFee, and none of those belong on a marketing surface —
// leaving them off the type makes that a compile error rather than a code-review catch.
export type DropWinner = {
  rank: number;
  rating: number | null;
  workerAddress: string;
  workerAgentId: string | null;
};

export type DropPageDrop = {
  description: string | null;
  id: string;
  isOfficial: boolean;
  name: string;
  officialWalletAddress: string;
  ownerAddress: string;
};

export type DropTask = {
  acceptsEntries: boolean;
  cover: DropCover | null;
  entries: number;
  expiryTime: string;
  id: string;
  mode: TaskModeType;
  phase: DropTaskPhase;
  reward: string;
  title: string;
  winners: DropWinner[];
  workIsPublic: boolean;
};

export function deriveDropState(
  tasks: ReadonlyArray<Pick<DropTask, 'acceptsEntries' | 'phase'>>
): DropState {
  if (tasks.length === 0) {
    return 'upcoming';
  }
  if (tasks.some((task) => task.acceptsEntries)) {
    return 'live';
  }
  if (tasks.every((task) => task.phase === 'resolved')) {
    return 'finished';
  }
  return tasks.some((task) => task.phase === 'in_review') ? 'judging' : 'settling';
}

// The nearest deadline among tasks accepting entries only. Taking the nearest across all tasks is the current
// bug: on a closed drop every expiry is in the past, so the page reports 'No open deadline' instead
// of reporting that the drop finished.
export function nearestActiveExpiry(tasks: ReadonlyArray<DropTask>): string | null {
  return (
    tasks
      .filter((task) => task.acceptsEntries)
      .map((task) => task.expiryTime)
      .filter((value) => Number.isFinite(new Date(value).getTime()))
      .sort((a, b) => new Date(a).getTime() - new Date(b).getTime())[0] ?? null
  );
}

export function countByPhase(tasks: ReadonlyArray<DropTask>) {
  return {
    accepting: tasks.filter((task) => task.acceptsEntries).length,
    active: tasks.filter((task) => task.phase === 'active').length,
    judging: tasks.filter(
      (task) => task.phase === 'in_review' || task.phase === 'awaiting_settlement'
    ).length,
    resolved: tasks.filter((task) => task.phase === 'resolved').length,
  };
}

export function totalEntries(tasks: ReadonlyArray<DropTask>) {
  return tasks.reduce((total, task) => total + task.entries, 0);
}

// How many entries a task has. Both available sources are wrong in a knowable direction, so the
// count is the larger of the two.
//
// `submissionCount` UNDER-reports: across a 12-task drop on 2026-07-26 it totalled 214 while the
// listings returned 851 records, and it did not move over three days in which ~450 further records
// landed. It reads like a stale counter.
//
// The submissions LISTING can also under-report, because it filters row by row on
// `submissionVisibility`. An ended `winner_only` task returns only its award-linked rows — non-empty,
// but a fraction of the field. Counting that listing would render a 200-entry task as "3", which is
// worse than the stale counter and, being plausible, harder to spot.
//
// Neither is known to over-report, so `max` takes whichever saw more: 851 over 214, and 200 over 3.
//
// TODO(Beau): if `submissionCount` becomes reliable this collapses back to the counter alone.
export function counterEntries(
  detail: {
    auctionBidCount?: number | null;
    mode?: string;
    pitchCount?: number;
    submissionCount?: number;
  } | null
) {
  if (!detail) {
    return 0;
  }
  if (detail.mode === 'pitch') {
    return detail.pitchCount ?? 0;
  }
  if (detail.mode === 'auction') {
    return detail.auctionBidCount ?? 0;
  }
  return detail.submissionCount ?? 0;
}

export function entryCount(
  detail: Parameters<typeof counterEntries>[0],
  visibleSubmissions: ReadonlyArray<Pick<SubmissionResponse, 'rejectedAt'>>
) {
  // Pitch and auction tasks produce no submissions at all, so their own counters are the only source.
  if (detail && (detail.mode === 'pitch' || detail.mode === 'auction')) {
    return counterEntries(detail);
  }
  const acceptedEntries = visibleSubmissions.filter((submission) => !submission.rejectedAt).length;
  return Math.max(acceptedEntries, counterEntries(detail));
}

export function totalWinners(tasks: ReadonlyArray<DropTask>) {
  return tasks.reduce((total, task) => total + task.winners.length, 0);
}

// Section order per state. Live: enter first, because the visitor's best move is to compete.
// Finished: winners and the work first, because the drop's output is the argument, and the CTA
// becomes a route into the current drop rather than a dead end.
export type DropSectionKey = 'alerts' | 'enter' | 'winners' | 'work';

export function sectionOrder(state: DropState): DropSectionKey[] {
  if (state === 'finished') {
    return ['winners', 'work', 'enter', 'alerts'];
  }
  if (state === 'judging' || state === 'settling') {
    return ['work', 'winners', 'enter', 'alerts'];
  }
  return ['enter', 'work', 'winners', 'alerts'];
}

export function statePill(state: DropState, openCount: number) {
  if (state === 'upcoming') {
    return 'OPENING SOON';
  }
  if (state === 'live') {
    return `LIVE NOW · ${openCount} ${openCount === 1 ? 'TASK' : 'TASKS'} OPEN`;
  }
  if (state === 'judging') {
    return 'JUDGING';
  }
  return state === 'settling' ? 'CLOSING' : 'FINISHED';
}

// Same pick as TaskCover: first embeddable image or video that came back with a presigned preview.
// When `preferWorker` is set we look only at that worker's submissions, so a winner row never
// attributes another entrant's media to the recipient.
//
// TODO(Beau): TaskAwardSchema carries no submissionId, so a winner pinned to an earlier submission
// (the 3-part --winner addr:share:submissionId form) resolves here to that worker's most recent
// non-rejected submission instead. Adding submissionId to the award would make this exact.
export function pickCover(
  submissions: ReadonlyArray<SubmissionResponse>,
  preferWorker?: string
): DropCover | null {
  const wanted = preferWorker?.toLowerCase();
  const pool = wanted
    ? submissions.filter(
        (submission) => submission.workerAddress.toLowerCase() === wanted && !submission.rejectedAt
      )
    : submissions.filter((submission) => !submission.rejectedAt);

  const ordered = [...pool].sort(
    (a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime()
  );

  const artifact = ordered
    .flatMap((submission) => submission.artifacts ?? [])
    .filter(isMediaArtifact)
    .find((candidate) => Boolean(candidate.previewUrl));

  if (!artifact?.previewUrl) {
    return null;
  }

  return {
    alt: artifact.fileName,
    kind: artifact.mediaKind === 'video' ? 'video' : 'image',
    url: artifact.previewUrl,
  };
}

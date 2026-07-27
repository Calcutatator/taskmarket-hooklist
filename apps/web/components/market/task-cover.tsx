'use client';

import type { ArtifactResponse, TaskModeType, TaskResponse } from '@taskmarket/shared';
import { BadgeCheck, Gauge, Gavel, MessageSquareQuote, Play, Target } from 'lucide-react';
import { useRef, useState, type ComponentType } from 'react';

import {
  RewardAmount,
  activityCount,
  activityLabel,
  taskHasActivity,
} from '@/components/market/tasks';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  splitPayoutLabel,
  taskModeBadgeVariant,
  taskStatusBadgeVariant,
  taskStatusLabel,
} from '@/lib/market/task-badges';
import { isMediaArtifact, taskCoverPlaceholderStyle } from '@/lib/market/task-cover';
import { taskTitle } from '@/lib/market/task-title';
import { trpc } from '@/lib/api/client';

// Gallery cover for a task listing. Unlike ArtifactMediaTile (a detail-view component that
// prints fileName, "mimeType / size", and an Open button) this renders a uniform, edge-to-edge
// cover with the title and reward overlaid, so a grid of mixed media + text-only tasks stays
// rectangular and scannable like Behance/Cosmos. Phase 3 will add a backend cover field; until
// then a task with submission media lazily fetches its first preview, and text-only tasks get a
// deterministic placeholder so no card is ever an empty box.

// Whether the visitor's device is a real pointer (so hover-autoplay is meaningful) and motion
// is allowed. Guarded for SSR where window/matchMedia do not exist.
function prefersInteractiveMotion() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  return (
    window.matchMedia('(hover: hover)').matches &&
    !window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

const COVER_MEDIA_CLASS =
  'absolute inset-0 h-full w-full object-cover transition-transform duration-300 ease-[var(--ease-premium)] group-hover:scale-[1.04] motion-reduce:transition-none motion-reduce:group-hover:scale-100';

function CoverImage({ artifact, previewUrl }: { artifact: ArtifactResponse; previewUrl: string }) {
  return (
    <img alt={artifact.fileName} className={COVER_MEDIA_CLASS} loading="lazy" src={previewUrl} />
  );
}

function CoverVideo({ previewUrl }: { previewUrl: string }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [showPuck, setShowPuck] = useState(true);

  function handleEnter() {
    if (!prefersInteractiveMotion()) {
      return;
    }
    const video = videoRef.current;
    if (!video) {
      return;
    }
    setShowPuck(false);
    void video.play().catch(() => {
      // Autoplay can be blocked; restore the puck so the tile still reads as playable.
      setShowPuck(true);
    });
  }

  function handleLeave() {
    const video = videoRef.current;
    if (video) {
      video.pause();
      video.currentTime = 0;
    }
    setShowPuck(true);
  }

  return (
    <>
      <video
        className={COVER_MEDIA_CLASS}
        muted
        onMouseEnter={handleEnter}
        onMouseLeave={handleLeave}
        playsInline
        preload="metadata"
        ref={videoRef}
        src={previewUrl}
      />
      {showPuck ? (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 grid place-items-center"
          data-task-cover-play
        >
          <span className="grid size-10 place-items-center rounded-full bg-background/70 ring-1 ring-border/58 backdrop-blur">
            <Play className="size-4" />
          </span>
        </div>
      ) : null}
    </>
  );
}

// Mode glyph used as a faint watermark on placeholder covers, so a text-only task still reads
// as a specific kind of work at a glance.
const MODE_GLYPH: Record<TaskModeType, ComponentType<{ className?: string }>> = {
  bounty: Target,
  claim: BadgeCheck,
  pitch: MessageSquareQuote,
  benchmark: Gauge,
  auction: Gavel,
};

function TaskPlaceholderCover({ task }: { task: TaskResponse }) {
  const Glyph = MODE_GLYPH[task.mode] ?? Target;

  return (
    <div aria-hidden className="absolute inset-0" style={taskCoverPlaceholderStyle(task.id)}>
      <Glyph className="absolute -right-4 -top-4 size-28 text-foreground/12" />
    </div>
  );
}

// Media cover: only mounted for tasks that report activity, so a paginated feed makes a bounded
// number of preview requests rather than one per row. Picks the first embeddable image/video
// with a presigned preview URL and renders it edge-to-edge; otherwise falls back to the
// placeholder with zero layout shift.
function TaskMediaCover({ task }: { task: TaskResponse }) {
  const { data, isError, isLoading } = trpc.submissions.listByTask.useQuery(
    { includePreviewUrls: 'media', taskId: task.id },
    {
      refetchOnWindowFocus: false,
      staleTime: 120_000,
    }
  );

  if (isLoading) {
    return <Skeleton className="absolute inset-0 h-full w-full" />;
  }

  const cover = isError
    ? undefined
    : (data ?? [])
        .flatMap((submission) => submission.artifacts ?? [])
        .filter(isMediaArtifact)
        .find((artifact) => Boolean(artifact.previewUrl));

  if (!cover || !cover.previewUrl) {
    return <TaskPlaceholderCover task={task} />;
  }

  return cover.mediaKind === 'video' ? (
    <CoverVideo previewUrl={cover.previewUrl} />
  ) : (
    <CoverImage artifact={cover} previewUrl={cover.previewUrl} />
  );
}

export function TaskCover({ task }: { task: TaskResponse }) {
  const hasActivity = taskHasActivity(task);
  const count = activityCount(task);
  const splitLabel = splitPayoutLabel(task);

  return (
    <div className="group relative aspect-[4/3] w-full overflow-hidden rounded-lg bg-surface/44 ring-1 ring-inset ring-border/58 transition-shadow duration-300 group-hover:ring-border">
      {hasActivity ? <TaskMediaCover task={task} /> : <TaskPlaceholderCover task={task} />}
      {/* Bottom scrim keeps the title/reward legible; a lighter top scrim backs the
          badges, which are pinned top-left so their position is constant across the
          grid instead of floating with title length. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-gradient-to-t from-background/92 via-background/30 to-transparent"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-2/5 bg-gradient-to-b from-background/64 via-background/16 to-transparent"
      />
      <div className="absolute left-3 top-3 z-10 flex flex-wrap gap-1.5">
        <Badge variant={taskModeBadgeVariant(task.mode)}>{task.mode}</Badge>
        <Badge variant={taskStatusBadgeVariant(task)}>{taskStatusLabel(task.status)}</Badge>
        {splitLabel ? <Badge variant="outline">{splitLabel}</Badge> : null}
      </div>
      <div className="absolute inset-x-0 bottom-0 z-10 grid gap-1.5 p-3">
        <h3 className="line-clamp-2 font-sans text-sm font-semibold leading-snug text-foreground transition-colors duration-200 group-hover:text-primary">
          {taskTitle(task)}
        </h3>
        <div className="flex items-end justify-between gap-3">
          <RewardAmount align="start" task={task} />
          {count > 0 ? (
            <span className="font-mono text-xs text-muted-foreground">{activityLabel(task)}</span>
          ) : null}
        </div>
      </div>
    </div>
  );
}

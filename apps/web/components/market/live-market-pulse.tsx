'use client';

import type { TaskResponse } from '@taskmarket/shared';
import type { Route } from 'next';
import Link from 'next/link';

import { ArtifactMediaTile } from '@/components/market/artifact-preview-button';
import { AnimatedNumber } from '@/components/market/motion/animated-number';
import { LiveTetrisBackground } from '@/components/market/live-tetris-background';
import { Badge } from '@/components/ui/badge';
import { trpc } from '@/lib/api/client';
import { compactAddress, formatNumber, formatUsdcUnits } from '@/lib/format';
import { isMediaArtifact } from '@/lib/market/task-cover';
import { taskTitle } from '@/lib/market/task-title';

// Lazily fetch the first media artifact submitted to a task and render it as a small tile.
// Only mount this for tasks that already indicate submissions exist (subs > 0): the four-card
// pulse then issues at most four preview requests rather than one per row. React Query caches
// and dedupes by query key. A future backend "cover preview" field on TaskResponse would let
// the feed render covers with zero extra requests and should replace this when available.
function TaskPulseThumbnail({ taskId }: { taskId: string }) {
  const { data } = trpc.submissions.listByTask.useQuery(
    { includePreviewUrls: 'media', taskId },
    {
      refetchOnWindowFocus: false,
      staleTime: 30_000,
    }
  );

  const cover = (data ?? [])
    .flatMap((submission) => submission.artifacts ?? [])
    .filter(isMediaArtifact)
    .filter((artifact) => Boolean(artifact.previewUrl))[0];

  // Hide entirely when the task has no embeddable media yet, so the card stays clean.
  if (!cover) {
    return null;
  }

  return (
    <div className="w-full max-w-40">
      <ArtifactMediaTile artifact={cover} taskId={taskId} />
    </div>
  );
}

type LandingStats = {
  agentCount?: number;
  taskCount?: number;
  totalRewards?: string;
};

function labelize(value?: string | null) {
  return value ? value.replaceAll('_', ' ') : 'standard';
}

function PulseStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-1 border-l border-border/58 bg-card/44 px-3 py-2 first:border-l-0">
      <p className="font-mono text-[0.65rem] font-semibold uppercase text-muted-foreground">
        {label}
      </p>
      <AnimatedNumber
        className="block font-mono text-2xl font-semibold text-foreground"
        duration={0.4}
        offset={8}
        value={value}
      />
    </div>
  );
}

function AnimatedCount({ label, value }: { label: string; value: number }) {
  return (
    <span className="inline-flex items-center gap-1 font-mono text-[0.7rem] uppercase text-muted-foreground">
      <AnimatedNumber
        className="inline-block font-semibold text-foreground"
        format={(input) => formatNumber(Number(input))}
        value={value}
      />
      <span>{label}</span>
    </span>
  );
}

function TaskPulseCard({ detailBasePath, task }: { detailBasePath: string; task: TaskResponse }) {
  const href = `${detailBasePath}/${task.id}`;
  const modeLabel = task.auctionType
    ? `${labelize(task.auctionType)} auction`
    : labelize(task.mode);
  const bidCount = task.auctionBidCount ?? 0;
  const pitchCount = task.pitchCount ?? 0;
  const submissionCount = task.submissionCount ?? 0;

  return (
    <li
      className="grid grid-cols-[minmax(0,1fr)] gap-3 rounded-lg border border-border/58 bg-card/44 p-4 transition-[background-color,border-color] duration-300 ease-[var(--ease-premium)] hover:border-primary/36 hover:bg-surface/44"
      data-testid="live-market-task-card"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="terminal">{modeLabel}</Badge>
        <Badge variant={task.status === 'open' ? 'success' : 'outline'}>
          {labelize(task.status)}
        </Badge>
        {task.tags.slice(0, 3).map((tag) => (
          <Badge key={tag} variant="outline">
            {tag}
          </Badge>
        ))}
      </div>

      {/* Show the work: tasks that already have submissions surface their first media
          artifact. Only mount the thumbnail when subs > 0 so the four-card pulse makes at
          most four bounded preview requests; the thumbnail hides itself when no media exists.
          N+1 tradeoff: one submissions.listByTask request per such card (React Query dedupes
          shared keys). A future backend "cover preview" field on the task would remove it. */}
      {submissionCount > 0 ? (
        <div className="overflow-hidden rounded-lg">
          <TaskPulseThumbnail taskId={task.id} />
        </div>
      ) : null}

      <Link
        className="block truncate font-sans text-sm font-semibold tracking-tight text-foreground transition-colors hover:text-primary"
        href={href as Route}
        title={taskTitle(task)}
      >
        {taskTitle(task)}
      </Link>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-3 border-t border-border/58 pt-3 sm:grid-cols-[auto_1fr] sm:items-end">
        <div>
          <p className="font-mono text-[0.65rem] uppercase text-muted-foreground">Reward</p>
          <p className="mt-1 font-mono text-xl font-semibold text-primary">
            {formatUsdcUnits(task.reward)}
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-start gap-x-4 gap-y-1 sm:justify-end">
          <AnimatedCount label="bids" value={bidCount} />
          <AnimatedCount label="pitches" value={pitchCount} />
          <AnimatedCount label="subs" value={submissionCount} />
          <span className="font-mono text-[0.7rem] uppercase text-muted-foreground">
            {compactAddress(task.requester)}
          </span>
        </div>
      </div>
    </li>
  );
}

export function LiveMarketPulseSection({
  detailBasePath = '/tasks',
  initialStats,
  initialTasks,
}: {
  detailBasePath?: string;
  initialTasks: TaskResponse[];
  initialStats: LandingStats;
}) {
  const { data } = trpc.tasks.list.useQuery(
    { status: 'open', limit: 24 },
    {
      initialData: { tasks: initialTasks, nextCursor: null, hasMore: false },
      refetchInterval: 15_000,
      refetchOnWindowFocus: true,
    }
  );

  const tasks = data?.tasks ?? [];
  const visibleTasks = tasks.slice(0, 4);
  const hasTasks = visibleTasks.length > 0;

  return (
    <section
      aria-labelledby="live-market-pulse-title"
      className={`relative isolate flex flex-col justify-center overflow-hidden border-b border-border/58 px-4 py-16 sm:px-6 sm:py-24 lg:px-8 ${
        hasTasks ? 'min-h-[100dvh]' : ''
      }`}
      id="live-market-pulse"
    >
      <LiveTetrisBackground />
      <div className="relative z-[1] mx-auto grid w-full max-w-7xl grid-cols-[minmax(0,1fr)] gap-8">
        <div className="mx-auto grid w-full max-w-5xl grid-cols-[minmax(0,1fr)] gap-6 text-center">
          <div className="mx-auto grid w-full max-w-3xl grid-cols-[minmax(0,1fr)] gap-3">
            <h2
              className="text-center font-display text-3xl font-semibold tracking-tight leading-none sm:text-5xl"
              id="live-market-pulse-title"
            >
              Live funded work
            </h2>
            <p className="mx-auto max-w-2xl text-base leading-7 text-muted-foreground">
              Funded tasks as agents see them. Counts and rewards refresh every fifteen seconds, so
              buyers can see what the market is doing before they post.
            </p>
          </div>

          <div className="grid grid-cols-[minmax(0,1fr)] overflow-hidden rounded-lg border border-border/58 bg-background/44 text-left backdrop-blur sm:grid-cols-3">
            <PulseStat label="Open tasks" value={formatNumber(initialStats.taskCount)} />
            <PulseStat label="Agents" value={formatNumber(initialStats.agentCount)} />
            <PulseStat label="Posted volume" value={formatUsdcUnits(initialStats.totalRewards)} />
          </div>
        </div>

        {visibleTasks.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border/58 bg-card/44 p-8 text-center font-mono text-sm uppercase text-muted-foreground">
            No open tasks right now. Check back soon.
          </div>
        ) : (
          <ul
            className="mx-auto grid w-full max-w-4xl grid-cols-1 gap-3"
            data-testid="live-market-task-list"
          >
            {visibleTasks.map((task) => (
              <TaskPulseCard detailBasePath={detailBasePath} key={task.id} task={task} />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

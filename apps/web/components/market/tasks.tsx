import type {
  ArtifactResponse,
  BidResponse,
  ClaimResponse,
  PendingAction,
  PitchResponse,
  ProofResponse,
  SubmissionResponse,
  TaskAward,
  TaskDetailResponse,
  TaskModeType,
  TaskResponse,
  TaskStatusType,
} from '@taskmarket/shared';
import { formatDreams } from '@taskmarket/shared';
import { SlidersHorizontal } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { SubmissionPayoutAction } from '@/components/market/actions/submission-payout-action';
import {
  ArtifactMediaTile,
  ArtifactPreviewButton,
} from '@/components/market/artifact-preview-button';
import { CopyButton } from '@/components/market/copy-button';
import { InfoTooltip } from '@/components/market/info-tooltip';
import { LiveActivityPanel } from '@/components/market/live-activity';
import { CountdownTimer } from '@/components/market/motion/countdown-timer';
import { RelativeTime } from '@/components/market/motion/relative-time';
import { LiveStatusBanner } from './tasks/live-status-banner';
import { PublishedCelebration } from '@/components/market/tasks/published-celebration';
import { TaskActionsPanel } from '@/components/market/task-actions-panel';
import { UnlistedBadge } from '@/components/market/unlisted-badge';
import { Badge } from '@/components/ui/badge';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from '@/components/ui/drawer';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from '@/components/ui/pagination';
import { TaskCover } from '@/components/market/task-cover';
import { TaskListBoard } from '@/components/market/task-thumbnail';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import type { MarketStats } from '@/lib/api/server';
import { explorerTxUrl } from '@/lib/explorer';
import { compactAddress, formatDateTime, formatUsdcUnits } from '@/lib/format';
import { MODE_TOOLTIPS, STATUS_CONFIG } from '@/lib/market/status-config';
import {
  TASK_TAG_BADGE_VARIANT,
  resolvedAwardCount,
  settledAwards,
  splitPayoutLabel,
  taskModeBadgeVariant,
  taskStatusBadgeVariant,
  taskStatusLabel,
  taskStatusPhase,
} from '@/lib/market/task-badges';
import { taskToAgentJson, taskToMarkdown } from '@/lib/market/task-export';
import { TASK_SORT_OPTIONS, normalizeBasePath, taskFiltersHref } from '@/lib/market/task-filters';
import type { ActiveFilter, TaskSearchParams, TaskSortValue } from '@/lib/market/task-filters';

const modes: Array<'ALL' | TaskModeType> = [
  'ALL',
  'bounty',
  'claim',
  'pitch',
  'benchmark',
  'auction',
];
const statuses: Array<'ALL' | TaskStatusType> = [
  'ALL',
  'open',
  'claimed',
  'pending_approval',
  'completed',
  'cancelled',
];

export type TaskModeData = {
  bids?: BidResponse[];
  claim?: ClaimResponse | null;
  pitches?: PitchResponse[];
  proofs?: ProofResponse[];
  submissions?: SubmissionResponse[];
};

export function taskTitle(task: TaskResponse) {
  // Strip markdown noise (emphasis, backticks, heading markers) so raw briefs do not
  // leak "**Title**" into cards. Underscores stay: snake_case identifiers are content.
  const firstLine = (task.description.split('\n')[0] ?? '')
    .replace(/^#+\s*/, '')
    .replace(/[*`]/g, '')
    .trim();
  return firstLine.slice(0, 80) || `Task ${task.id}`;
}

function taskBody(task: TaskResponse) {
  const description = task.description.trim();
  const body = description.split('\n').slice(1).join('\n').trim();

  if (body) {
    return body;
  }

  return description === taskTitle(task).trim() ? '' : description;
}

// --- Brief legibility (TM-013) -------------------------------------------------------
// Task descriptions are frequently authored as a SHOUTY, slab of ALL-CAPS sections
// (ASK / DELIVERABLES / JUDGED / NOT THIS). We detect that structure and render it as
// readable, collapsible sections with a short normal-case summary on top, while staying
// robust to plain prose (which renders unchanged). No content is ever dropped.

type BriefSection = { heading: string; body: string };

// A header line is a short, mostly-uppercase line (optionally ending in ':' and with no
// trailing sentence punctuation) such as "ASK", "DELIVERABLES:", or "NOT THIS". The
// uppercase + brevity test keeps ordinary shouted sentences from being mistaken for headers.
function isBriefHeading(line: string): boolean {
  const trimmed = line.trim().replace(/:$/, '');
  if (trimmed.length === 0 || trimmed.length > 32) {
    return false;
  }
  const letters = trimmed.replace(/[^a-z]/gi, '');
  if (letters.length < 2) {
    return false;
  }
  // Reject lines that read as sentences (terminal punctuation) even if shouted.
  if (/[.!?]$/.test(trimmed)) {
    return false;
  }
  // All alphabetic characters present must be uppercase, and the word count must be small.
  const isUpper = letters === letters.toUpperCase();
  const wordCount = trimmed.split(/\s+/).length;
  return isUpper && wordCount <= 4;
}

// "DELIVERABLES" -> "Deliverables", "NOT THIS" -> "Not this". Keeps the first word's
// initial capital and lowercases the rest so a heading reads as a label, not a shout.
function titleizeHeading(line: string): string {
  const cleaned = line.trim().replace(/:$/, '').toLowerCase();
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

// Soften an all-caps content line to sentence case so the spec is readable. Only applied
// when the whole line is uppercase (so deliberately-cased prose and acronyms-in-context are
// left alone). Mixed-case lines pass through untouched.
function softenShout(line: string): string {
  const letters = line.replace(/[^a-z]/gi, '');
  if (letters.length === 0 || letters !== letters.toUpperCase()) {
    return line;
  }
  const lowered = line.toLowerCase();
  return lowered.replace(
    /^(\s*)([a-z])/,
    (_match, lead: string, char: string) => lead + char.toUpperCase()
  );
}

// Split a brief body into headed sections. Lines before the first header become an
// untitled intro section. Returns a single untitled section when no headers are found.
function parseBriefSections(body: string): BriefSection[] {
  const lines = body.split('\n');
  const sections: BriefSection[] = [];
  let current: BriefSection | null = null;
  const intro: string[] = [];

  for (const line of lines) {
    if (isBriefHeading(line)) {
      if (current) {
        sections.push(current);
      }
      current = { body: '', heading: titleizeHeading(line) };
    } else if (current) {
      current.body += (current.body ? '\n' : '') + line;
    } else {
      intro.push(line);
    }
  }
  if (current) {
    sections.push(current);
  }

  const introBody = intro.join('\n').trim();
  if (introBody) {
    sections.unshift({ body: introBody, heading: '' });
  }

  return sections.length > 0 ? sections : [{ body: body.trim(), heading: '' }];
}

// First readable line/sentence of the brief, softened to normal case, as a quick summary.
function briefSummary(body: string): string {
  const firstLine = body
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.length > 0 && !isBriefHeading(line));
  if (!firstLine) {
    return '';
  }
  const sentence = firstLine.split(/(?<=[.!?])\s/)[0] ?? firstLine;
  return softenShout(sentence);
}

function taskDetailTags(task: TaskResponse) {
  const duplicateValues = new Set(
    [task.mode, task.status, task.auctionType].flatMap((value) =>
      value ? [value.toLowerCase()] : []
    )
  );

  return task.tags.filter((tag) => !duplicateValues.has(tag.toLowerCase().replaceAll(' ', '_')));
}

function labelize(value?: string | null) {
  return value ? value.replaceAll('_', ' ') : 'standard';
}

function formatBps(value?: number | null) {
  if (!value) {
    return 'None';
  }

  return `${(value / 100).toFixed(2)}%`;
}

export function countLabel(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

export function taskDeadlineSource(task: TaskDetailResponse | TaskResponse) {
  if (task.mode === 'auction' && task.bidDeadline) {
    return task.bidDeadline;
  }

  if (task.mode === 'pitch' && task.pitchDeadline) {
    return task.pitchDeadline;
  }

  return task.expiryTime;
}

function taskDeadlineLabel(task: TaskDetailResponse | TaskResponse) {
  return formatDateTime(taskDeadlineSource(task));
}

// For auctions the operative figure is the live clock price (dutch) or lowest bid
// (english), not the static reward. Fall back to reward when the live value is absent.
function taskDisplayReward(task: TaskDetailResponse | TaskResponse) {
  if (task.mode === 'auction') {
    if (
      (task.auctionType === 'dutch' || task.auctionType === 'reverse_dutch') &&
      task.currentAuctionPrice
    ) {
      return task.currentAuctionPrice;
    }
    if (
      (task.auctionType === 'english' || task.auctionType === 'reverse_english') &&
      task.currentLowestBid
    ) {
      return task.currentLowestBid;
    }
  }

  return task.reward;
}

function auctionPriceCaption(task: TaskDetailResponse | TaskResponse) {
  if (task.mode !== 'auction') {
    return null;
  }
  if (task.auctionType === 'dutch' || task.auctionType === 'reverse_dutch') {
    return task.currentAuctionPrice ? 'clock price' : null;
  }
  if (task.auctionType === 'english' || task.auctionType === 'reverse_english') {
    return task.currentLowestBid ? 'lowest bid' : null;
  }
  return null;
}

// Estimated worker DREAMS bonus caption for the task detail reward metric. Only present
// when the DREAMS reward hook is attached to this task and an exchange rate + bonus rate
// are configured (estimatedWorkerDreamsBonus only exists on the detail response, not list
// rows). Shows both the USD bonus value and the DREAMS-token equivalent so the two rates
// (bonusBps and dreamsPerUsdc) are never conflated -- see docs/reference/rewards.md. This
// is a display estimate -- actual payouts also apply the wallet-age ramp and epoch budget
// caps, and bounty-mode payouts settle at completion-time rates, not these.
function dreamsBonusCaption(task: TaskDetailResponse | TaskResponse): string | null {
  const usdBonus =
    'estimatedWorkerUsdBonusValue' in task ? task.estimatedWorkerUsdBonusValue : undefined;
  const dreamsBonus =
    'estimatedWorkerDreamsBonus' in task ? task.estimatedWorkerDreamsBonus : undefined;
  if (!dreamsBonus || dreamsBonus === '0' || !usdBonus || usdBonus === '0') {
    return null;
  }
  return `~${formatUsdcUnits(usdBonus)} · ~${formatDreams(dreamsBonus)} DREAMS worker bonus (est.)`;
}

// Reward as a scannable headline: larger/bolder than the surrounding cells, plus an
// auction caption when the figure is a live clock/bid price rather than the static reward.
export function RewardAmount({
  align = 'start',
  task,
}: {
  align?: 'start' | 'end';
  task: TaskDetailResponse | TaskResponse;
}) {
  const caption = auctionPriceCaption(task);
  const formatted = formatUsdcUnits(taskDisplayReward(task));
  const lastSpace = formatted.lastIndexOf(' ');
  const amount = lastSpace === -1 ? formatted : formatted.slice(0, lastSpace);
  const unit = lastSpace === -1 ? '' : formatted.slice(lastSpace + 1);

  return (
    <span className={`flex flex-col gap-0.5 ${align === 'end' ? 'items-end' : 'items-start'}`}>
      <span className="font-mono leading-none text-primary">
        <span className="text-base font-semibold">{amount}</span>
        {unit ? <span className="ml-1 text-[0.7rem] text-muted-foreground">{unit}</span> : null}
      </span>
      {caption ? (
        <span className="font-mono text-[0.6rem] uppercase tracking-wide text-muted-foreground">
          {caption}
        </span>
      ) : null}
    </span>
  );
}

// Relative time-to-deadline coloured by urgency, with the absolute timestamp on hover.
// CountdownTimer re-ticks live once mounted; under reduced motion it stays static.
function DeadlineLabel({
  className,
  task,
}: {
  className?: string;
  task: TaskDetailResponse | TaskResponse;
}) {
  // A countdown is only meaningful while a task can still progress. For settled tasks
  // (completed/cancelled) a "3d left" reads as misleading, so show a neutral placeholder.
  if (task.status === 'completed' || task.status === 'cancelled') {
    return <span className={`font-mono text-muted-foreground ${className ?? ''}`}>--</span>;
  }

  return (
    <CountdownTimer
      className={`font-mono ${className ?? ''}`}
      source={taskDeadlineSource(task)}
      title={taskDeadlineLabel(task)}
    />
  );
}

// Agent-vs-human trust signal next to a requester/worker address.
function ActorTypeBadge({ actorType }: { actorType?: 'agent' | 'human' | null }) {
  if (!actorType) {
    return null;
  }

  return (
    <Badge
      title={
        actorType === 'human' ? 'Registered as a human via the web app' : 'Automated agent account'
      }
      variant="outline"
    >
      {actorType}
    </Badge>
  );
}

// Lifecycle phase chip: separates work you can pick up (workable) from work that is
// mid-flight or already settled (closed). Reads from STATUS_CONFIG via taskStatusPhase so
// it stays in lockstep with the per-status colour and never re-derives the mapping.
const PHASE_COPY: Record<ReturnType<typeof taskStatusPhase>, { label: string; title: string }> = {
  workable: { label: 'Workable', title: 'Open for anyone matching the brief to take on.' },
  'in-progress': { label: 'In progress', title: 'A worker or decision is mid-flight.' },
  closed: { label: 'Closed', title: 'This task has settled and can no longer accept work.' },
};

function PhaseBadge({ status }: { status: TaskStatusType }) {
  const phase = taskStatusPhase(status);
  const copy = PHASE_COPY[phase];
  // Workable reads as the actionable accent; in-progress/closed stay neutral so the chip
  // reinforces the status colour without competing with it.
  return (
    <Badge title={copy.title} variant={phase === 'workable' ? 'success' : 'outline'}>
      {copy.label}
    </Badge>
  );
}

function awardRecipientCount(awards: TaskAward[]): number {
  return new Set(awards.map((award) => award.workerAddress.toLowerCase())).size;
}

function isAwardRecipient(task: TaskDetailResponse | TaskResponse, address: string): boolean {
  return settledAwards(task).some(
    (award) => award.workerAddress.toLowerCase() === address.toLowerCase()
  );
}

function ratingProgress(task: TaskDetailResponse | TaskResponse): string | null {
  const awards = settledAwards(task);
  const ratingsByWorker = new Map<string, boolean>();
  for (const award of awards) {
    const key = award.workerAddress.toLowerCase();
    ratingsByWorker.set(key, Boolean(ratingsByWorker.get(key) || award.rating !== null));
  }
  if (ratingsByWorker.size <= 1) return null;
  return `${[...ratingsByWorker.values()].filter(Boolean).length} of ${ratingsByWorker.size} rated`;
}

function statusContext(task: TaskDetailResponse | TaskResponse) {
  const expiry = new Date(task.expiryTime);
  if (task.status === 'open' && Number.isFinite(expiry.getTime()) && expiry < new Date()) {
    if ((task.mode === 'bounty' || task.mode === 'benchmark') && task.submissionCount > 0) {
      return 'Reviewing submissions';
    }
    if (task.mode === 'pitch' && task.pitchCount > 0) {
      return 'Reviewing pitches';
    }
    return 'Expired — no submissions';
  }

  switch (task.status) {
    case 'open':
      return 'Accepting work';
    case 'claimed':
      return 'Worker assigned';
    case 'worker_selected':
      return 'Pitch selected';
    case 'pending_approval':
      return 'Awaiting requester review';
    case 'completed':
      return (
        ratingProgress(task) ??
        (task.primaryAward?.rating == null ? 'Completed, rating pending' : 'Completed')
      );
    case 'cancelled':
      return 'Cancelled';
    case 'expired':
      return 'Expired';
    case 'disputed':
      return 'Disputed';
    default:
      return labelize(task.status);
  }
}

function pendingActionEmptyReason(task: TaskDetailResponse | TaskResponse) {
  const expiry = new Date(task.expiryTime);
  if (task.status === 'open' && Number.isFinite(expiry.getTime()) && expiry < new Date()) {
    return 'This task has passed its expiry time, so no open commands are available.';
  }

  switch (task.status) {
    case 'completed':
      return (
        ratingProgress(task) ??
        (task.primaryAward?.rating == null
          ? 'Payment confirmed. The requester can still leave a rating.'
          : 'This task is complete.')
      );
    case 'cancelled':
      return 'This task was cancelled.';
    case 'expired':
      return 'This task expired before work could continue.';
    case 'disputed':
      return 'This task is disputed and needs off-flow resolution.';
    default:
      return 'There is no CLI action available for the current mode and status.';
  }
}

export function activityEmptyCopy(task: TaskDetailResponse | TaskResponse) {
  switch (task.mode) {
    case 'auction':
      return task.auctionType === 'dutch' || task.auctionType === 'reverse_dutch'
        ? 'Auction acceptance activity will appear here after a worker takes the clock price.'
        : 'Bids will appear here as workers compete before the bid deadline.';
    case 'benchmark':
      return 'Benchmark proofs will appear here after workers submit metric evidence.';
    case 'claim':
      return 'Claim and submission activity will appear here after a worker reserves the task.';
    case 'pitch':
      return 'Worker pitches will appear here for requester selection.';
    case 'bounty':
    default:
      return 'Submissions will appear here after workers upload deliverables.';
  }
}

export function activityCount(task: TaskDetailResponse | TaskResponse, modeData?: TaskModeData) {
  switch (task.mode) {
    case 'auction':
      return task.auctionBidCount ?? modeData?.bids?.length ?? 0;
    case 'benchmark':
      return modeData?.proofs?.length ?? 0;
    case 'pitch':
      return task.pitchCount ?? modeData?.pitches?.length ?? 0;
    case 'claim':
    case 'bounty':
    default:
      return task.submissionCount ?? modeData?.submissions?.length ?? 0;
  }
}

export function activityLabel(task: TaskDetailResponse | TaskResponse, modeData?: TaskModeData) {
  const count = activityCount(task, modeData);

  switch (task.mode) {
    case 'auction':
      return countLabel(count, 'bid');
    case 'benchmark':
      return countLabel(count, 'proof');
    case 'pitch':
      return countLabel(count, 'pitch', 'pitches');
    case 'claim':
    case 'bounty':
    default:
      return countLabel(count, 'submission');
  }
}

function activityTitle(task: TaskDetailResponse | TaskResponse) {
  switch (task.mode) {
    case 'auction':
      return 'Bids';
    case 'benchmark':
      return 'Proofs';
    case 'pitch':
      return 'Pitches';
    case 'claim':
    case 'bounty':
    default:
      return 'Submissions';
  }
}

function TaskMobileCard({ detailBasePath, task }: { detailBasePath: string; task: TaskResponse }) {
  const detailHref = `${normalizeBasePath(detailBasePath)}/${encodeURIComponent(task.id)}`;
  const splitLabel = splitPayoutLabel(task);

  return (
    <li className="grid gap-3 rounded-lg border border-border/58 bg-background/38 p-4">
      <div className="grid gap-2">
        <Link
          className="text-base font-semibold leading-6 text-foreground hover:text-primary"
          href={detailHref as Route}
        >
          {taskTitle(task)}
        </Link>
        <div className="flex flex-wrap gap-1.5">
          <Badge variant={taskModeBadgeVariant(task.mode)}>{task.mode}</Badge>
          <Badge variant={taskStatusBadgeVariant(task)}>{taskStatusLabel(task.status)}</Badge>
          {splitLabel ? <Badge variant="outline">{splitLabel}</Badge> : null}
          {taskDetailTags(task)
            .slice(0, 2)
            .map((tag) => (
              <Badge key={tag} variant={TASK_TAG_BADGE_VARIANT}>
                {tag}
              </Badge>
            ))}
        </div>
      </div>
      <dl className="grid grid-cols-2 gap-3 text-sm">
        <div className="min-w-0">
          <dt className="font-mono text-xs uppercase text-muted-foreground">Reward</dt>
          <dd className="mt-1">
            <RewardAmount task={task} />
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="font-mono text-xs uppercase text-muted-foreground">Due</dt>
          <dd className="mt-1 truncate">
            <DeadlineLabel task={task} />
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="font-mono text-xs uppercase text-muted-foreground">Requester</dt>
          <dd className="mt-1 flex flex-wrap items-center gap-1.5">
            <span className="font-mono text-muted-foreground" title={task.requester}>
              {compactAddress(task.requester)}
            </span>
            <ActorTypeBadge actorType={task.requesterActorType} />
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="font-mono text-xs uppercase text-muted-foreground">Activity</dt>
          <dd className="mt-1 font-mono text-muted-foreground">{activityLabel(task)}</dd>
        </div>
      </dl>
      <Button asChild className="w-full sm:w-fit" variant="outline">
        <Link href={detailHref as Route}>View task</Link>
      </Button>
    </li>
  );
}

export type TaskListView = 'table' | 'gallery';

// Whether a listing row carries any in-flight work, across every mode. Drives the
// "show the work" thumbnail: only tasks that report submissions/bids/pitches/proofs mount a
// TaskThumbnail, so a paginated feed makes a bounded number of preview requests rather than
// one per row. (Only submissions carry media artifacts today, but counting all activity
// keeps the gate honest and future-proof.)
export function taskHasActivity(task: TaskResponse): boolean {
  return (
    (task.submissionCount ?? 0) > 0 || (task.pitchCount ?? 0) > 0 || (task.auctionBidCount ?? 0) > 0
  );
}

// Gallery card: a scannable, image-forward alternative to a table row for visual work. The
// whole card is a single link to the detail page, with the cover (media or deterministic
// placeholder) carrying the title, badges, reward, and activity in its overlay. There are no
// nested interactive elements so the card stays one focusable target.
function TaskGalleryCard({ detailBasePath, task }: { detailBasePath: string; task: TaskResponse }) {
  const detailHref = `${normalizeBasePath(detailBasePath)}/${encodeURIComponent(task.id)}`;

  return (
    <li>
      <Link
        className="group block rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
        href={detailHref as Route}
      >
        <TaskCover task={task} />
      </Link>
    </li>
  );
}

function TaskGalleryGrid({
  detailBasePath,
  tasks,
}: {
  detailBasePath: string;
  tasks: TaskResponse[];
}) {
  return (
    <ul
      aria-label="Task gallery"
      className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4"
      data-testid="task-gallery"
      role="list"
    >
      {tasks.map((task) => (
        <TaskGalleryCard detailBasePath={detailBasePath} key={task.id} task={task} />
      ))}
    </ul>
  );
}

// Gallery loading state: a grid of aspect-[4/3] skeletons matching the cover shape, so a
// switch to the gallery view does not collapse into the lightweight table-row bars.
function TaskGallerySkeletonGrid() {
  return (
    <ul
      aria-label="Loading task gallery"
      className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4"
      role="list"
    >
      {Array.from({ length: 6 }, (_, index) => (
        <li key={index}>
          <Skeleton className="aspect-[4/3] w-full rounded-lg" />
        </li>
      ))}
    </ul>
  );
}

export function TaskTable({
  createHref = '/dashboard/tasks/new',
  detailBasePath = '/dashboard/tasks',
  errorMessage,
  hasActiveFilters = false,
  isLoading,
  listHref = '/dashboard/tasks',
  tasks,
  view = 'table',
}: {
  createHref?: string;
  detailBasePath?: string;
  errorMessage?: string;
  hasActiveFilters?: boolean;
  isLoading?: boolean;
  listHref?: string;
  tasks: TaskResponse[];
  view?: TaskListView;
}) {
  if (errorMessage) {
    return (
      <Card>
        <CardContent className="grid gap-4">
          <p className="font-mono text-sm text-destructive" role="alert">
            {errorMessage}
          </p>
          <Button asChild className="w-fit" variant="outline">
            <Link href={normalizeBasePath(listHref) as Route}>Reload</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (isLoading) {
    // In the gallery view the loading state mirrors the cover grid (aspect-[4/3] tiles) so
    // switching views does not collapse into the table's row bars and back.
    if (view === 'gallery') {
      return <TaskGallerySkeletonGrid />;
    }

    return (
      <Card>
        <CardHeader>
          <CardTitle>Loading tasks</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (tasks.length === 0) {
    return (
      <Card className="w-full border-dashed border-border/68 bg-card/60 py-14 shadow-[var(--shadow-soft)]">
        <CardContent className="flex items-center justify-center">
          <div className="grid max-w-md gap-4 text-center">
            <div className="grid gap-2">
              <p className="font-sans text-sm font-semibold tracking-tight text-foreground">
                {hasActiveFilters ? 'No tasks match these filters' : 'No tasks yet'}
              </p>
              <p className="text-sm text-muted-foreground">
                {hasActiveFilters
                  ? 'Adjust or clear the filters to see more tasks.'
                  : 'Create a funded task to make work visible to agents.'}
              </p>
            </div>
            <div className="flex flex-col justify-center gap-2 sm:flex-row">
              {hasActiveFilters ? (
                <Button asChild variant="outline">
                  <Link href={listHref as Route}>Clear filters</Link>
                </Button>
              ) : null}
              <Button asChild>
                <Link href={createHref as Route}>Post task</Link>
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Gallery is an image-forward view for visual work: it surfaces submission previews so a
  // browser can see what was produced before opening a task. The table stays the default,
  // lightweight view (no per-row preview requests).
  if (view === 'gallery') {
    return <TaskGalleryGrid detailBasePath={detailBasePath} tasks={tasks} />;
  }

  return (
    <div className="min-w-0 max-w-full overflow-hidden rounded-lg border border-border/58 bg-card/38">
      <ul aria-label="Task cards" className="grid gap-3 p-3 md:hidden" role="list">
        {tasks.map((task) => (
          <TaskMobileCard detailBasePath={detailBasePath} key={task.id} task={task} />
        ))}
      </ul>
      <div className="hidden w-full max-w-full overflow-x-auto md:block">
        <Table className="[&_td]:py-2.5">
          <TableHeader>
            <TableRow>
              <TableHead>Task</TableHead>
              <TableHead>Mode</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Requester</TableHead>
              <TableHead>Due</TableHead>
              <TableHead className="text-right">Activity</TableHead>
              <TableHead className="text-right">Reward</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {tasks.map((task) => {
              const splitLabel = splitPayoutLabel(task);

              return (
                <TableRow key={task.id}>
                  <TableCell className="min-w-72">
                    <Link
                      className="font-medium text-foreground hover:text-primary"
                      href={
                        `${normalizeBasePath(detailBasePath)}/${encodeURIComponent(task.id)}` as Route
                      }
                    >
                      {taskTitle(task)}
                    </Link>
                    <div className="mt-2 flex flex-wrap gap-1">
                      {taskDetailTags(task)
                        .slice(0, 3)
                        .map((tag) => (
                          <Badge key={tag} variant={TASK_TAG_BADGE_VARIANT}>
                            {tag}
                          </Badge>
                        ))}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant={taskModeBadgeVariant(task.mode)}>{task.mode}</Badge>
                  </TableCell>
                  <TableCell>
                    <span className="flex flex-wrap gap-1.5">
                      <Badge variant={taskStatusBadgeVariant(task)}>
                        {taskStatusLabel(task.status)}
                      </Badge>
                      {splitLabel ? <Badge variant="outline">{splitLabel}</Badge> : null}
                    </span>
                  </TableCell>
                  <TableCell>
                    <span className="flex flex-wrap items-center gap-1.5">
                      <span
                        className="font-mono text-xs text-muted-foreground"
                        title={task.requester}
                      >
                        {compactAddress(task.requester)}
                      </span>
                      <ActorTypeBadge actorType={task.requesterActorType} />
                    </span>
                  </TableCell>
                  <TableCell>
                    <DeadlineLabel className="text-sm" task={task} />
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm text-muted-foreground">
                    {activityLabel(task)}
                  </TableCell>
                  <TableCell className="text-right">
                    <RewardAmount align="end" task={task} />
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

const actors: Array<'ALL' | 'agent' | 'human'> = ['ALL', 'agent', 'human'];

type TaskFilterControlsProps = {
  basePath?: string;
  deadlineHours?: string;
  idPrefix: string;
  maxReward?: string;
  minReward?: string;
  selectedActor?: 'ALL' | 'agent' | 'human' | string;
  selectedMode?: 'ALL' | TaskModeType | string;
  selectedSort?: string;
  selectedStatus?: 'ALL' | TaskStatusType | string;
  tags?: string;
  taskDropId?: string;
};

// Filter options are radio-group facts, not actions: quiet text rows keep the rail
// scannable and reserve the pill treatment for horizontal chip rows (sort, active
// filters). Active state is a tonal primary fill instead of a bordered button.
const FILTER_ROW_CLASS =
  'flex min-h-11 items-center rounded-md px-2 text-sm text-muted-foreground transition-colors duration-200 hover:bg-accent/10 hover:text-foreground data-[active=true]:bg-primary/10 data-[active=true]:font-medium data-[active=true]:text-primary sm:min-h-8';

// Sentence-case a labelize()d value for the rail rows ("pending approval" -> "Pending
// approval"); the old uppercase chips hid casing, quiet text rows do not.
function sentenceLabel(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function TaskFilterControls({
  basePath = '/dashboard/tasks',
  deadlineHours = '',
  idPrefix,
  maxReward = '',
  minReward = '',
  selectedActor = 'ALL',
  selectedMode = 'ALL',
  selectedSort = 'newest',
  selectedStatus = 'ALL',
  tags = '',
  taskDropId = '',
}: TaskFilterControlsProps) {
  const currentFilters: TaskSearchParams = {
    actor: selectedActor,
    deadlineHours,
    maxReward,
    minReward,
    mode: selectedMode,
    sort: selectedSort,
    status: selectedStatus,
    tags,
    taskDropId,
  };

  return (
    <div className="grid gap-4">
      <div className="grid gap-1.5">
        <p className="font-mono text-xs uppercase text-muted-foreground">Mode</p>
        <div className="grid grid-cols-1 gap-0.5">
          {modes.map((mode) => (
            <Link
              className={FILTER_ROW_CLASS}
              data-active={selectedMode === mode}
              href={taskFiltersHref(basePath, currentFilters, { mode }) as Route}
              key={mode}
            >
              {mode === 'ALL' ? 'All modes' : sentenceLabel(labelize(mode))}
            </Link>
          ))}
        </div>
      </div>
      <div className="grid gap-1.5">
        <p className="font-mono text-xs uppercase text-muted-foreground">Status</p>
        <div className="grid grid-cols-1 gap-0.5">
          {statuses.map((status) => (
            <Link
              className={FILTER_ROW_CLASS}
              data-active={selectedStatus === status}
              href={taskFiltersHref(basePath, currentFilters, { status }) as Route}
              key={status}
            >
              {status === 'ALL' ? 'All statuses' : sentenceLabel(labelize(status))}
            </Link>
          ))}
        </div>
      </div>
      <div className="grid gap-1.5">
        <p className="font-mono text-xs uppercase text-muted-foreground">Actor</p>
        <div className="grid grid-cols-1 gap-0.5">
          {actors.map((actor) => (
            <Link
              className={FILTER_ROW_CLASS}
              data-active={selectedActor === actor}
              href={taskFiltersHref(basePath, currentFilters, { actor }) as Route}
              key={actor}
            >
              {actor === 'ALL' ? 'Any' : sentenceLabel(actor)}
            </Link>
          ))}
        </div>
      </div>
      <form action={normalizeBasePath(basePath)} className="grid gap-4">
        {selectedMode !== 'ALL' ? <input name="mode" type="hidden" value={selectedMode} /> : null}
        {selectedStatus !== 'ALL' ? (
          <input name="status" type="hidden" value={selectedStatus} />
        ) : null}
        {selectedActor !== 'ALL' ? (
          <input name="actor" type="hidden" value={selectedActor} />
        ) : null}
        {selectedSort !== 'newest' ? (
          <input name="sort" type="hidden" value={selectedSort} />
        ) : null}
        <div className="grid gap-2">
          <Label htmlFor={`task-filter-${idPrefix}-task-drop`}>Task Drop ID</Label>
          <Input
            defaultValue={taskDropId}
            id={`task-filter-${idPrefix}-task-drop`}
            name="taskDropId"
            placeholder="drop_..."
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor={`task-filter-${idPrefix}-tags`}>Tags</Label>
          <Input
            defaultValue={tags}
            id={`task-filter-${idPrefix}-tags`}
            name="tags"
            placeholder="scrape, react"
          />
        </div>
        <div className="grid grid-cols-1 gap-2">
          <div className="grid gap-2">
            <Label htmlFor={`task-filter-${idPrefix}-min-reward`}>Min reward</Label>
            <Input
              defaultValue={minReward}
              id={`task-filter-${idPrefix}-min-reward`}
              min="0"
              name="minReward"
              placeholder="2.00"
              step="0.01"
              type="number"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor={`task-filter-${idPrefix}-max-reward`}>Max reward</Label>
            <Input
              defaultValue={maxReward}
              id={`task-filter-${idPrefix}-max-reward`}
              min="0"
              name="maxReward"
              placeholder="500"
              step="0.01"
              type="number"
            />
          </div>
        </div>
        <div className="grid gap-2">
          <Label htmlFor={`task-filter-${idPrefix}-deadline`}>Deadline hours</Label>
          <Input
            defaultValue={deadlineHours}
            id={`task-filter-${idPrefix}-deadline`}
            min="1"
            name="deadlineHours"
            placeholder="72"
            type="number"
          />
        </div>
        <div className="grid grid-cols-1 gap-2">
          <Button type="submit" variant="terminal">
            Apply filters
          </Button>
          <Button asChild variant="outline">
            <Link aria-label="Clear filters" href={normalizeBasePath(basePath) as Route}>
              Clear
            </Link>
          </Button>
        </div>
      </form>
    </div>
  );
}

export function TaskFilterRail(props: Omit<TaskFilterControlsProps, 'idPrefix'>) {
  return (
    <aside aria-label="Task filters" className="hidden gap-4 lg:sticky lg:top-20 lg:grid">
      <div className="grid gap-4 border-r border-border/58 pr-4 lg:max-h-[calc(100dvh-6rem)] lg:overflow-y-auto">
        <div className="border-b border-border/58 pb-3">
          <h2 className="font-sans text-sm font-semibold tracking-tight text-foreground">
            Task filters
          </h2>
        </div>
        <div>
          <TaskFilterControls {...props} idPrefix="rail" />
        </div>
      </div>
    </aside>
  );
}

function MobileTaskFilterDrawer(props: Omit<TaskFilterControlsProps, 'idPrefix'>) {
  return (
    <Drawer direction="bottom">
      <Button asChild className="min-h-11" variant="outline">
        <DrawerTrigger type="button">
          <SlidersHorizontal />
          Filters
        </DrawerTrigger>
      </Button>
      <DrawerContent aria-describedby="mobile-task-filter-description">
        <DrawerHeader>
          <DrawerTitle>Task filters</DrawerTitle>
          <DrawerDescription id="mobile-task-filter-description">
            Narrow open tasks by Task Drop, mode, status, actor, reward, and deadline.
          </DrawerDescription>
        </DrawerHeader>
        <div className="overflow-y-auto px-4 pb-4">
          <TaskFilterControls {...props} idPrefix="drawer" />
        </div>
      </DrawerContent>
    </Drawer>
  );
}

function TaskSortControl({
  basePath,
  currentFilters,
  selectedSort,
}: {
  basePath: string;
  currentFilters: TaskSearchParams;
  selectedSort: TaskSortValue;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="mr-1 font-mono text-xs uppercase text-muted-foreground">Sort</span>
      {TASK_SORT_OPTIONS.map((option) => (
        <Button asChild key={option.value} size="chip" variant="chip">
          <Link
            data-active={selectedSort === option.value}
            href={taskFiltersHref(basePath, currentFilters, { sort: option.value }) as Route}
          >
            {option.label}
          </Link>
        </Button>
      ))}
    </div>
  );
}

type TaskPaginationState = {
  currentCursor?: string;
  cursorStack?: string;
  hasMore: boolean;
  nextCursor?: string | null;
};

function parseCursorStack(value?: string) {
  return value
    ?.split(',')
    .map((cursor) => cursor.trim())
    .filter(Boolean);
}

function serializeCursorStack(cursors: string[]) {
  return cursors.length > 0 ? cursors.join(',') : undefined;
}

function TaskPaginationControl({
  basePath,
  currentFilters,
  pagination,
}: {
  basePath: string;
  currentFilters: TaskSearchParams;
  pagination?: TaskPaginationState;
}) {
  if (!pagination || (!pagination.currentCursor && !pagination.hasMore)) {
    return null;
  }

  const cursorStack = parseCursorStack(pagination.cursorStack) ?? [];
  const currentPage = cursorStack.length + (pagination.currentCursor ? 2 : 1);
  const currentHref = taskFiltersHref(basePath, currentFilters, {
    cursor: pagination.currentCursor,
    cursorStack: serializeCursorStack(cursorStack),
  });
  const previousCursor = cursorStack.at(-1);
  const previousHref = pagination.currentCursor
    ? taskFiltersHref(basePath, currentFilters, {
        cursor: previousCursor,
        cursorStack: serializeCursorStack(cursorStack.slice(0, -1)),
      })
    : undefined;
  const nextHref =
    pagination.hasMore && pagination.nextCursor
      ? taskFiltersHref(basePath, currentFilters, {
          cursor: pagination.nextCursor,
          cursorStack: serializeCursorStack(
            pagination.currentCursor ? [...cursorStack, pagination.currentCursor] : cursorStack
          ),
        })
      : undefined;

  return (
    <Pagination aria-label="Task pagination" className="justify-end">
      <PaginationContent className="flex-wrap justify-center">
        {previousHref ? (
          <PaginationItem>
            <PaginationPrevious href={previousHref} />
          </PaginationItem>
        ) : null}
        <PaginationItem>
          <PaginationLink href={currentHref} isActive size="default">
            Page {currentPage}
          </PaginationLink>
        </PaginationItem>
        {nextHref ? (
          <PaginationItem className="hidden sm:block">
            <PaginationEllipsis />
          </PaginationItem>
        ) : null}
        {nextHref ? (
          <PaginationItem>
            <PaginationNext href={nextHref} />
          </PaginationItem>
        ) : null}
      </PaginationContent>
    </Pagination>
  );
}

export function TaskListPageContent({
  activeFilters,
  basePath = '/dashboard/tasks',
  createHref = '/dashboard/tasks/new',
  detailBasePath = '/dashboard/tasks',
  errorMessage,
  filterParams,
  listHref = '/dashboard/tasks',
  pagination,
  tasks,
}: {
  activeFilters: ActiveFilter[];
  basePath?: string;
  createHref?: string;
  detailBasePath?: string;
  errorMessage?: string;
  filterParams: {
    deadlineHours?: string;
    maxReward?: string;
    minReward?: string;
    selectedActor?: string;
    selectedMode: string;
    selectedSort: TaskSortValue;
    selectedStatus: string;
    tags?: string;
    taskDropId?: string;
  };
  listHref?: string;
  pagination?: TaskPaginationState;
  tasks: TaskResponse[];
}) {
  const sortFilters: TaskSearchParams = {
    actor: filterParams.selectedActor,
    deadlineHours: filterParams.deadlineHours,
    maxReward: filterParams.maxReward,
    minReward: filterParams.minReward,
    mode: filterParams.selectedMode,
    status: filterParams.selectedStatus,
    tags: filterParams.tags,
    taskDropId: filterParams.taskDropId,
  };
  const paginationFilters: TaskSearchParams = {
    ...sortFilters,
    sort: filterParams.selectedSort,
  };

  // Reflect the active status filter so a completed/cancelled view is not mislabelled "Open tasks".
  const { selectedStatus } = filterParams;
  const heading =
    selectedStatus && selectedStatus !== 'ALL' && selectedStatus !== 'open'
      ? `${labelize(selectedStatus).replace(/^./, (char) => char.toUpperCase())} tasks`
      : 'Open tasks';

  return (
    <div className="@container/main mx-auto grid w-full max-w-[96rem] grid-cols-[minmax(0,1fr)] items-start gap-5 px-4 py-10 sm:px-6 lg:grid-cols-[210px_minmax(0,1fr)] lg:px-8 xl:grid-cols-[220px_minmax(0,1fr)]">
      <TaskFilterRail
        basePath={basePath}
        deadlineHours={filterParams.deadlineHours}
        maxReward={filterParams.maxReward}
        minReward={filterParams.minReward}
        selectedActor={filterParams.selectedActor}
        selectedMode={filterParams.selectedMode}
        selectedSort={filterParams.selectedSort}
        selectedStatus={filterParams.selectedStatus}
        tags={filterParams.tags}
        taskDropId={filterParams.taskDropId}
      />
      <section
        aria-label="Task list"
        className="grid w-full min-w-0 max-w-full gap-5 overflow-hidden"
      >
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <h1 className="font-display text-4xl font-semibold tracking-tight">{heading}</h1>
          <div className="flex flex-wrap gap-2">
            <div className="lg:hidden">
              <MobileTaskFilterDrawer
                basePath={basePath}
                deadlineHours={filterParams.deadlineHours}
                maxReward={filterParams.maxReward}
                minReward={filterParams.minReward}
                selectedActor={filterParams.selectedActor}
                selectedMode={filterParams.selectedMode}
                selectedSort={filterParams.selectedSort}
                selectedStatus={filterParams.selectedStatus}
                tags={filterParams.tags}
                taskDropId={filterParams.taskDropId}
              />
            </div>
            <Button asChild>
              <Link href={createHref as Route}>Post task</Link>
            </Button>
          </div>
        </div>
        {activeFilters.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs uppercase text-muted-foreground">
              Active filters
            </span>
            {activeFilters.map((filter) => (
              <Badge key={`${filter.label}:${filter.value}`} variant="outline">
                {filter.label}: {filter.value}
              </Badge>
            ))}
            <Button asChild size="xs" variant="link">
              <Link href={listHref as Route}>Clear filters</Link>
            </Button>
          </div>
        ) : null}
        <TaskListBoard
          createHref={createHref}
          detailBasePath={detailBasePath}
          errorMessage={errorMessage}
          hasActiveFilters={activeFilters.length > 0}
          listHref={listHref}
          tasks={tasks}
          toolbarStart={
            <TaskSortControl
              basePath={basePath}
              currentFilters={sortFilters}
              selectedSort={filterParams.selectedSort}
            />
          }
        />
        {filterParams.selectedSort === 'newest' ? (
          <TaskPaginationControl
            basePath={basePath}
            currentFilters={paginationFilters}
            pagination={pagination}
          />
        ) : null}
      </section>
    </div>
  );
}

export function CreateTaskPanel({ walletConnected }: { walletConnected: boolean }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Create task</CardTitle>
      </CardHeader>
      <CardContent>
        <form className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="task-summary">Task summary</Label>
            <Input
              id="task-summary"
              placeholder="Parse a dataset, review a PR, audit a model output"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="task-description">Description</Label>
            <Textarea
              id="task-description"
              placeholder="Define acceptance criteria, inputs, and delivery format."
            />
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="task-reward">Reward</Label>
              <Input id="task-reward" placeholder="250 USDC" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="task-mode">Mode</Label>
              <Input id="task-mode" placeholder="auction" />
            </div>
          </div>
          <Button disabled={!walletConnected} type="button">
            {walletConnected ? 'Create task' : 'Connect wallet to create'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function isMediaArtifact(artifact: ArtifactResponse) {
  return artifact.mediaKind === 'image' || artifact.mediaKind === 'video';
}

function formatArtifactBytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) {
    return '0 B';
  }

  const units = ['B', 'KB', 'MB', 'GB'];
  let size = value;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }

  const formatted =
    Number.isInteger(size) || size >= 10 || unitIndex === 0 ? size.toFixed(0) : size.toFixed(1);
  return `${formatted} ${units[unitIndex] ?? 'B'}`;
}

function ArtifactRow({ artifact, taskId }: { artifact: ArtifactResponse; taskId: string }) {
  const label = artifact.role !== 'attachment' ? artifact.role : null;
  return (
    <div className="min-w-0 rounded-lg border border-border/52 bg-muted/24 p-3 text-sm">
      <div className="grid min-w-0 gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
        <div className="grid min-w-0 gap-1.5">
          <div className="flex min-w-0 items-center gap-2">
            {label ? <Badge variant="outline">{label}</Badge> : null}
            <span className="min-w-0 truncate font-mono font-semibold" title={artifact.fileName}>
              {artifact.fileName}
            </span>
          </div>
          <span className="min-w-0 truncate text-xs text-muted-foreground">
            {artifact.mimeType}
          </span>
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-2 sm:justify-end">
          <span className="font-mono text-xs text-muted-foreground">
            {formatArtifactBytes(artifact.sizeBytes)}
          </span>
          <ArtifactPreviewButton artifact={artifact} taskId={taskId} />
        </div>
      </div>
      {artifact.textPreview ? (
        <details className="mt-2">
          <summary className="cursor-pointer select-none text-xs text-muted-foreground hover:text-foreground">
            preview
          </summary>
          <pre className="mt-1 overflow-auto rounded-lg bg-background p-2 font-mono text-xs leading-5 text-foreground">
            {artifact.textPreview}
          </pre>
        </details>
      ) : null}
    </div>
  );
}

function commandForSubmissionWorker(command: string, worker: string) {
  if (/(?:^|\s)--worker\s+0x[a-fA-F0-9]{40}(?:\s|$)/.test(command)) {
    return command.replace(/--worker\s+0x[a-fA-F0-9]{40}/, `--worker ${worker}`);
  }

  return `${command} --worker ${worker}`;
}

function actorProfileHref(profileBasePath: string, identity?: string | null) {
  return `${normalizeBasePath(profileBasePath)}/${encodeURIComponent(identity ?? '')}` as Route;
}

export function ActorLink({
  agentId,
  address,
  className,
  label,
  profileBasePath,
  title,
}: {
  agentId?: string | null;
  address?: string | null;
  className?: string;
  label?: ReactNode;
  profileBasePath: string;
  title?: string;
}) {
  const identity = agentId ?? address;
  const text = label ?? compactAddress(identity);

  if (!identity) {
    return (
      <span className={className} title={title}>
        {text}
      </span>
    );
  }

  return (
    <Link
      className={className ?? 'hover:text-primary'}
      href={actorProfileHref(profileBasePath, identity)}
      title={title}
    >
      {text}
    </Link>
  );
}

export function SubmissionCard({
  profileBasePath,
  reviewAction,
  submission,
  task,
}: {
  profileBasePath: string;
  reviewAction?: PendingAction;
  submission: SubmissionResponse;
  task: TaskDetailResponse | TaskResponse;
}) {
  const artifacts: ArtifactResponse[] = submission.artifacts ?? [];
  const mediaArtifacts = artifacts.filter(isMediaArtifact);
  const supportingArtifacts = artifacts.filter((artifact) => !isMediaArtifact(artifact));
  const worker = submission.workerAddress;
  const workerLabel = compactAddress(submission.workerAgentId ?? submission.workerAddress);
  const acceptAction = reviewAction
    ? {
        ...reviewAction,
        command: commandForSubmissionWorker(reviewAction.command, worker),
      }
    : null;
  const awardRecipient = isAwardRecipient(task, worker);

  return (
    <article
      aria-label={`Submission from ${workerLabel}`}
      className="grid min-w-0 content-start gap-4 rounded-lg border border-border/58 bg-background/34 p-3 shadow-[var(--shadow-soft)]"
    >
      <div className="grid min-w-0 gap-3">
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
          <span className="flex flex-wrap gap-1.5">
            <Badge variant="outline">{countLabel(mediaArtifacts.length, 'media artifact')}</Badge>
            {awardRecipient ? <Badge variant="success">Award recipient</Badge> : null}
          </span>
          <RelativeTime className="text-sm text-muted-foreground" value={submission.submittedAt} />
        </div>
        <div className="grid min-w-0 gap-1">
          <p className="text-xs font-semibold uppercase tracking-normal text-muted-foreground">
            Deliverable submitted by
          </p>
          <ActorLink
            address={submission.workerAddress}
            agentId={submission.workerAgentId}
            className="min-w-0 truncate font-mono text-sm hover:text-primary"
            label={workerLabel}
            profileBasePath={profileBasePath}
            title={worker}
          />
        </div>
      </div>
      {mediaArtifacts.length > 0 ? (
        <div className="grid min-w-0 gap-3 sm:grid-cols-2">
          {mediaArtifacts.map((artifact) => (
            <ArtifactMediaTile artifact={artifact} key={artifact.id} taskId={submission.taskId} />
          ))}
        </div>
      ) : null}
      {supportingArtifacts.length > 0 ? (
        <div className="grid min-w-0 gap-2">
          <p className="font-mono text-xs uppercase text-muted-foreground">Supporting artifacts</p>
          {supportingArtifacts.map((artifact) => (
            <ArtifactRow artifact={artifact} key={artifact.id} taskId={submission.taskId} />
          ))}
        </div>
      ) : null}
      {artifacts.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border/52 bg-background/30 p-4 text-sm text-muted-foreground">
          No artifacts were attached to this submission.
        </p>
      ) : null}
      {acceptAction ? <SubmissionPayoutAction action={acceptAction} task={task} /> : null}
    </article>
  );
}

export function PitchRow({
  pitch,
  profileBasePath,
}: {
  pitch: PitchResponse;
  profileBasePath: string;
}) {
  return (
    <div className="rounded-lg border border-border/52 bg-background/30 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline">{pitch.status}</Badge>
        <ActorLink
          address={pitch.workerAddress}
          agentId={pitch.workerAgentId}
          className="font-mono text-sm hover:text-primary"
          profileBasePath={profileBasePath}
        />
      </div>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">{pitch.pitchText}</p>
    </div>
  );
}

export function ProofRow({
  profileBasePath,
  proof,
  task,
}: {
  profileBasePath: string;
  proof: ProofResponse;
  task: TaskDetailResponse | TaskResponse;
}) {
  const awardRecipient = isAwardRecipient(task, proof.workerAddress);
  return (
    <div className="rounded-lg border border-border/52 bg-background/30 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline">{proof.status}</Badge>
        <Badge variant="terminal">{proof.proofType}</Badge>
        {awardRecipient ? <Badge variant="success">Award recipient</Badge> : null}
        {proof.metricValue ? <span className="font-mono text-sm">{proof.metricValue}</span> : null}
      </div>
      <ActorLink
        address={proof.workerAddress}
        agentId={proof.workerAgentId}
        className="mt-2 inline-block font-mono text-sm hover:text-primary"
        profileBasePath={profileBasePath}
      />
      <p className="mt-2 break-all text-sm leading-6 text-muted-foreground">{proof.proofData}</p>
    </div>
  );
}

export function BidRow({ bid, profileBasePath }: { bid: BidResponse; profileBasePath: string }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/52 bg-background/30 p-3 font-mono text-sm">
      <ActorLink
        address={bid.workerAddress}
        agentId={bid.workerAgentId}
        className="hover:text-primary"
        profileBasePath={profileBasePath}
      />
      <span className="text-primary">{formatUsdcUnits(bid.price)}</span>
    </div>
  );
}

export function ClaimRow({
  claim,
  profileBasePath,
}: {
  claim: ClaimResponse;
  profileBasePath: string;
}) {
  return (
    <div className="grid gap-2 rounded-lg border border-border/52 bg-background/30 p-3 font-mono text-sm">
      <div className="flex justify-between gap-3">
        <span className="text-muted-foreground">Claim worker</span>
        <ActorLink
          address={claim.workerAddress}
          className="hover:text-primary"
          profileBasePath={profileBasePath}
        />
      </div>
      <div className="flex justify-between gap-3">
        <span className="text-muted-foreground">Claim stake</span>
        <span>{formatUsdcUnits(claim.stakeAmount)}</span>
      </div>
      <div className="flex justify-between gap-3">
        <span className="text-muted-foreground">Claim status</span>
        <span>{claim.status}</span>
      </div>
    </div>
  );
}

function ModeDataPanel({
  marketStats,
  modeData,
  profileBasePath,
  reviewAction,
  task,
}: {
  marketStats?: MarketStats | null;
  modeData?: TaskModeData;
  profileBasePath: string;
  reviewAction?: PendingAction;
  task: TaskDetailResponse | TaskResponse;
}) {
  const submissions = modeData?.submissions ?? [];
  const isReviewQueue = Boolean(reviewAction && submissions.length > 0);

  return (
    <LiveActivityPanel
      initialModeData={modeData}
      isReviewQueue={isReviewQueue}
      marketStats={marketStats}
      profileBasePath={profileBasePath}
      reviewAction={reviewAction}
      task={task}
    />
  );
}

function DetailMetric({
  footerLabel,
  footerValue,
  label,
  value,
  valueCaption,
  valueClassName,
}: {
  footerLabel: string;
  footerValue: ReactNode;
  label: string;
  value: ReactNode;
  valueCaption?: ReactNode;
  valueClassName?: string;
}) {
  return (
    <article
      aria-label={`${label} summary`}
      className="min-w-0 border-t border-border/52 p-5 first:border-t-0 md:border-l md:border-t-0 md:first:border-l-0"
    >
      <p className="font-mono text-[0.68rem] uppercase text-muted-foreground">{label}</p>
      <div
        className={
          valueClassName ??
          'mt-2 truncate font-mono text-2xl font-semibold tracking-tight text-foreground md:text-3xl'
        }
      >
        {value}
      </div>
      {valueCaption ? (
        <p className="mt-1 truncate text-sm text-muted-foreground">{valueCaption}</p>
      ) : null}
      <div className="mt-4 grid gap-1 border-t border-border/52 pt-3">
        <p className="font-mono text-[0.68rem] uppercase text-muted-foreground">{footerLabel}</p>
        <div className="truncate text-sm text-muted-foreground">{footerValue}</div>
      </div>
    </article>
  );
}

function SummaryRow({
  label,
  labelTooltip,
  value,
}: {
  label: string;
  labelTooltip?: string;
  value: ReactNode;
}) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-3">
      {labelTooltip ? (
        <InfoTooltip label={labelTooltip}>
          <span className="text-muted-foreground">{label}</span>
        </InfoTooltip>
      ) : (
        <span className="text-muted-foreground">{label}</span>
      )}
      <span
        className="min-w-0 truncate text-right"
        title={typeof value === 'string' ? value : undefined}
      >
        {value}
      </span>
    </div>
  );
}

function SummaryGroup({ children, title }: { children: ReactNode; title: string }) {
  return (
    <section className="grid gap-3 border-t border-border/58 pt-4 first:border-t-0 first:pt-0">
      <h2 className="font-sans text-sm font-semibold tracking-tight text-foreground">{title}</h2>
      <div className="grid gap-2 font-mono text-sm">{children}</div>
    </section>
  );
}

function SettlementPayoutsPanel({
  profileBasePath,
  task,
}: {
  profileBasePath: string;
  task: TaskDetailResponse | TaskResponse;
}) {
  const awards = settledAwards(task);
  if (awards.length === 0) return null;
  const recipientCount = awardRecipientCount(awards);

  return (
    <section aria-label="Settlement payouts" className="grid gap-4 border-t border-border/58 pt-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-display font-semibold leading-none tracking-tight text-foreground">
          Settlement payouts
        </h2>
        {awards.length > 1 ? (
          <Badge variant="outline">
            {recipientCount === awards.length
              ? countLabel(recipientCount, 'winner')
              : `${countLabel(recipientCount, 'winner')} · ${countLabel(awards.length, 'award')}`}
          </Badge>
        ) : null}
      </div>
      <div className="divide-y divide-border/52 border-y border-border/52">
        {awards.map((award, index) => (
          <article
            className="grid gap-4 py-4 lg:grid-cols-[minmax(12rem,1fr)_minmax(20rem,1.4fr)] lg:items-center"
            key={`${award.settlementTxHash}-${award.rank}-${award.workerAddress}-${index}`}
          >
            <div className="grid min-w-0 gap-2">
              <div className="flex flex-wrap items-center gap-1.5">
                <Badge variant="terminal">Rank {award.rank}</Badge>
                {award.isPrimary ? <Badge variant="success">Primary</Badge> : null}
                <ActorTypeBadge actorType={award.workerActorType} />
              </div>
              <ActorLink
                address={award.workerAddress}
                agentId={award.workerAgentId}
                className="min-w-0 truncate font-mono text-sm hover:text-primary"
                profileBasePath={profileBasePath}
              />
              <span className="text-xs text-muted-foreground">
                Settled {formatDateTime(award.settledAt)}
              </span>
            </div>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-4">
              <div>
                <dt className="font-mono text-[0.68rem] uppercase text-muted-foreground">Gross</dt>
                <dd className="mt-1 font-mono text-foreground">
                  {formatUsdcUnits(award.grossAmount)}
                </dd>
              </div>
              <div>
                <dt className="font-mono text-[0.68rem] uppercase text-muted-foreground">Net</dt>
                <dd className="mt-1 font-mono text-foreground">
                  {formatUsdcUnits(award.workerPayment)}
                </dd>
              </div>
              <div>
                <dt className="font-mono text-[0.68rem] uppercase text-muted-foreground">Fee</dt>
                <dd className="mt-1 font-mono text-foreground">
                  {formatUsdcUnits(award.platformFee)}
                </dd>
              </div>
              <div>
                <dt className="font-mono text-[0.68rem] uppercase text-muted-foreground">Rating</dt>
                <dd className="mt-1 font-mono text-foreground">
                  {award.rating === null ? 'Pending' : `${award.rating}/100`}
                </dd>
              </div>
              <div className="col-span-2 sm:col-span-4">
                <a
                  className="font-mono text-xs text-muted-foreground underline-offset-4 hover:text-primary hover:underline"
                  href={explorerTxUrl(award.settlementTxHash) ?? undefined}
                  rel="noreferrer"
                  target="_blank"
                >
                  Settlement tx {compactAddress(award.settlementTxHash)}
                </a>
              </div>
            </dl>
          </article>
        ))}
      </div>
    </section>
  );
}

function requirementRows(task: TaskDetailResponse | TaskResponse) {
  const rows: Array<{ label: string; labelTooltip?: string; value: ReactNode }> = [];

  if (task.mode === 'auction') {
    rows.push({
      label: 'Auction flow',
      value:
        task.auctionType === 'dutch' || task.auctionType === 'reverse_dutch'
          ? 'Workers can accept the current clock price before the task is due.'
          : 'Workers submit bids for requester review before payout is released.',
    });
  }

  if (task.mode === 'pitch') {
    rows.push({
      label: 'Selection',
      value: 'Workers submit pitches. The requester selects one before work continues.',
    });
  }

  if (task.mode === 'benchmark') {
    if (task.metricDescription) {
      rows.push({ label: 'Metric', value: task.metricDescription });
    }
    if (task.metricTarget) {
      rows.push({ label: 'Target', value: task.metricTarget });
    }
  }

  if (task.stakeRequired || task.stakeBps > 0) {
    rows.push({
      label: 'Stake',
      labelTooltip:
        'Refundable deposit a worker locks up to take the task and gets back on successful delivery.',
      value: `${formatBps(task.stakeBps)} of reward`,
    });
  }

  if (rows.length === 0) {
    rows.push({
      label: 'Delivery',
      value:
        task.mode === 'claim'
          ? 'Claim first, then submit the deliverable.'
          : 'Submit work before expiry for requester review.',
    });
  }

  return rows;
}

function WorkRequirementsPanel({ task }: { task: TaskDetailResponse | TaskResponse }) {
  const rows = requirementRows(task);

  return (
    <section className="grid gap-4 border-t border-border/58 pt-5">
      <h2 className="font-display font-semibold leading-none tracking-tight text-foreground">
        Work requirements
      </h2>
      <div className="divide-y divide-border/52 border-y border-border/52">
        {rows.map((row) => (
          <div className="grid gap-1 py-3" key={row.label}>
            {row.labelTooltip ? (
              <InfoTooltip label={row.labelTooltip}>
                <p className="font-mono text-[0.68rem] uppercase text-muted-foreground">
                  {row.label}
                </p>
              </InfoTooltip>
            ) : (
              <p className="font-mono text-[0.68rem] uppercase text-muted-foreground">
                {row.label}
              </p>
            )}
            <div className="text-sm leading-6 text-foreground">{row.value}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

function TaskSummaryRail({
  profileBasePath,
  task,
}: {
  profileBasePath: string;
  task: TaskDetailResponse | TaskResponse;
}) {
  // Only the static price anchors live in the reference rail. The live clock price /
  // lowest bid are shown in the headline metric and the action button, which poll live,
  // so duplicating an SSR snapshot here would risk a stale, contradicting value.
  const showAuctionPricing = Boolean(
    task.maxPrice || task.auctionStartPrice || task.auctionFloorPrice
  );
  const awards = settledAwards(task);
  const awardCount = resolvedAwardCount(task);
  const winnerCount = awards.length > 0 ? awardRecipientCount(awards) : awardCount;
  const primaryAward = awards.find((award) => award.isPrimary);

  return (
    <div className="w-full border-l border-border/58 pl-5">
      <h2 className="font-display font-semibold leading-none tracking-tight text-foreground">
        Task reference
      </h2>
      <div className="mt-5 grid gap-5">
        <SummaryGroup title="Requester">
          <SummaryRow
            label="Wallet"
            value={
              <ActorLink
                address={task.requester}
                agentId={task.requesterAgentId}
                className="min-w-0 truncate hover:text-primary"
                profileBasePath={profileBasePath}
              />
            }
          />
          {task.selfAward ? (
            <SummaryRow
              label="Flag"
              value={
                <Badge variant="destructive" className="text-xs">
                  Self-award
                </Badge>
              }
            />
          ) : null}
        </SummaryGroup>

        <SummaryGroup title="Settlement">
          <SummaryRow label="Task ID" value={compactAddress(task.id)} />
          <SummaryRow
            label="Escrow tx"
            labelTooltip="On-chain transaction that locked the reward in escrow until the work is accepted."
            value={compactAddress(task.escrowTxHash)}
          />
          <SummaryRow
            label="Platform fee"
            labelTooltip="Share of the reward kept by Taskmarket when the task settles."
            value={formatBps(task.platformFeeBps)}
          />
        </SummaryGroup>

        {showAuctionPricing ? (
          <SummaryGroup title="Auction pricing">
            {task.maxPrice ? (
              <SummaryRow label="Max price" value={formatUsdcUnits(task.maxPrice)} />
            ) : null}
            {task.auctionStartPrice ? (
              <SummaryRow label="Start price" value={formatUsdcUnits(task.auctionStartPrice)} />
            ) : null}
            {task.auctionFloorPrice ? (
              <SummaryRow label="Floor price" value={formatUsdcUnits(task.auctionFloorPrice)} />
            ) : null}
          </SummaryGroup>
        ) : null}

        <SummaryGroup title="History">
          <SummaryRow label="Created" value={formatDateTime(task.createdAt)} />
          {task.claimedAt ? (
            <SummaryRow label="Claimed" value={formatDateTime(task.claimedAt)} />
          ) : null}
          {task.auctionPriceReachesFloorAt ? (
            <SummaryRow
              label="Floor reached"
              value={formatDateTime(task.auctionPriceReachesFloorAt)}
            />
          ) : null}
          {task.auctionPriceReachesMaxAt ? (
            <SummaryRow label="Max reached" value={formatDateTime(task.auctionPriceReachesMaxAt)} />
          ) : null}
        </SummaryGroup>

        {awardCount > 1 ? (
          <SummaryGroup title="Winners">
            <SummaryRow label="Recipients" value={countLabel(winnerCount, 'winner')} />
            <SummaryRow
              label="Primary"
              value={
                <ActorLink
                  address={primaryAward?.workerAddress ?? task.claimedBy}
                  agentId={primaryAward?.workerAgentId ?? task.workerAgentId}
                  className="min-w-0 truncate hover:text-primary"
                  profileBasePath={profileBasePath}
                />
              }
            />
          </SummaryGroup>
        ) : task.primaryAward?.workerAddress || task.claimedBy ? (
          <SummaryGroup title="Assignment">
            <SummaryRow
              label="Worker"
              value={
                <span className="flex items-center gap-1.5">
                  <ActorLink
                    address={task.primaryAward?.workerAddress ?? task.claimedBy}
                    agentId={task.workerAgentId}
                    className="min-w-0 truncate hover:text-primary"
                    profileBasePath={profileBasePath}
                  />
                  {task.workerActorType === 'human' ? (
                    <Badge variant="outline" title="Registered as a human via the web app">
                      human
                    </Badge>
                  ) : null}
                </span>
              }
            />
          </SummaryGroup>
        ) : null}
      </div>
    </div>
  );
}

// Renders the task brief legibly: a normal-case one-line summary on top, then the full
// spec broken into collapsible sections when the author used ALL-CAPS headers. For plain
// prose (no detected headers and no shouting) it falls back to the original pre-wrapped
// paragraph so nothing is restructured spuriously.
function TaskBrief({ body }: { body: string }) {
  const sections = parseBriefSections(body);
  const hasHeadings = sections.some((section) => section.heading);
  const summary = briefSummary(body);

  // No structure detected: keep the original single-paragraph rendering verbatim.
  if (!hasHeadings) {
    return (
      <p className="min-w-0 whitespace-pre-wrap [overflow-wrap:anywhere] text-sm leading-6 text-muted-foreground">
        {softenShout(body)}
      </p>
    );
  }

  return (
    <div className="grid min-w-0 gap-4 [overflow-wrap:anywhere]">
      {summary ? <p className="text-sm font-medium leading-6 text-foreground">{summary}</p> : null}
      <div className="grid gap-2">
        {sections.map((section, index) =>
          section.heading ? (
            // Sections open by default so the full spec is never hidden behind a click,
            // but stay collapsible so a long brief can be folded once scanned.
            <details
              className="group rounded-lg border border-border/52 bg-muted/16 p-3"
              key={`${section.heading}-${index}`}
              open
            >
              <summary className="cursor-pointer select-none font-mono text-[0.68rem] uppercase tracking-wide text-muted-foreground hover:text-foreground">
                {section.heading}
              </summary>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-foreground">
                {softenShout(section.body).trim()}
              </p>
            </details>
          ) : section.body.trim() ? (
            <p
              className="whitespace-pre-wrap text-sm leading-6 text-muted-foreground"
              key={`intro-${index}`}
            >
              {softenShout(section.body).trim()}
            </p>
          ) : null
        )}
      </div>
    </div>
  );
}

export function TaskDetailPanel({
  backHref = '/dashboard/tasks',
  marketStats,
  modeData,
  profileBasePath = '/dashboard/agents',
  task,
}: {
  backHref?: string;
  marketStats?: MarketStats | null;
  modeData?: TaskModeData;
  profileBasePath?: string;
  task: TaskDetailResponse | TaskResponse;
}) {
  const listBase = normalizeBasePath(backHref);
  const isDashboardSurface = listBase.startsWith('/dashboard');
  const taskTypesHref = isDashboardSurface ? ('/dashboard/task-types' as Route) : null;
  const modeHref = taskFiltersHref(listBase, { mode: task.mode }) as Route;
  const pendingActions = task.pendingActions ?? [];
  // Route the accept action to per-submission cards only when submissions are
  // already loaded. When modeData has no submissions yet, keep accept in
  // nextActions so it renders in the actions card (avoids a command disappearing
  // on first render before modeData fetches).
  const loadedSubmissions = modeData?.submissions ?? [];
  const reviewAction =
    loadedSubmissions.length > 0
      ? pendingActions.find((action) => action.action === 'accept' && action.role === 'requester')
      : undefined;
  const nextActions = reviewAction
    ? pendingActions.filter((action) => action !== reviewAction)
    : pendingActions;
  const cancelActions = nextActions.filter((action) => action.action === 'cancel');
  const mainNextActions = nextActions.filter((action) => action.action !== 'cancel');
  const showNextActions =
    mainNextActions.length > 0 || (!reviewAction && cancelActions.length === 0);
  const descriptionBody = taskBody(task);
  const detailTags = taskDetailTags(task);
  const taskActivityTitle = activityTitle(task);
  // A finished task's rating is its headline outcome, so surface it in the metric instead of
  // the activity count (and drop the duplicate sidebar Outcome row).
  const rated = task.primaryAward?.rating != null;
  const splitRatingProgress = ratingProgress(task);

  return (
    <div className="grid w-full min-w-0 gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
      <PublishedCelebration />
      <div className="block w-full min-w-0 space-y-5">
        <Breadcrumb className="px-1">
          <BreadcrumbList className="font-mono text-xs uppercase">
            <BreadcrumbItem>
              <BreadcrumbLink asChild>
                <Link href={backHref as Route}>Tasks</Link>
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem className="min-w-0">
              <BreadcrumbPage className="max-w-[min(72vw,42rem)] truncate font-sans text-sm normal-case">
                {taskTitle(task)}
              </BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
        <LiveStatusBanner marketStats={marketStats} modeData={modeData} task={task} />
        <section
          aria-label="Task metrics"
          className="grid overflow-hidden rounded-lg border border-border/58 bg-card/38 md:grid-cols-2"
        >
          <DetailMetric
            footerLabel="Due"
            footerValue={<DeadlineLabel task={task} />}
            label="Reward"
            value={<span className="text-primary">{formatUsdcUnits(taskDisplayReward(task))}</span>}
            valueCaption={
              [auctionPriceCaption(task), dreamsBonusCaption(task)].filter(Boolean).join(' · ') ||
              null
            }
          />
          <DetailMetric
            footerLabel={splitRatingProgress ? 'Ratings' : rated ? 'Rating' : taskActivityTitle}
            footerValue={
              splitRatingProgress
                ? splitRatingProgress
                : rated
                  ? `${task.primaryAward?.rating}/100`
                  : activityLabel(task, modeData)
            }
            label="Status"
            value={
              <InfoTooltip label={STATUS_CONFIG[task.status]?.description ?? statusContext(task)}>
                <Badge className="px-3.5 py-1.5 text-base" variant={taskStatusBadgeVariant(task)}>
                  {taskStatusLabel(task.status)}
                </Badge>
              </InfoTooltip>
            }
            valueCaption={statusContext(task)}
            valueClassName="mt-2 flex min-w-0 items-center"
          />
        </section>
        <SettlementPayoutsPanel profileBasePath={profileBasePath} task={task} />
        <section className="grid gap-3 border-t border-border/58 pt-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <InfoTooltip label={MODE_TOOLTIPS[task.mode]}>
                <Link href={modeHref}>
                  <Badge className="hover:opacity-80" variant={taskModeBadgeVariant(task.mode)}>
                    {task.mode}
                  </Badge>
                </Link>
              </InfoTooltip>
              {task.auctionType ? (
                <Badge variant="terminal">{labelize(task.auctionType)} auction</Badge>
              ) : null}
              {task.taskDrop ? (
                <Link href={`/drops/${task.taskDrop.id}` as Route}>
                  <Badge className="hover:opacity-80" variant="outline">
                    {task.taskDrop.name}
                  </Badge>
                </Link>
              ) : null}
              {task.taskVisibility === 'unlisted' ? <UnlistedBadge withTooltip /> : null}
              <PhaseBadge status={task.status} />
              {taskTypesHref ? (
                <Link
                  className="font-mono text-xs uppercase text-muted-foreground hover:text-primary"
                  href={taskTypesHref}
                >
                  How this works
                </Link>
              ) : null}
            </div>
            {/* Copy-for-agent: hand the whole brief to an operator/LLM without scraping the page. */}
            <div className="flex items-center gap-1.5">
              <span className="font-mono text-[0.65rem] uppercase text-muted-foreground">
                Copy for agent
              </span>
              <CopyButton label="Copy as JSON" text={taskToAgentJson(task, modeData)} />
              <CopyButton label="Copy as markdown" text={taskToMarkdown(task)} />
            </div>
          </div>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-foreground">
            {taskTitle(task)}
          </h1>
        </section>
        {reviewAction ? (
          <ModeDataPanel
            marketStats={marketStats}
            modeData={modeData}
            profileBasePath={profileBasePath}
            reviewAction={reviewAction}
            task={task}
          />
        ) : null}
        <WorkRequirementsPanel task={task} />
        {showNextActions ? (
          <TaskActionsPanel
            claimedBy={task.claimedBy}
            emptyReason={pendingActionEmptyReason(task)}
            pendingActions={mainNextActions}
            requester={task.requester}
            task={task}
            worker={task.primaryAward?.workerAddress}
          />
        ) : null}
        {cancelActions.length > 0 ? (
          <TaskActionsPanel
            claimedBy={task.claimedBy}
            emptyReason={pendingActionEmptyReason(task)}
            hideWhenNoVisibleActions
            pendingActions={cancelActions}
            requester={task.requester}
            task={task}
            title="Task controls"
            worker={task.primaryAward?.workerAddress}
          />
        ) : null}
        {descriptionBody || detailTags.length > 0 ? (
          <section className="grid gap-5 border-t border-border/58 pt-5">
            <h2 className="font-display font-semibold leading-none tracking-tight text-foreground">
              Details
            </h2>
            {descriptionBody ? <TaskBrief body={descriptionBody} /> : null}
            {detailTags.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {detailTags.map((tag) => (
                  <Link href={taskFiltersHref(listBase, { tags: tag }) as Route} key={tag}>
                    <Badge className="hover:opacity-80" variant={TASK_TAG_BADGE_VARIANT}>
                      {tag}
                    </Badge>
                  </Link>
                ))}
              </div>
            ) : null}
          </section>
        ) : null}
        {!reviewAction ? (
          <ModeDataPanel
            marketStats={marketStats}
            modeData={modeData}
            profileBasePath={profileBasePath}
            task={task}
          />
        ) : null}
      </div>
      <aside aria-label="Task sidebar" className="grid h-fit gap-6 lg:sticky lg:top-20">
        <TaskSummaryRail profileBasePath={profileBasePath} task={task} />
      </aside>
    </div>
  );
}

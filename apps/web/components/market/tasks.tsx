import type {
  ArtifactResponse,
  BidResponse,
  ClaimResponse,
  PendingAction,
  PitchResponse,
  ProofResponse,
  SubmissionResponse,
  TaskAward,
  TaskActionIntentValue,
  TaskDetailResponse,
  TaskModeType,
  TaskResponse,
  TaskStatusType,
} from '@taskmarket/shared';
import { formatDreams, getAgentName } from '@taskmarket/shared';
import {
  ArrowUpDown,
  Check,
  ChevronDown,
  ExternalLinkIcon,
  FileIcon,
  FileJsonIcon,
  FileTextIcon,
  Filter,
  FilterX,
  Plus,
  SlidersHorizontal,
} from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { SubmissionPayoutAction } from '@/components/market/actions/submission-payout-action';
import {
  ArtifactMediaHero,
  ArtifactMediaThumb,
  ArtifactPreviewButton,
} from '@/components/market/artifact-preview-button';
import { CopyButton } from '@/components/market/copy-button';
import { DreamsRewardDisclosure } from '@/components/market/dreams-reward-disclosure';
import { InfoTooltip } from '@/components/market/info-tooltip';
import { LiveActivityPanel } from '@/components/market/live-activity';
import { CountdownTimer } from '@/components/market/motion/countdown-timer';
import { RelativeTime } from '@/components/market/motion/relative-time';
import { LiveStatusBanner } from './tasks/live-status-banner';
import { PublishedCelebration } from '@/components/market/tasks/published-celebration';
import { TaskActionsPanel } from '@/components/market/task-actions-panel';
import { TaskParticipationModule } from '@/components/market/task-participation-module';
import { TaskDescriptionDisclosure } from '@/components/market/task-description-disclosure';
import { TaskReviewStatus } from '@/components/market/task-review-status';
import { TaskVisibilityBadge } from '@/components/market/unlisted-badge';
import { VerdictEvidencePanel } from '@/components/market/verdict-evidence-panel';
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
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from '@/components/ui/drawer';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
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
import { TaskListBoard, TaskViewToggle } from '@/components/market/task-thumbnail';
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
import { TASK_ACTION_PRESENTATION } from '@/lib/market/task-action-presentation';
import { MODE_TOOLTIPS } from '@/lib/market/status-config';
import {
  TASK_TAG_BADGE_VARIANT,
  resolvedAwardCount,
  settledAwards,
  splitPayoutLabel,
  taskRatingProgress,
  taskModeBadgeVariant,
  taskStatusBadgeVariant,
  taskStatusLabel,
} from '@/lib/market/task-badges';
import { isPlayableArtifact } from '@/lib/market/task-cover';
import { taskToAgentJson, taskToMarkdown } from '@/lib/market/task-export';
import { TASK_SORT_OPTIONS, normalizeBasePath, taskFiltersHref } from '@/lib/market/task-filters';
import { taskFullTitle, taskTitle } from '@/lib/market/task-title';
import { commandForTaskWorker } from '@/lib/market/task-action-command';
import type {
  ActiveFilter,
  TaskListView,
  TaskSearchParams,
  TaskSortValue,
} from '@/lib/market/task-filters';

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

const PARTICIPATION_ACTIONS = new Set<PendingAction['action']>([
  'auction_accept',
  'bid',
  'claim',
  'pitch',
  'submit_proof',
]);

function findParticipationAction(actions: PendingAction[]) {
  return (
    actions.find((action) => action.action === 'submit') ??
    actions.find(
      (action) => action.role !== 'requester' && PARTICIPATION_ACTIONS.has(action.action)
    )
  );
}

export type TaskModeData = {
  bids?: BidResponse[];
  claim?: ClaimResponse | null;
  pitches?: PitchResponse[];
  proofs?: ProofResponse[];
  submissions?: SubmissionResponse[];
};

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
function dreamsBonusSummary(
  task: TaskDetailResponse | TaskResponse
): { caption?: string; value: string } | null {
  const usdBonus =
    'estimatedWorkerUsdBonusValue' in task ? task.estimatedWorkerUsdBonusValue : undefined;
  const dreamsBonus =
    'estimatedWorkerDreamsBonus' in task ? task.estimatedWorkerDreamsBonus : undefined;
  if (!dreamsBonus || dreamsBonus === '0') {
    return null;
  }
  return {
    caption:
      usdBonus && usdBonus !== '0' ? `Approximately ${formatUsdcUnits(usdBonus)}` : undefined,
    value: `+${formatDreams(dreamsBonus)} DREAMS`,
  };
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

function awardRecipientCount(awards: TaskAward[]): number {
  return new Set(awards.map((award) => award.workerAddress.toLowerCase())).size;
}

function isAwardRecipient(task: TaskDetailResponse | TaskResponse, address: string): boolean {
  return settledAwards(task).some(
    (award) => award.workerAddress.toLowerCase() === address.toLowerCase()
  );
}

function ratingProgressLabel(task: TaskDetailResponse | TaskResponse): string | null {
  const progress = taskRatingProgress(task);
  return progress ? `${progress.rated} of ${progress.total} rated` : null;
}

// Whether an 'open' task's submission window has already closed (deadline passed but
// status has not transitioned, since expiry only flips status via an explicit on-chain
// action or an indexer-observed event -- see docs/adr/0007). Shared by statusContext,
// statusDescription, and taskEffectivePhase's callers so every surface on the detail
// page agrees on when this task stopped accepting new work.
function isOpenWindowClosed(task: TaskDetailResponse | TaskResponse): boolean {
  const expiry = new Date(task.expiryTime);
  return task.status === 'open' && Number.isFinite(expiry.getTime()) && expiry < new Date();
}

function statusContext(task: TaskDetailResponse | TaskResponse) {
  if (isOpenWindowClosed(task)) {
    if ((task.mode === 'bounty' || task.mode === 'benchmark') && task.submissionCount > 0) {
      return `Reviewing ${countLabel(task.submissionCount, 'submission')}`;
    }
    if (task.mode === 'pitch' && task.pitchCount > 0) {
      return `Reviewing ${countLabel(task.pitchCount, 'pitch', 'pitches')}`;
    }
    return 'Expired - no submissions';
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
        ratingProgressLabel(task) ??
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
  if (isOpenWindowClosed(task)) {
    return 'This task has passed its expiry time, so no open commands are available.';
  }

  switch (task.status) {
    case 'completed':
      return (
        ratingProgressLabel(task) ??
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

  return (
    <li>
      <Link
        className="group grid min-h-36 grid-rows-[auto_1fr_auto] gap-2 overflow-hidden rounded-lg border border-border/58 bg-background/38 p-3 transition-colors hover:border-primary/40 hover:bg-primary/[0.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
        href={detailHref as Route}
        prefetch={false}
      >
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <div className="flex min-w-0 items-center gap-1.5">
            <Badge variant={taskModeBadgeVariant(task.mode)}>{task.mode}</Badge>
            <Badge variant={taskStatusBadgeVariant(task)}>{taskStatusLabel(task.status)}</Badge>
          </div>
          <span className="ml-auto shrink-0 font-mono text-xs text-muted-foreground">
            {activityLabel(task)}
          </span>
        </div>
        <span className="line-clamp-2 min-w-0 text-sm font-semibold leading-5 text-foreground group-hover:text-primary">
          {taskTitle(task)}
        </span>
        <div className="flex min-w-0 items-end justify-between gap-3">
          <dl className="flex min-w-0 items-end gap-4 text-xs">
            <div className="min-w-0">
              <dt className="font-mono text-[0.65rem] uppercase text-muted-foreground">Reward</dt>
              <dd className="mt-1">
                <RewardAmount task={task} />
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="font-mono text-[0.65rem] uppercase text-muted-foreground">Due</dt>
              <dd className="mt-1 max-w-28 truncate text-muted-foreground">
                <DeadlineLabel className="text-xs" task={task} />
              </dd>
            </div>
          </dl>
          <span className="shrink-0 text-xs font-medium text-primary">View task</span>
        </div>
      </Link>
    </li>
  );
}

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
// Mobile-only feed rhythm shared by the gallery grid and its loading skeleton: full-bleed
// (cancel the page's px-4 gutter, restored at sm+), one card per screen (snap-y/snap-start),
// and a taller cover (see components/market/task-cover.tsx's aspect-[4/5] sm:aspect-[4/3]).
// The sm+ multi-column grid keeps its original, unsnapped, gutter-respecting layout.
const TASK_GALLERY_GRID_CLASS =
  'grid grid-cols-1 -mx-4 snap-y snap-mandatory gap-3 sm:mx-0 sm:grid-cols-2 sm:snap-none lg:grid-cols-3 2xl:grid-cols-4';
const TASK_GALLERY_ITEM_CLASS = 'snap-start sm:snap-align-none';

function TaskGalleryCard({ detailBasePath, task }: { detailBasePath: string; task: TaskResponse }) {
  const detailHref = `${normalizeBasePath(detailBasePath)}/${encodeURIComponent(task.id)}`;

  return (
    <li className={TASK_GALLERY_ITEM_CLASS}>
      <Link
        className="group block rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
        href={detailHref as Route}
        prefetch={false}
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
      className={TASK_GALLERY_GRID_CLASS}
      data-testid="task-gallery"
      role="list"
    >
      {tasks.map((task) => (
        <TaskGalleryCard detailBasePath={detailBasePath} key={task.id} task={task} />
      ))}
    </ul>
  );
}

// Gallery loading state: a grid of cover-shaped skeletons matching TaskCover's aspect ratio
// and the mobile full-bleed/snap rhythm, so a switch to the gallery view (or its initial
// load) does not collapse into the lightweight table-row bars or jump once real covers land.
function TaskGallerySkeletonGrid() {
  return (
    <ul aria-label="Loading task gallery" className={TASK_GALLERY_GRID_CLASS} role="list">
      {Array.from({ length: 6 }, (_, index) => (
        <li className={TASK_GALLERY_ITEM_CLASS} key={index}>
          <Skeleton className="aspect-[4/5] w-full rounded-lg sm:aspect-[4/3]" />
        </li>
      ))}
    </ul>
  );
}

export function TaskTable({
  contained = false,
  createHref = '/dashboard/tasks/new',
  detailBasePath = '/dashboard/tasks',
  errorMessage,
  hasActiveFilters = false,
  isLoading,
  listHref = '/dashboard/tasks',
  tasks,
  view = 'table',
}: {
  contained?: boolean;
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
      <Card className={contained ? 'rounded-none border-0 bg-transparent shadow-none' : undefined}>
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
      return (
        <div className={contained ? 'p-3 sm:p-4' : undefined}>
          <TaskGallerySkeletonGrid />
        </div>
      );
    }

    return (
      <Card className={contained ? 'rounded-none border-0 bg-transparent shadow-none' : undefined}>
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
      <Card
        className={
          contained
            ? 'w-full rounded-none border-0 bg-transparent py-14 shadow-none'
            : 'w-full border-dashed border-border/68 bg-card/60 py-14 shadow-[var(--shadow-soft)]'
        }
      >
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
    return (
      <div className={contained ? 'p-3 sm:p-4' : undefined}>
        <TaskGalleryGrid detailBasePath={detailBasePath} tasks={tasks} />
      </div>
    );
  }

  return (
    <div
      className={
        contained
          ? 'min-w-0 max-w-full overflow-hidden'
          : 'min-w-0 max-w-full overflow-hidden md:rounded-lg md:border md:border-border/58 md:bg-card/38'
      }
    >
      <ul
        aria-label="Task cards"
        className={`grid gap-2 md:hidden ${contained ? 'p-3' : ''}`}
        role="list"
      >
        {tasks.map((task) => (
          <TaskMobileCard detailBasePath={detailBasePath} key={task.id} task={task} />
        ))}
      </ul>
      <div className="hidden w-full max-w-full overflow-x-auto md:block">
        <Table className="min-w-[64rem] table-fixed [&_td]:py-2.5">
          <TableHeader>
            <TableRow>
              <TableHead>Task</TableHead>
              <TableHead className="w-24">Mode</TableHead>
              <TableHead className="w-28">Status</TableHead>
              <TableHead className="w-40">Requester</TableHead>
              <TableHead className="w-28">Due</TableHead>
              <TableHead className="w-36 text-right">Activity</TableHead>
              <TableHead className="w-24 text-right">Reward</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {tasks.map((task) => {
              const splitLabel = splitPayoutLabel(task);

              return (
                <TableRow key={task.id}>
                  <TableCell className="max-w-0">
                    <Link
                      className="block truncate font-medium text-foreground hover:text-primary"
                      href={
                        `${normalizeBasePath(detailBasePath)}/${encodeURIComponent(task.id)}` as Route
                      }
                      prefetch={false}
                      title={taskFullTitle(task)}
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
  maxReward?: string;
  minReward?: string;
  selectedActor?: 'ALL' | 'agent' | 'human' | string;
  selectedMode?: 'ALL' | TaskModeType | string;
  selectedSort?: string;
  selectedStatus?: 'ALL' | TaskStatusType | string;
  selectedView?: TaskListView;
  tags?: string;
  taskDropId?: string;
  requester?: string;
  worker?: string;
};

// Sentence-case a labelize()d value for compact filter labels ("pending approval" ->
// "Pending approval").
function sentenceLabel(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function TaskFilterHiddenInputs({
  requester,
  selectedActor,
  selectedMode,
  selectedSort,
  selectedStatus,
  selectedView,
  worker,
}: Pick<
  TaskFilterControlsProps,
  | 'requester'
  | 'selectedActor'
  | 'selectedMode'
  | 'selectedSort'
  | 'selectedStatus'
  | 'selectedView'
  | 'worker'
>) {
  return (
    <>
      {selectedMode !== 'ALL' ? <input name="mode" type="hidden" value={selectedMode} /> : null}
      {selectedStatus !== 'ALL' ? (
        <input name="status" type="hidden" value={selectedStatus} />
      ) : null}
      {selectedActor !== 'ALL' ? <input name="actor" type="hidden" value={selectedActor} /> : null}
      {selectedSort !== 'newest' ? <input name="sort" type="hidden" value={selectedSort} /> : null}
      {selectedView === 'gallery' ? <input name="view" type="hidden" value={selectedView} /> : null}
      {requester ? <input name="requester" type="hidden" value={requester} /> : null}
      {worker ? <input name="worker" type="hidden" value={worker} /> : null}
    </>
  );
}

function TaskAdvancedFilterFields({
  compact = false,
  deadlineHours,
  horizontal = false,
  idPrefix,
  maxReward,
  minReward,
  tags,
  taskDropId,
}: Pick<
  TaskFilterControlsProps,
  'deadlineHours' | 'maxReward' | 'minReward' | 'tags' | 'taskDropId'
> & {
  compact?: boolean;
  horizontal?: boolean;
  idPrefix: string;
}) {
  const inputClassName = compact ? 'h-11 md:h-11' : undefined;

  return (
    <div
      className={
        horizontal
          ? 'grid gap-3 md:grid-cols-2 xl:grid-cols-[minmax(9rem,1.15fr)_minmax(9rem,1.15fr)_minmax(7rem,0.8fr)_minmax(7rem,0.8fr)_minmax(8rem,0.85fr)]'
          : 'grid gap-4'
      }
    >
      <div className="grid gap-2">
        <Label htmlFor={`task-filter-${idPrefix}-task-drop`}>Task Drop ID</Label>
        <Input
          className={inputClassName}
          defaultValue={taskDropId}
          id={`task-filter-${idPrefix}-task-drop`}
          name="taskDropId"
          placeholder="drop_..."
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor={`task-filter-${idPrefix}-tags`}>Tags</Label>
        <Input
          className={inputClassName}
          defaultValue={tags}
          id={`task-filter-${idPrefix}-tags`}
          name="tags"
          placeholder="scrape, react"
        />
      </div>
      <div
        className={`grid gap-3 ${compact ? 'grid-cols-2' : 'grid-cols-1'} ${
          horizontal ? 'md:col-span-2 md:grid-cols-2 xl:contents' : ''
        }`}
      >
        <div className="grid gap-2">
          <Label htmlFor={`task-filter-${idPrefix}-min-reward`}>Min reward</Label>
          <Input
            className={inputClassName}
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
            className={inputClassName}
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
          className={inputClassName}
          defaultValue={deadlineHours}
          id={`task-filter-${idPrefix}-deadline`}
          min="1"
          name="deadlineHours"
          placeholder="72"
          type="number"
        />
      </div>
    </div>
  );
}

function TaskBrowseDropdown({
  basePath,
  currentFilters,
  filterKey,
  label,
  mobile = false,
  options,
  selectedValue,
}: {
  basePath: string;
  currentFilters: TaskSearchParams;
  filterKey: 'actor' | 'mode' | 'sort' | 'status';
  label: string;
  mobile?: boolean;
  options: Array<{ label: string; value: string }>;
  selectedValue: string;
}) {
  const selectedOption = options.find((option) => option.value === selectedValue) ?? options[0];

  return (
    <DropdownMenu modal={false}>
      <Button
        asChild
        className={
          mobile
            ? 'h-11 min-h-11 w-full justify-between px-3 sm:h-11 sm:min-h-11'
            : 'min-w-32 justify-between px-3'
        }
        size="sm"
        variant="outline"
      >
        <DropdownMenuTrigger aria-label={`${label}: ${selectedOption?.label ?? selectedValue}`}>
          <span className="font-mono text-[0.65rem] uppercase text-muted-foreground">{label}</span>
          <span className="min-w-0 truncate">{selectedOption?.label ?? selectedValue}</span>
          <ChevronDown aria-hidden="true" className="size-3.5 text-muted-foreground" />
        </DropdownMenuTrigger>
      </Button>
      <DropdownMenuContent align="start" className={mobile ? 'min-w-56' : 'min-w-48'}>
        {options.map((option) => {
          const active = selectedValue === option.value;

          return (
            <DropdownMenuItem
              asChild
              className={mobile ? 'min-h-11 cursor-pointer' : 'min-h-9 cursor-pointer'}
              key={option.value}
            >
              <Link
                aria-current={active ? 'page' : undefined}
                href={
                  taskFiltersHref(basePath, currentFilters, {
                    cursor: undefined,
                    cursorStack: undefined,
                    [filterKey]: option.value,
                  }) as Route
                }
              >
                <span className="flex-1">{option.label}</span>
                {active ? <Check aria-hidden="true" className="size-4 text-primary" /> : null}
              </Link>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const MOBILE_CONTROL_CLASS = 'h-11 min-h-11 sm:h-11 sm:min-h-11';

function MobileTaskFilterDrawer({
  activeFilterCount,
  hasMoreResults,
  resultCount,
  ...props
}: TaskFilterControlsProps & {
  activeFilterCount: number;
  hasMoreResults: boolean;
  resultCount: number;
}) {
  const {
    basePath = '/dashboard/tasks',
    deadlineHours = '',
    maxReward = '',
    minReward = '',
    selectedActor = 'ALL',
    selectedMode = 'ALL',
    selectedSort = 'newest',
    selectedStatus = 'ALL',
    selectedView,
    tags = '',
    taskDropId = '',
    requester = '',
    worker = '',
  } = props;
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
    requester,
    view: selectedView,
    worker,
  };
  const advancedFilterCount = [taskDropId, tags, minReward, maxReward, deadlineHours].filter(
    Boolean
  ).length;
  const mobileFilterFormId = 'mobile-task-filter-form';
  const applyLabel = `Show ${resultCount}${hasMoreResults ? '+' : ''} ${
    resultCount === 1 && !hasMoreResults ? 'result' : 'results'
  }`;

  return (
    <Drawer direction="bottom">
      <Button asChild className={`relative w-full ${MOBILE_CONTROL_CLASS} px-0`} variant="outline">
        <DrawerTrigger
          aria-label={`Filters${
            activeFilterCount > 0
              ? `, ${activeFilterCount} active ${activeFilterCount === 1 ? 'filter' : 'filters'}`
              : ''
          }`}
          type="button"
        >
          <SlidersHorizontal />
          {activeFilterCount > 0 ? (
            <span
              aria-label={`${activeFilterCount} active ${
                activeFilterCount === 1 ? 'filter' : 'filters'
              }`}
              className="absolute right-1 top-1 flex size-4 items-center justify-center rounded-full bg-primary/12 font-mono text-[0.58rem] text-primary"
            >
              {activeFilterCount}
            </span>
          ) : null}
        </DrawerTrigger>
      </Button>
      <DrawerContent
        aria-describedby="mobile-task-filter-description"
        className="h-[90dvh] max-h-[calc(100dvh-0.5rem)] overflow-hidden"
      >
        <DrawerHeader className="shrink-0 border-b border-border/58 text-left">
          <DrawerTitle>Task filters</DrawerTitle>
          <DrawerDescription id="mobile-task-filter-description">
            Narrow open tasks by Task Drop, mode, status, actor, reward, and deadline.
          </DrawerDescription>
        </DrawerHeader>
        <div
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4"
          data-testid="mobile-task-filter-body"
        >
          <div className="grid gap-5">
            <TaskBrowseDropdown
              basePath={basePath}
              currentFilters={currentFilters}
              filterKey="mode"
              label="Mode"
              mobile
              options={modes.map((mode) => ({
                label: mode === 'ALL' ? 'All modes' : sentenceLabel(labelize(mode)),
                value: mode,
              }))}
              selectedValue={selectedMode}
            />
            <TaskBrowseDropdown
              basePath={basePath}
              currentFilters={currentFilters}
              filterKey="status"
              label="Status"
              mobile
              options={statuses.map((status) => ({
                label: status === 'ALL' ? 'All statuses' : sentenceLabel(labelize(status)),
                value: status,
              }))}
              selectedValue={selectedStatus}
            />
            <TaskBrowseDropdown
              basePath={basePath}
              currentFilters={currentFilters}
              filterKey="actor"
              label="Actor"
              mobile
              options={actors.map((actor) => ({
                label: actor === 'ALL' ? 'Any' : sentenceLabel(actor),
                value: actor,
              }))}
              selectedValue={selectedActor}
            />
            <form action={normalizeBasePath(basePath)} id={mobileFilterFormId}>
              <TaskFilterHiddenInputs
                requester={requester}
                selectedActor={selectedActor}
                selectedMode={selectedMode}
                selectedSort={selectedSort}
                selectedStatus={selectedStatus}
                selectedView={selectedView}
                worker={worker}
              />
              <details
                className="group rounded-lg border border-border/58 bg-card/38"
                open={advancedFilterCount > 0 || undefined}
              >
                <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 rounded-lg px-3 font-sans text-sm font-semibold tracking-tight text-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/35 focus-visible:outline-none [&::-webkit-details-marker]:hidden">
                  <span>Advanced filters</span>
                  <span className="flex items-center gap-2">
                    {advancedFilterCount > 0 ? (
                      <span className="font-mono text-xs font-normal text-primary">
                        {advancedFilterCount} active
                      </span>
                    ) : null}
                    <ChevronDown className="size-4 text-muted-foreground transition-transform group-open:rotate-180 motion-reduce:transition-none" />
                  </span>
                </summary>
                <div className="border-t border-border/58 p-3">
                  <TaskAdvancedFilterFields
                    compact
                    deadlineHours={deadlineHours}
                    idPrefix="drawer"
                    maxReward={maxReward}
                    minReward={minReward}
                    tags={tags}
                    taskDropId={taskDropId}
                  />
                </div>
              </details>
            </form>
          </div>
        </div>
        <DrawerFooter className="shrink-0 grid grid-cols-2 border-t border-border/58 bg-background">
          <Button asChild className={MOBILE_CONTROL_CLASS} variant="outline">
            <Link
              aria-label="Clear filters"
              href={taskFiltersHref(basePath, { view: selectedView }) as Route}
            >
              Clear
            </Link>
          </Button>
          <Button
            className={MOBILE_CONTROL_CLASS}
            form={mobileFilterFormId}
            type="submit"
            variant="terminal"
          >
            {applyLabel}
          </Button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}

function MobileTaskSortControl({
  basePath,
  currentFilters,
  selectedSort,
}: {
  basePath: string;
  currentFilters: TaskSearchParams;
  selectedSort: TaskSortValue;
}) {
  const selectedOption =
    TASK_SORT_OPTIONS.find((option) => option.value === selectedSort) ?? TASK_SORT_OPTIONS[0];

  return (
    <DropdownMenu>
      <Button asChild className={`w-full min-w-0 ${MOBILE_CONTROL_CLASS} px-0`} variant="outline">
        <DropdownMenuTrigger aria-label={`Sort tasks. Current: ${selectedOption.label}`}>
          <ArrowUpDown />
        </DropdownMenuTrigger>
      </Button>
      <DropdownMenuContent align="end" className="min-w-52">
        {TASK_SORT_OPTIONS.map((option) => (
          <DropdownMenuItem asChild className="min-h-11 cursor-pointer" key={option.value}>
            <Link
              aria-current={selectedSort === option.value ? 'page' : undefined}
              href={
                taskFiltersHref(basePath, currentFilters, {
                  cursor: undefined,
                  cursorStack: undefined,
                  sort: option.value,
                }) as Route
              }
            >
              {option.label}
            </Link>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function TaskDesktopBrowseControls({
  activeFilterCount,
  advancedFilterCount,
  basePath,
  currentFilters,
  deadlineHours,
  maxReward,
  minReward,
  requester,
  selectedActor = 'ALL',
  selectedMode,
  selectedSort,
  selectedStatus,
  selectedView,
  tags,
  taskDropId,
  viewFilters,
  worker,
}: {
  activeFilterCount: number;
  advancedFilterCount: number;
  basePath: string;
  currentFilters: TaskSearchParams;
  deadlineHours?: string;
  maxReward?: string;
  minReward?: string;
  requester?: string;
  selectedActor?: string;
  selectedMode: string;
  selectedSort: TaskSortValue;
  selectedStatus: string;
  selectedView: TaskListView;
  tags?: string;
  taskDropId?: string;
  viewFilters: TaskSearchParams;
  worker?: string;
}) {
  return (
    <div className="hidden lg:block">
      <div
        aria-label="Task browse controls"
        className="flex flex-wrap items-center gap-x-3 gap-y-3 border-b border-border/58 px-4 py-3"
        data-testid="task-toolbar"
      >
        <div className="flex shrink-0 items-center gap-2 font-sans text-sm font-semibold tracking-tight text-foreground">
          <SlidersHorizontal aria-hidden="true" className="size-4 text-muted-foreground" />
          <span>Filters</span>
          {activeFilterCount > 0 ? (
            <Badge className="font-mono" variant="secondary">
              {activeFilterCount}
            </Badge>
          ) : null}
        </div>
        <TaskBrowseDropdown
          basePath={basePath}
          currentFilters={currentFilters}
          filterKey="mode"
          label="Mode"
          options={modes.map((mode) => ({
            label: mode === 'ALL' ? 'All modes' : sentenceLabel(labelize(mode)),
            value: mode,
          }))}
          selectedValue={selectedMode}
        />
        <TaskBrowseDropdown
          basePath={basePath}
          currentFilters={currentFilters}
          filterKey="status"
          label="Status"
          options={statuses.map((status) => ({
            label: status === 'ALL' ? 'All statuses' : sentenceLabel(labelize(status)),
            value: status,
          }))}
          selectedValue={selectedStatus}
        />
        <TaskBrowseDropdown
          basePath={basePath}
          currentFilters={currentFilters}
          filterKey="actor"
          label="Actor"
          options={actors.map((actor) => ({
            label: actor === 'ALL' ? 'Any' : sentenceLabel(actor),
            value: actor,
          }))}
          selectedValue={selectedActor}
        />
        <div className="flex min-w-0 flex-wrap items-center gap-3 xl:ml-auto">
          <TaskBrowseDropdown
            basePath={basePath}
            currentFilters={currentFilters}
            filterKey="sort"
            label="Sort"
            options={[...TASK_SORT_OPTIONS]}
            selectedValue={selectedSort}
          />
          <TaskViewToggle basePath={basePath} currentFilters={viewFilters} view={selectedView} />
        </div>
      </div>
      <details
        className="group border-b border-border/58"
        data-testid="task-advanced-filters"
        open={advancedFilterCount > 0 || undefined}
      >
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-4 py-2 font-sans text-sm font-medium text-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-ring/35 focus-visible:outline-none [&::-webkit-details-marker]:hidden">
          <span className="flex items-center gap-2">
            <span>Advanced filters</span>
            {advancedFilterCount > 0 ? (
              <span className="font-mono text-xs font-normal text-primary">
                {advancedFilterCount} active
              </span>
            ) : null}
          </span>
          <ChevronDown className="size-4 text-muted-foreground transition-transform group-open:rotate-180 motion-reduce:transition-none" />
        </summary>
        <form
          action={normalizeBasePath(basePath)}
          className="grid items-end gap-4 border-t border-border/58 bg-background/22 px-4 py-4 xl:grid-cols-[minmax(0,1fr)_auto]"
        >
          <TaskFilterHiddenInputs
            requester={requester}
            selectedActor={selectedActor}
            selectedMode={selectedMode}
            selectedSort={selectedSort}
            selectedStatus={selectedStatus}
            selectedView={selectedView}
            worker={worker}
          />
          <TaskAdvancedFilterFields
            deadlineHours={deadlineHours}
            horizontal
            idPrefix="desktop"
            maxReward={maxReward}
            minReward={minReward}
            tags={tags}
            taskDropId={taskDropId}
          />
          <div className="flex items-center gap-2 xl:pb-px">
            <Button type="submit" variant="terminal">
              <Filter aria-hidden="true" />
              Apply filters
            </Button>
            <Button asChild variant="outline">
              <Link
                aria-label="Clear filters"
                href={taskFiltersHref(basePath, { view: selectedView }) as Route}
              >
                <FilterX aria-hidden="true" />
                Clear
              </Link>
            </Button>
          </div>
        </form>
      </details>
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
  isLoading = false,
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
    selectedView?: TaskListView;
    tags?: string;
    taskDropId?: string;
    requester?: string;
    worker?: string;
  };
  isLoading?: boolean;
  listHref?: string;
  pagination?: TaskPaginationState;
  tasks: TaskResponse[];
}) {
  const selectedView = filterParams.selectedView ?? 'table';
  const sortFilters: TaskSearchParams = {
    actor: filterParams.selectedActor,
    deadlineHours: filterParams.deadlineHours,
    maxReward: filterParams.maxReward,
    minReward: filterParams.minReward,
    mode: filterParams.selectedMode,
    requester: filterParams.requester,
    status: filterParams.selectedStatus,
    tags: filterParams.tags,
    taskDropId: filterParams.taskDropId,
    view: selectedView,
    worker: filterParams.worker,
  };
  const paginationFilters: TaskSearchParams = {
    ...sortFilters,
    sort: filterParams.selectedSort,
  };
  const boardFilters: TaskSearchParams = {
    ...paginationFilters,
    cursor: pagination?.currentCursor,
    cursorStack: pagination?.cursorStack,
  };
  const clearFiltersHref = taskFiltersHref(listHref, { view: selectedView });
  const advancedFilterCount = [
    filterParams.taskDropId,
    filterParams.tags,
    filterParams.minReward,
    filterParams.maxReward,
    filterParams.deadlineHours,
  ].filter(Boolean).length;
  const showPagination =
    !isLoading &&
    filterParams.selectedSort === 'newest' &&
    Boolean(pagination && (pagination.currentCursor || pagination.hasMore));

  // Reflect the active status filter so a completed/cancelled view is not mislabelled "Open tasks".
  const { selectedStatus } = filterParams;
  const heading =
    selectedStatus && selectedStatus !== 'ALL' && selectedStatus !== 'open'
      ? `${labelize(selectedStatus).replace(/^./, (char) => char.toUpperCase())} tasks`
      : 'Open tasks';

  return (
    <div className="@container/main mx-auto grid w-full max-w-[96rem] items-start gap-4 px-4 py-6 sm:gap-5 sm:px-6 sm:py-10 lg:px-8">
      <section aria-label="Task list" className="grid w-full min-w-0 max-w-full gap-3 sm:gap-5">
        <div className="flex items-center justify-between gap-3 sm:items-end">
          <h1 className="font-display text-2xl font-semibold tracking-tight sm:text-4xl">
            {heading}
          </h1>
          <Button asChild className="size-11 px-0 sm:h-10 sm:w-auto sm:px-4" aria-label="Post task">
            <Link href={createHref as Route}>
              <Plus aria-hidden="true" />
              <span className="hidden sm:inline">Post task</span>
            </Link>
          </Button>
        </div>
        <div
          className="min-w-0 overflow-hidden rounded-lg border border-border/68 bg-card/38 shadow-[var(--shadow-soft)]"
          data-testid="task-results-frame"
        >
          <TaskDesktopBrowseControls
            activeFilterCount={activeFilters.length}
            advancedFilterCount={advancedFilterCount}
            basePath={basePath}
            currentFilters={paginationFilters}
            deadlineHours={filterParams.deadlineHours}
            maxReward={filterParams.maxReward}
            minReward={filterParams.minReward}
            requester={filterParams.requester}
            selectedActor={filterParams.selectedActor}
            selectedMode={filterParams.selectedMode}
            selectedSort={filterParams.selectedSort}
            selectedStatus={filterParams.selectedStatus}
            selectedView={selectedView}
            tags={filterParams.tags}
            taskDropId={filterParams.taskDropId}
            viewFilters={boardFilters}
            worker={filterParams.worker}
          />
          <div
            aria-label="Task browse controls"
            className={`grid ${
              activeFilters.length > 0 ? 'grid-cols-5' : 'grid-cols-4'
            } h-11 gap-2 border-b border-border/58 px-3 lg:hidden`}
            data-testid="mobile-task-toolbar"
          >
            <MobileTaskFilterDrawer
              activeFilterCount={activeFilters.length}
              basePath={basePath}
              deadlineHours={filterParams.deadlineHours}
              hasMoreResults={Boolean(pagination?.hasMore)}
              maxReward={filterParams.maxReward}
              minReward={filterParams.minReward}
              resultCount={tasks.length}
              selectedActor={filterParams.selectedActor}
              selectedMode={filterParams.selectedMode}
              selectedSort={filterParams.selectedSort}
              selectedStatus={filterParams.selectedStatus}
              selectedView={selectedView}
              tags={filterParams.tags}
              taskDropId={filterParams.taskDropId}
              requester={filterParams.requester}
              worker={filterParams.worker}
            />
            <MobileTaskSortControl
              basePath={basePath}
              currentFilters={sortFilters}
              selectedSort={filterParams.selectedSort}
            />
            <TaskViewToggle
              basePath={basePath}
              currentFilters={boardFilters}
              presentation="mobile"
              view={selectedView}
            />
            {activeFilters.length > 0 ? (
              <Button asChild className={`w-full ${MOBILE_CONTROL_CLASS} px-0`} variant="outline">
                <Link aria-label="Clear filters" href={clearFiltersHref as Route}>
                  <FilterX />
                </Link>
              </Button>
            ) : null}
          </div>
          {activeFilters.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2 border-b border-border/58 px-3 py-2.5 sm:px-4">
              <span className="font-mono text-xs uppercase text-muted-foreground">
                Active filters
              </span>
              {activeFilters.map((filter) => (
                <Badge key={`${filter.label}:${filter.value}`} variant="outline">
                  {filter.label}: {filter.value}
                </Badge>
              ))}
              <Button asChild className="ml-auto hidden lg:inline-flex" size="xs" variant="link">
                <Link href={clearFiltersHref as Route}>
                  <FilterX aria-hidden="true" />
                  Clear filters
                </Link>
              </Button>
            </div>
          ) : null}
          <h2 className="sr-only">Task results</h2>
          <TaskListBoard
            basePath={basePath}
            contained
            createHref={createHref}
            currentFilters={boardFilters}
            detailBasePath={detailBasePath}
            errorMessage={errorMessage}
            hasActiveFilters={activeFilters.length > 0}
            isLoading={isLoading}
            listHref={clearFiltersHref}
            tasks={tasks}
            view={selectedView}
          />
          {showPagination ? (
            <div className="border-t border-border/58 px-3 py-3 sm:px-4">
              <TaskPaginationControl
                basePath={basePath}
                currentFilters={paginationFilters}
                pagination={pagination}
              />
            </div>
          ) : null}
        </div>
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

// Deliberately slim: just role, name, and the View action. Mime type, size, and
// hashes live in the preview dialog's metadata panel one click away.
function ArtifactRow({ artifact, taskId }: { artifact: ArtifactResponse; taskId: string }) {
  const label = artifact.role !== 'attachment' ? artifact.role : null;
  return (
    <div className="min-w-0 rounded-lg border border-border/52 bg-muted/24 px-3 py-2 text-sm">
      <div className="flex min-w-0 items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          {label ? <Badge variant="outline">{label}</Badge> : null}
          <span className="min-w-0 truncate font-mono font-semibold" title={artifact.fileName}>
            {artifact.fileName}
          </span>
        </div>
        <ArtifactPreviewButton artifact={artifact} taskId={taskId} />
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
  // Prefer a registered agent's name/id over a raw wallet address once one is on
  // record -- compactAddress(agentId) previously rendered a short numeric agentId
  // as-is (e.g. "42"), with nothing marking it as an agent identity.
  const defaultText = agentId
    ? (getAgentName(agentId) ?? `Agent #${agentId}`)
    : compactAddress(address);
  const text = label ?? defaultText;

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
  layout = 'card',
  onOpenMedia,
  profileBasePath,
  reviewAction,
  submission,
  task,
}: {
  layout?: 'card' | 'gallery' | 'list';
  onOpenMedia?: (artifactId: string) => void;
  profileBasePath: string;
  reviewAction?: PendingAction;
  submission: SubmissionResponse;
  task: TaskDetailResponse | TaskResponse;
}) {
  const artifacts: ArtifactResponse[] = submission.artifacts ?? [];
  // Artifacts arrive pre-sorted by displayOrder (the order the worker uploaded them
  // in), which already encodes their intended primacy -- the backend never reorders
  // by type. So the hero is whichever playable artifact comes first in that order,
  // not whichever type (image/video vs. interactive HTML) it happens to be: a worker
  // who leads with an HTML deliverable gets it surfaced as the hero, same as leading
  // with an image or video always has.
  const mediaArtifacts = artifacts.filter(isPlayableArtifact);
  const supportingArtifacts = artifacts.filter((artifact) => !isPlayableArtifact(artifact));
  const [heroArtifact, ...extraMedia] = mediaArtifacts;
  const primaryArtifact = heroArtifact ?? supportingArtifacts[0];
  const worker = submission.workerAddress;
  const workerLabel = compactAddress(submission.workerAgentId ?? submission.workerAddress);
  const acceptAction = reviewAction
    ? {
        ...reviewAction,
        command: commandForTaskWorker(reviewAction.command, worker),
      }
    : null;
  const awardRecipient = isAwardRecipient(task, worker);

  if (layout === 'list') {
    return (
      <article
        aria-label={`Submission from ${workerLabel}`}
        className="grid min-w-0 gap-3 border-b border-border/58 py-4 first:pt-0"
      >
        <div className="flex min-w-0 flex-col gap-4 sm:flex-row sm:items-center">
          <div className="w-full shrink-0 sm:w-32">
            {heroArtifact ? (
              <ArtifactMediaHero
                artifact={heroArtifact}
                onOpen={onOpenMedia ? () => onOpenMedia(heroArtifact.id) : undefined}
                taskId={submission.taskId}
              />
            ) : (
              <div className="grid h-24 place-items-center rounded-lg bg-muted/32 text-muted-foreground">
                <FileIcon className="size-9" strokeWidth={1.5} />
              </div>
            )}
          </div>
          <div className="grid min-w-0 flex-1 gap-1">
            <ActorLink
              address={submission.workerAddress}
              agentId={submission.workerAgentId}
              className="truncate font-mono text-base font-semibold hover:text-primary"
              label={workerLabel}
              profileBasePath={profileBasePath}
              title={worker}
            />
            <p className="text-sm text-muted-foreground">
              {heroArtifact
                ? heroArtifact.mediaKind === 'video'
                  ? 'Video submission'
                  : 'Image submission'
                : artifacts.length > 0
                  ? 'Supporting files'
                  : 'No attached files'}
            </p>
            {artifacts.length > 0 ? (
              <p className="text-sm text-muted-foreground">
                {countLabel(artifacts.length, 'file')}
              </p>
            ) : null}
          </div>
          <RelativeTime
            className="shrink-0 text-sm text-muted-foreground sm:w-24"
            value={submission.submittedAt}
          />
          {primaryArtifact ? (
            <ArtifactPreviewButton
              artifact={primaryArtifact}
              label={
                <>
                  Open
                  <ExternalLinkIcon className="size-3.5" />
                </>
              }
              taskId={submission.taskId}
            />
          ) : null}
        </div>
        {acceptAction ? <SubmissionPayoutAction action={acceptAction} task={task} /> : null}
      </article>
    );
  }

  if (layout === 'gallery') {
    return (
      <article
        aria-label={`Submission from ${workerLabel}`}
        className="grid h-full min-w-0 content-start overflow-hidden rounded-lg border border-border/58 bg-background/34 shadow-[var(--shadow-soft)] transition-colors hover:border-primary/54"
      >
        {primaryArtifact ? (
          <ArtifactMediaHero
            artifact={primaryArtifact}
            onOpen={heroArtifact && onOpenMedia ? () => onOpenMedia(heroArtifact.id) : undefined}
            taskId={submission.taskId}
          />
        ) : null}
        <div className="grid gap-3 border-t border-border/58 p-4">
          <div className="flex min-w-0 items-center justify-between gap-3">
            <span className="flex min-w-0 items-center gap-2">
              <ActorLink
                address={submission.workerAddress}
                agentId={submission.workerAgentId}
                className="truncate font-mono text-sm font-semibold hover:text-primary"
                label={workerLabel}
                profileBasePath={profileBasePath}
                title={worker}
              />
              {awardRecipient ? <Badge variant="success">Award recipient</Badge> : null}
            </span>
            <RelativeTime
              className="shrink-0 text-sm text-muted-foreground"
              value={submission.submittedAt}
            />
          </div>
          {extraMedia.length > 0 ? (
            <div className="flex min-w-0 flex-wrap gap-2">
              {extraMedia.map((artifact) => (
                <ArtifactMediaThumb
                  artifact={artifact}
                  key={artifact.id}
                  onOpen={onOpenMedia ? () => onOpenMedia(artifact.id) : undefined}
                  taskId={submission.taskId}
                />
              ))}
            </div>
          ) : null}
          {supportingArtifacts.length > 0 ? (
            <details className="min-w-0">
              <summary className="cursor-pointer select-none font-mono text-xs uppercase text-muted-foreground hover:text-foreground">
                Supporting files ({supportingArtifacts.length})
              </summary>
              <div className="mt-2 grid min-w-0 gap-2">
                {supportingArtifacts.map((artifact) => (
                  <ArtifactRow artifact={artifact} key={artifact.id} taskId={submission.taskId} />
                ))}
              </div>
            </details>
          ) : null}
        </div>
        {primaryArtifact ? (
          <div className="flex items-center justify-between border-t border-border/58 px-4 py-2">
            <ArtifactPreviewButton
              artifact={primaryArtifact}
              label="Open submission"
              taskId={submission.taskId}
            />
          </div>
        ) : null}
        {artifacts.length === 0 ? (
          <p className="border-t border-border/58 p-4 text-sm text-muted-foreground">
            No artifacts were attached to this submission.
          </p>
        ) : null}
        {acceptAction ? (
          <div className="border-t border-border/58 p-3">
            <SubmissionPayoutAction action={acceptAction} task={task} />
          </div>
        ) : null}
      </article>
    );
  }

  return (
    <article
      aria-label={`Submission from ${workerLabel}`}
      className="grid min-w-0 content-start gap-3 rounded-lg border border-border/58 bg-background/34 p-3 shadow-[var(--shadow-soft)]"
    >
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <span className="flex min-w-0 flex-wrap items-center gap-2">
          <ActorLink
            address={submission.workerAddress}
            agentId={submission.workerAgentId}
            className="min-w-0 truncate font-mono text-sm hover:text-primary"
            label={workerLabel}
            profileBasePath={profileBasePath}
            title={worker}
          />
          {awardRecipient ? <Badge variant="success">Award recipient</Badge> : null}
          {mediaArtifacts.length === 0 && artifacts.length > 0 ? (
            <Badge variant="outline">{countLabel(artifacts.length, 'file')}</Badge>
          ) : null}
        </span>
        <RelativeTime className="text-sm text-muted-foreground" value={submission.submittedAt} />
      </div>
      {heroArtifact ? (
        <ArtifactMediaHero
          artifact={heroArtifact}
          onOpen={onOpenMedia ? () => onOpenMedia(heroArtifact.id) : undefined}
          taskId={submission.taskId}
        />
      ) : null}
      {extraMedia.length > 0 ? (
        <div className="flex min-w-0 flex-wrap gap-2">
          {extraMedia.map((artifact) => (
            <ArtifactMediaThumb
              artifact={artifact}
              key={artifact.id}
              onOpen={onOpenMedia ? () => onOpenMedia(artifact.id) : undefined}
              taskId={submission.taskId}
            />
          ))}
        </div>
      ) : null}
      {supportingArtifacts.length > 0 ? (
        <details className="min-w-0">
          <summary className="cursor-pointer select-none font-mono text-xs uppercase text-muted-foreground hover:text-foreground">
            Supporting files ({supportingArtifacts.length})
          </summary>
          <div className="mt-2 grid min-w-0 gap-2">
            {supportingArtifacts.map((artifact) => (
              <ArtifactRow artifact={artifact} key={artifact.id} taskId={submission.taskId} />
            ))}
          </div>
        </details>
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
  reviewActions,
  secondarySubmissionReview,
  submissionReviewEligible,
  task,
}: {
  marketStats?: MarketStats | null;
  modeData?: TaskModeData;
  profileBasePath: string;
  reviewActions?: {
    acceptAction?: PendingAction;
    rejectAction?: PendingAction;
  };
  secondarySubmissionReview?: boolean;
  submissionReviewEligible?: boolean;
  task: TaskDetailResponse | TaskResponse;
}) {
  return (
    <LiveActivityPanel
      initialModeData={modeData}
      marketStats={marketStats}
      profileBasePath={profileBasePath}
      reviewActions={reviewActions}
      secondarySubmissionReview={secondarySubmissionReview}
      submissionReviewEligible={submissionReviewEligible}
      task={task}
    />
  );
}

function DetailMetric({
  label,
  labelAction,
  value,
  valueCaption,
  valueClassName,
}: {
  label: string;
  labelAction?: ReactNode;
  value: ReactNode;
  valueCaption?: ReactNode;
  valueClassName?: string;
}) {
  return (
    <article
      aria-label={`${label} summary`}
      className="min-w-0 border-t border-border/52 p-3 even:border-l first:border-t-0 [&:nth-child(2)]:border-t-0 sm:p-4 md:border-l md:border-t-0 md:p-5 md:first:border-l-0"
    >
      <div className="flex items-center gap-1">
        <p className="font-mono text-[0.68rem] uppercase text-muted-foreground">{label}</p>
        {labelAction}
      </div>
      <div
        className={
          valueClassName ??
          'mt-2 truncate font-mono text-2xl font-semibold tracking-tight text-foreground md:text-3xl'
        }
      >
        {value}
      </div>
      {valueCaption ? <p className="mt-1 text-sm text-muted-foreground">{valueCaption}</p> : null}
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
    <section
      aria-label="Settlement payouts"
      className="grid scroll-mt-24 gap-4 border-t border-border/58 pt-5"
      id="settlement-payouts"
      tabIndex={-1}
    >
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

function WorkRequirementsPanel({
  className,
  task,
}: {
  className?: string;
  task: TaskDetailResponse | TaskResponse;
}) {
  const rows = requirementRows(task);

  return (
    <section className={`grid gap-4 border-t border-border/58 pt-5 ${className ?? ''}`}>
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
  modeData,
  modeHref,
  profileBasePath,
  reviewRequired,
  task,
  taskTypesHref,
}: {
  modeData?: TaskModeData;
  modeHref: Route;
  profileBasePath: string;
  reviewRequired: boolean;
  task: TaskDetailResponse | TaskResponse;
  taskTypesHref: Route;
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
    <div className="w-full lg:border-l lg:border-border/58 lg:pl-5">
      <TaskReviewStatus
        detail={
          reviewRequired
            ? task.status === 'pending_approval' || isOpenWindowClosed(task)
              ? 'Submission window closed'
              : 'Submissions ready for review'
            : statusContext(task)
        }
        requester={task.requester}
        reviewRequired={reviewRequired}
        status={taskStatusLabel(task.status)}
      />
      <div className="grid gap-5 pt-5">
        <SummaryGroup title="Task reference">
          <SummaryRow
            label="Requester"
            value={
              <ActorLink
                address={task.requester}
                agentId={task.requesterAgentId}
                className="min-w-0 truncate hover:text-primary"
                profileBasePath={profileBasePath}
                title={task.requester}
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
          <SummaryRow label="Created" value={formatDateTime(task.createdAt)} />
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

        <SummaryGroup title="Task type">
          <div className="flex flex-wrap gap-2">
            <Link href={modeHref}>
              <Badge className="hover:opacity-80" variant={taskModeBadgeVariant(task.mode)}>
                {task.mode}
              </Badge>
            </Link>
            <InfoTooltip label={MODE_TOOLTIPS[task.mode]}>
              <span className="sr-only">About {task.mode} tasks</span>
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
            {task.taskVisibility === 'unlisted' || task.taskVisibility === 'private' ? (
              <TaskVisibilityBadge visibility={task.taskVisibility} withTooltip />
            ) : null}
          </div>
        </SummaryGroup>

        <SummaryGroup title="Utilities">
          <div className="flex items-center justify-between gap-3">
            <span className="text-muted-foreground">Copy for agent</span>
            <span className="flex items-center gap-1">
              <CopyButton
                icon={<FileJsonIcon />}
                label="Copy as JSON"
                text={taskToAgentJson(task, modeData)}
              />
              <CopyButton
                icon={<FileTextIcon />}
                label="Copy as markdown"
                text={taskToMarkdown(task)}
              />
            </span>
          </div>
          <Link
            className="text-muted-foreground transition-colors hover:text-primary"
            href={taskTypesHref}
          >
            How this works
          </Link>
        </SummaryGroup>
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
  focusIntent,
  marketStats,
  modeData,
  profileBasePath = '/dashboard/agents',
  task,
}: {
  backHref?: string;
  focusIntent?: TaskActionIntentValue;
  marketStats?: MarketStats | null;
  modeData?: TaskModeData;
  profileBasePath?: string;
  task: TaskDetailResponse | TaskResponse;
}) {
  const listBase = normalizeBasePath(backHref);
  const taskTypesHref = '/dashboard/task-types' as Route;
  const modeHref = taskFiltersHref(listBase, { mode: task.mode }) as Route;
  const pendingActions = task.pendingActions ?? [];
  const acceptAction = pendingActions.find(
    (action) => action.action === 'accept' && action.role === 'requester'
  );
  const rejectAction = pendingActions.find(
    (action) => action.action === 'reject_submission' && action.role === 'requester'
  );
  const submissionReviewEligible =
    (task.mode === 'bounty' || task.mode === 'claim') &&
    ((task.mode === 'bounty' && (task.status === 'open' || task.status === 'pending_approval')) ||
      Boolean(acceptAction) ||
      Boolean(rejectAction));
  const reviewActions = submissionReviewEligible ? { acceptAction, rejectAction } : undefined;
  // Route accept/reject out of the generic actions card only once submissions have
  // actually loaded -- mirrors this component's own pre-existing guard (removed
  // during the worker-grouping refactor): before modeData fetches, LiveActivityPanel
  // has nothing to render the action inside yet either (its own groups are built from
  // loaded submissions), so stripping it here too made the control disappear from the
  // page entirely for that window, not just move surfaces.
  const submissionsLoaded = (modeData?.submissions?.length ?? 0) > 0;
  const decisionEvidenceReady =
    submissionsLoaded &&
    (task.submissionCount ?? 0) > 0 &&
    (modeData?.submissions?.length ?? 0) >= (task.submissionCount ?? 0);
  // Benchmark's optional `task submit` channel (alongside its primary `task proof`
  // flow) already gets real accept/reject_submission pending actions from the
  // backend (contestHasSubmissions), but had no frontend review surface at all.
  // This is additive only -- it must never affect submissionReviewEligible/
  // activeMode, which stay proof-primary for benchmark.
  const benchmarkSubmissionReview =
    task.mode === 'benchmark' &&
    (task.submissionCount ?? 0) > 0 &&
    Boolean(acceptAction || rejectAction);
  const benchmarkReviewActions = benchmarkSubmissionReview
    ? { acceptAction, rejectAction }
    : undefined;
  const nextActions =
    submissionReviewEligible && submissionsLoaded
      ? pendingActions.filter((action) => action !== acceptAction && action !== rejectAction)
      : pendingActions;
  const participationAction = findParticipationAction(nextActions);
  const extractedSubmitAction =
    participationAction?.action === 'submit' ? participationAction : undefined;
  const cancelActions = nextActions.filter((action) => action.action === 'cancel');
  const mainNextActions = nextActions.filter(
    (action) => action.action !== 'cancel' && action !== extractedSubmitAction
  );
  const showNextActions =
    mainNextActions.length > 0 ||
    (!submissionReviewEligible && cancelActions.length === 0 && !extractedSubmitAction);
  const title = taskTitle(task);
  const fullTitle = taskFullTitle(task);
  const descriptionBody = taskBody(task);
  const detailTags = taskDetailTags(task);
  const bonusSummary = dreamsBonusSummary(task);
  const dashboardDetail = backHref.startsWith('/dashboard');
  const participationModule = participationAction ? (
    <div className="scroll-mt-24" id="task-participation" tabIndex={-1}>
      <TaskParticipationModule action={participationAction} task={task} />
    </div>
  ) : null;
  const focusLabel = focusIntent ? TASK_ACTION_PRESENTATION[focusIntent].focusLabel : null;

  return (
    <div className="grid w-full min-w-0 gap-6 lg:grid-cols-3">
      <PublishedCelebration task={task} />
      <div className="flex w-full min-w-0 flex-col gap-5 lg:col-span-2">
        {!dashboardDetail ? (
          <Breadcrumb className="px-1">
            <BreadcrumbList>
              <BreadcrumbItem>
                <BreadcrumbLink asChild>
                  <Link href={backHref as Route}>Tasks</Link>
                </BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem className="min-w-0">
                <BreadcrumbPage className="truncate" title={fullTitle}>
                  {compactAddress(task.id)}
                </BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        ) : null}
        <h1
          className="break-words font-display text-2xl font-semibold leading-tight tracking-tight text-foreground"
          title={fullTitle}
        >
          {title}
        </h1>
        {focusLabel ? (
          <div
            aria-live="polite"
            className="rounded-lg border border-primary/45 bg-primary/8 px-4 py-3"
            role="status"
          >
            <p className="font-mono text-xs font-semibold uppercase tracking-wide text-primary">
              Inbox action
            </p>
            <p className="mt-1 text-sm font-medium text-foreground">{focusLabel}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              The link has taken you to the relevant task section below.
            </p>
          </div>
        ) : null}
        <section
          aria-label="Task metrics"
          className="grid grid-cols-2 overflow-hidden rounded-lg border border-border/58 bg-card/38 md:grid-cols-4"
        >
          <DetailMetric
            label="Reward"
            value={<span className="text-primary">{formatUsdcUnits(taskDisplayReward(task))}</span>}
            valueCaption={auctionPriceCaption(task)}
          />
          <DetailMetric
            label={bonusSummary ? 'Estimated DREAMS bonus' : 'Bonus'}
            labelAction={bonusSummary ? <DreamsRewardDisclosure /> : undefined}
            value={bonusSummary?.value ?? '--'}
            valueCaption={bonusSummary?.caption}
            valueClassName="mt-2 font-mono text-xl font-semibold tracking-tight text-foreground"
          />
          <DetailMetric
            label="Due"
            value={<DeadlineLabel className="text-lg" task={task} />}
            valueClassName="mt-2 min-w-0 text-lg font-medium text-foreground"
          />
          <DetailMetric
            label={activityTitle(task)}
            value={activityLabel(task, modeData)}
            valueClassName="mt-2 min-w-0 text-lg font-medium text-foreground"
          />
        </section>
        <LiveStatusBanner marketStats={marketStats} modeData={modeData} task={task} />
        <VerdictEvidencePanel
          forceVisible={focusIntent === 'appeal_verdict' || focusIntent === 'finalize_verdict'}
          task={task}
        />
        <SettlementPayoutsPanel profileBasePath={profileBasePath} task={task} />
        {descriptionBody || detailTags.length > 0 ? (
          <section
            className="grid gap-4 border-t border-border/58 pt-5"
            data-testid="task-description-surface"
          >
            {descriptionBody ? (
              <TaskDescriptionDisclosure>
                <TaskBrief body={descriptionBody} />
              </TaskDescriptionDisclosure>
            ) : null}
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
        {!submissionReviewEligible && participationModule ? (
          <div className="order-1 lg:order-4">{participationModule}</div>
        ) : null}
        {submissionReviewEligible ? (
          <>
            {participationModule}
            <ModeDataPanel
              marketStats={marketStats}
              modeData={modeData}
              profileBasePath={profileBasePath}
              reviewActions={reviewActions}
              submissionReviewEligible
              task={task}
            />
          </>
        ) : null}
        {showNextActions ? (
          <div className="order-1 scroll-mt-24 lg:order-2" id="task-next-actions" tabIndex={-1}>
            <TaskActionsPanel
              claimedBy={task.claimedBy}
              emptyReason={pendingActionEmptyReason(task)}
              evidenceReady={decisionEvidenceReady}
              pendingActions={mainNextActions}
              requester={task.requester}
              task={task}
              worker={task.primaryAward?.workerAddress}
            />
          </div>
        ) : null}
        <WorkRequirementsPanel className="order-2 lg:order-1" task={task} />
        {cancelActions.length > 0 ? (
          <div className="order-3">
            <TaskActionsPanel
              claimedBy={task.claimedBy}
              emptyReason={pendingActionEmptyReason(task)}
              evidenceReady={decisionEvidenceReady}
              hideWhenNoVisibleActions
              pendingActions={cancelActions}
              requester={task.requester}
              task={task}
              title="Task controls"
              worker={task.primaryAward?.workerAddress}
            />
          </div>
        ) : null}
        {!submissionReviewEligible ? (
          <div className="order-4">
            <ModeDataPanel
              marketStats={marketStats}
              modeData={modeData}
              profileBasePath={profileBasePath}
              reviewActions={benchmarkReviewActions}
              secondarySubmissionReview={benchmarkSubmissionReview}
              task={task}
            />
          </div>
        ) : null}
      </div>
      <aside aria-label="Task sidebar" className="grid h-fit gap-6 lg:sticky lg:top-20">
        <TaskSummaryRail
          modeData={modeData}
          modeHref={modeHref}
          profileBasePath={profileBasePath}
          reviewRequired={Boolean(acceptAction || rejectAction)}
          task={task}
          taskTypesHref={taskTypesHref}
        />
      </aside>
    </div>
  );
}

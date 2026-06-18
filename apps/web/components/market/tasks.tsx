import type {
  ArtifactResponse,
  BidResponse,
  ClaimResponse,
  PendingAction,
  PitchResponse,
  ProofResponse,
  SubmissionResponse,
  TaskDetailResponse,
  TaskModeType,
  TaskResponse,
  TaskStatusType,
} from '@taskmarket/shared';
import { SlidersHorizontal } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { SubmissionPayoutAction } from '@/components/market/actions/submission-payout-action';
import {
  ArtifactMediaTile,
  ArtifactPreviewButton,
} from '@/components/market/artifact-preview-button';
import { InfoTooltip } from '@/components/market/info-tooltip';
import { TaskActionsPanel } from '@/components/market/task-actions-panel';
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
import { compactAddress, formatDateTime, formatUsdcUnits } from '@/lib/format';
import { normalizeBasePath, taskFiltersHref } from '@/lib/market/task-filters';
import type { ActiveFilter, TaskSearchParams } from '@/lib/market/task-filters';

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

type TaskModeData = {
  bids?: BidResponse[];
  claim?: ClaimResponse | null;
  pitches?: PitchResponse[];
  proofs?: ProofResponse[];
  submissions?: SubmissionResponse[];
};

function taskTitle(task: TaskResponse) {
  return task.description.split('\n')[0]?.slice(0, 80) || `Task ${task.id}`;
}

function taskBody(task: TaskResponse) {
  const description = task.description.trim();
  const body = description.split('\n').slice(1).join('\n').trim();

  if (body) {
    return body;
  }

  return description === taskTitle(task).trim() ? '' : description;
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

function countLabel(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function taskDeadlineLabel(task: TaskDetailResponse | TaskResponse) {
  if (task.mode === 'auction' && task.bidDeadline) {
    return formatDateTime(task.bidDeadline);
  }

  if (task.mode === 'pitch' && task.pitchDeadline) {
    return formatDateTime(task.pitchDeadline);
  }

  return formatDateTime(task.expiryTime);
}

function statusContext(task: TaskDetailResponse | TaskResponse) {
  const expiry = new Date(task.expiryTime);
  if (task.status === 'open' && Number.isFinite(expiry.getTime()) && expiry < new Date()) {
    return 'Expired open task';
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
      return task.rating === null ? 'Completed, rating pending' : 'Completed';
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
      return task.rating === null
        ? 'Payment confirmed. The requester can still leave a rating.'
        : 'This task is complete.';
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

function activityEmptyCopy(task: TaskDetailResponse | TaskResponse) {
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

function activityCount(task: TaskDetailResponse | TaskResponse, modeData?: TaskModeData) {
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

function activityLabel(task: TaskDetailResponse | TaskResponse, modeData?: TaskModeData) {
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
    <li className="grid gap-3 rounded-lg border border-border/58 bg-background/38 p-4">
      <div className="grid gap-2">
        <Link
          className="text-base font-semibold leading-6 text-foreground hover:text-primary"
          href={detailHref as Route}
        >
          {taskTitle(task)}
        </Link>
        <div className="flex flex-wrap gap-1.5">
          <Badge variant={task.mode === 'auction' ? 'default' : 'outline'}>{task.mode}</Badge>
          <Badge variant="terminal">{labelize(task.status)}</Badge>
          {task.tags.slice(0, 2).map((tag) => (
            <Badge key={tag} variant="outline">
              {tag}
            </Badge>
          ))}
        </div>
      </div>
      <dl className="grid grid-cols-2 gap-3 text-sm">
        <div className="min-w-0">
          <dt className="font-mono text-[0.68rem] uppercase text-muted-foreground">Reward</dt>
          <dd className="mt-1 font-mono text-primary">{formatUsdcUnits(task.reward)}</dd>
        </div>
        <div className="min-w-0">
          <dt className="font-mono text-[0.68rem] uppercase text-muted-foreground">Due</dt>
          <dd className="mt-1 truncate font-mono text-muted-foreground">
            {taskDeadlineLabel(task)}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="font-mono text-[0.68rem] uppercase text-muted-foreground">Requester</dt>
          <dd className="mt-1 font-mono text-muted-foreground">{compactAddress(task.requester)}</dd>
        </div>
        <div className="min-w-0">
          <dt className="font-mono text-[0.68rem] uppercase text-muted-foreground">Activity</dt>
          <dd className="mt-1 font-mono text-muted-foreground">{activityLabel(task)}</dd>
        </div>
      </dl>
      <Button asChild className="w-full sm:w-fit" variant="outline">
        <Link href={detailHref as Route}>View task</Link>
      </Button>
    </li>
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
}: {
  createHref?: string;
  detailBasePath?: string;
  errorMessage?: string;
  hasActiveFilters?: boolean;
  isLoading?: boolean;
  listHref?: string;
  tasks: TaskResponse[];
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
                {hasActiveFilters ? 'No tasks match these filters' : 'No open tasks yet'}
              </p>
              <p className="text-sm text-muted-foreground">
                {hasActiveFilters
                  ? 'Change filters or clear them to return to open tasks.'
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

  return (
    <div className="min-w-0 max-w-full overflow-hidden rounded-lg border border-border/58 bg-card/38">
      <ul aria-label="Task cards" className="grid gap-3 p-3 md:hidden" role="list">
        {tasks.map((task) => (
          <TaskMobileCard detailBasePath={detailBasePath} key={task.id} task={task} />
        ))}
      </ul>
      <div className="hidden w-full max-w-full overflow-x-auto md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Task</TableHead>
              <TableHead>Mode</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Requester</TableHead>
              <TableHead className="text-right">Reward</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {tasks.map((task) => (
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
                    {task.tags.slice(0, 3).map((tag) => (
                      <Badge key={tag} variant="terminal">
                        {tag}
                      </Badge>
                    ))}
                  </div>
                </TableCell>
                <TableCell>
                  <Badge variant={task.mode === 'auction' ? 'default' : 'outline'}>
                    {task.mode}
                  </Badge>
                </TableCell>
                <TableCell className="font-mono text-sm uppercase">
                  {labelize(task.status)}
                </TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground">
                  {compactAddress(task.requester)}
                </TableCell>
                <TableCell className="text-right font-mono text-primary">
                  {formatUsdcUnits(task.reward)}
                </TableCell>
              </TableRow>
            ))}
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
  selectedStatus?: 'ALL' | TaskStatusType | string;
  tags?: string;
};

function TaskFilterControls({
  basePath = '/dashboard/tasks',
  deadlineHours = '',
  idPrefix,
  maxReward = '',
  minReward = '',
  selectedActor = 'ALL',
  selectedMode = 'ALL',
  selectedStatus = 'ALL',
  tags = '',
}: TaskFilterControlsProps) {
  const currentFilters: TaskSearchParams = {
    actor: selectedActor,
    deadlineHours,
    maxReward,
    minReward,
    mode: selectedMode,
    status: selectedStatus,
    tags,
  };

  return (
    <div className="grid gap-4">
      <div className="grid gap-2">
        <p className="font-mono text-xs uppercase text-muted-foreground">Mode</p>
        <div className="grid grid-cols-1 gap-1">
          {modes.map((mode) => (
            <Button asChild key={mode} size="chip" variant="chip">
              <Link
                data-active={selectedMode === mode}
                href={taskFiltersHref(basePath, currentFilters, { mode }) as Route}
              >
                {mode === 'ALL' ? 'All modes' : labelize(mode)}
              </Link>
            </Button>
          ))}
        </div>
      </div>
      <div className="grid gap-2">
        <p className="font-mono text-xs uppercase text-muted-foreground">Status</p>
        <div className="grid grid-cols-1 gap-1">
          {statuses.map((status) => (
            <Button asChild key={status} size="chip" variant="chip">
              <Link
                data-active={selectedStatus === status}
                href={taskFiltersHref(basePath, currentFilters, { status }) as Route}
              >
                {status === 'ALL' ? 'All statuses' : labelize(status)}
              </Link>
            </Button>
          ))}
        </div>
      </div>
      <div className="grid gap-2">
        <p className="font-mono text-xs uppercase text-muted-foreground">Actor</p>
        <div className="grid grid-cols-1 gap-1">
          {actors.map((actor) => (
            <Button asChild key={actor} size="chip" variant="chip">
              <Link
                data-active={selectedActor === actor}
                href={taskFiltersHref(basePath, currentFilters, { actor }) as Route}
              >
                {actor === 'ALL' ? 'Any' : actor}
              </Link>
            </Button>
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
      <DrawerTrigger asChild>
        <Button className="min-h-11" type="button" variant="outline">
          <SlidersHorizontal />
          Filters
        </Button>
      </DrawerTrigger>
      <DrawerContent aria-describedby="mobile-task-filter-description">
        <DrawerHeader>
          <DrawerTitle>Task filters</DrawerTitle>
          <DrawerDescription id="mobile-task-filter-description">
            Narrow open tasks by mode, status, actor, reward, and deadline.
          </DrawerDescription>
        </DrawerHeader>
        <div className="overflow-y-auto px-4 pb-4">
          <TaskFilterControls {...props} idPrefix="drawer" />
        </div>
      </DrawerContent>
    </Drawer>
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
    selectedStatus: string;
    tags?: string;
  };
  listHref?: string;
  tasks: TaskResponse[];
}) {
  return (
    <div className="@container/main grid w-full grid-cols-[minmax(0,1fr)] items-start gap-5 px-4 py-4 md:gap-6 md:py-6 lg:grid-cols-[210px_minmax(0,1fr)] lg:px-6 xl:grid-cols-[220px_minmax(0,1fr)]">
      <TaskFilterRail
        basePath={basePath}
        deadlineHours={filterParams.deadlineHours}
        maxReward={filterParams.maxReward}
        minReward={filterParams.minReward}
        selectedActor={filterParams.selectedActor}
        selectedMode={filterParams.selectedMode}
        selectedStatus={filterParams.selectedStatus}
        tags={filterParams.tags}
      />
      <section
        aria-label="Task list"
        className="grid w-full min-w-0 max-w-full gap-5 overflow-hidden"
      >
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="font-mono text-xs uppercase text-primary">Tasks</p>
            <h1 className="mt-2 font-display text-4xl font-semibold tracking-tight">Open tasks</h1>
          </div>
          <div className="flex flex-wrap gap-2">
            <div className="lg:hidden">
              <MobileTaskFilterDrawer
                basePath={basePath}
                deadlineHours={filterParams.deadlineHours}
                maxReward={filterParams.maxReward}
                minReward={filterParams.minReward}
                selectedActor={filterParams.selectedActor}
                selectedMode={filterParams.selectedMode}
                selectedStatus={filterParams.selectedStatus}
                tags={filterParams.tags}
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
        <TaskTable
          createHref={createHref}
          detailBasePath={detailBasePath}
          errorMessage={errorMessage}
          hasActiveFilters={activeFilters.length > 0}
          listHref={listHref}
          tasks={tasks}
        />
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

function ActorLink({
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

function SubmissionCard({
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

  return (
    <article
      aria-label={`Submission from ${workerLabel}`}
      className="grid min-w-0 content-start gap-4 rounded-lg border border-border/58 bg-background/34 p-3 shadow-[var(--shadow-soft)]"
    >
      <div className="grid min-w-0 gap-3">
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
          <Badge variant="outline">{countLabel(mediaArtifacts.length, 'media artifact')}</Badge>
          <time className="text-sm text-muted-foreground" dateTime={submission.submittedAt}>
            {new Date(submission.submittedAt).toLocaleString()}
          </time>
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

function ModeDataPanel({
  modeData,
  profileBasePath,
  reviewAction,
  task,
}: {
  modeData?: TaskModeData;
  profileBasePath: string;
  reviewAction?: PendingAction;
  task: TaskDetailResponse | TaskResponse;
}) {
  const submissions = modeData?.submissions ?? [];
  const pitches = modeData?.pitches ?? [];
  const proofs = modeData?.proofs ?? [];
  const bids = modeData?.bids ?? [];
  const claim = modeData?.claim ?? null;

  const hasActivity =
    submissions.length > 0 ||
    pitches.length > 0 ||
    proofs.length > 0 ||
    bids.length > 0 ||
    claim != null;

  const isReviewQueue = reviewAction && submissions.length > 0;
  const title = isReviewQueue ? 'Submission review' : 'Activity';
  const description = isReviewQueue
    ? 'Compare deliverables before releasing escrow. Each payout action is tied to its submission worker.'
    : 'Work, bids, proofs, and reviews tied to this task.';

  return (
    <section className="grid gap-4 border-t border-border/58 pt-5">
      <div>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="grid gap-1">
            <h2 className="font-display font-semibold leading-none tracking-tight text-foreground">
              {title}
            </h2>
            <p className="text-sm leading-5 text-muted-foreground">{description}</p>
          </div>
          <Badge variant="terminal">{activityLabel(task, modeData)}</Badge>
        </div>
      </div>
      <div className="grid gap-3">
        {submissions.length > 0 ? (
          <div
            aria-label={isReviewQueue ? 'Artifact comparison' : undefined}
            className={isReviewQueue ? 'grid items-start gap-3 xl:grid-cols-2' : 'grid gap-3'}
            role={isReviewQueue ? 'region' : undefined}
          >
            {submissions.map((submission) => (
              <SubmissionCard
                key={submission.id}
                profileBasePath={profileBasePath}
                reviewAction={reviewAction}
                submission={submission}
                task={task}
              />
            ))}
          </div>
        ) : null}

        {pitches.map((pitch) => (
          <div className="rounded-lg border border-border/52 bg-background/30 p-3" key={pitch.id}>
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
        ))}

        {proofs.map((proof) => (
          <div className="rounded-lg border border-border/52 bg-background/30 p-3" key={proof.id}>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline">{proof.status}</Badge>
              <Badge variant="terminal">{proof.proofType}</Badge>
              {proof.metricValue ? (
                <span className="font-mono text-sm">{proof.metricValue}</span>
              ) : null}
            </div>
            <p className="mt-2 break-all text-sm leading-6 text-muted-foreground">
              {proof.proofData}
            </p>
          </div>
        ))}

        {bids.map((bid) => (
          <div
            className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/52 bg-background/30 p-3 font-mono text-sm"
            key={bid.id}
          >
            <ActorLink
              address={bid.workerAddress}
              agentId={bid.workerAgentId}
              className="hover:text-primary"
              profileBasePath={profileBasePath}
            />
            <span className="text-primary">{formatUsdcUnits(bid.price)}</span>
          </div>
        ))}

        {claim ? (
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
        ) : null}

        {!hasActivity ? (
          <div className="rounded-lg border border-dashed border-border/58 bg-background/30 p-4">
            <p className="text-sm font-semibold tracking-tight text-foreground">No activity yet</p>
            <p className="mt-1 text-sm leading-5 text-muted-foreground">
              {activityEmptyCopy(task)}
            </p>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function DetailMetric({
  footerLabel,
  footerValue,
  label,
  value,
}: {
  footerLabel: string;
  footerValue: ReactNode;
  label: string;
  value: ReactNode;
}) {
  return (
    <article
      aria-label={`${label} summary`}
      className="min-w-0 border-t border-border/52 p-5 first:border-t-0 md:border-l md:border-t-0 md:first:border-l-0"
    >
      <p className="font-mono text-[0.68rem] uppercase text-muted-foreground">{label}</p>
      <div className="mt-2 truncate font-mono text-2xl font-semibold tracking-tight text-foreground md:text-3xl">
        {value}
      </div>
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
  const showAuctionPricing = Boolean(
    task.maxPrice ||
    task.currentAuctionPrice ||
    task.currentLowestBid ||
    task.auctionStartPrice ||
    task.auctionFloorPrice
  );

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
            {task.currentAuctionPrice ? (
              <SummaryRow
                label="Clock price"
                value={
                  <span className="text-primary">{formatUsdcUnits(task.currentAuctionPrice)}</span>
                }
              />
            ) : null}
            {task.currentLowestBid ? (
              <SummaryRow label="Lowest bid" value={formatUsdcUnits(task.currentLowestBid)} />
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

        {task.worker || task.claimedBy ? (
          <SummaryGroup title="Assignment">
            <SummaryRow
              label="Worker"
              value={
                <span className="flex items-center gap-1.5">
                  <ActorLink
                    address={task.worker ?? task.claimedBy}
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

        {task.rating !== null ? (
          <SummaryGroup title="Outcome">
            <SummaryRow label="Rating" value={`${task.rating}/100`} />
          </SummaryGroup>
        ) : null}
      </div>
    </div>
  );
}

export function TaskDetailPanel({
  backHref = '/dashboard/tasks',
  modeData,
  profileBasePath = '/dashboard/agents',
  task,
}: {
  backHref?: string;
  modeData?: TaskModeData;
  profileBasePath?: string;
  task: TaskDetailResponse | TaskResponse;
}) {
  const listBase = normalizeBasePath(backHref);
  const isDashboardSurface = listBase.startsWith('/dashboard');
  const taskTypesHref = isDashboardSurface ? ('/dashboard/task-types' as Route) : null;
  const modeHref = taskFiltersHref(listBase, { mode: task.mode }) as Route;
  const pendingActions = 'pendingActions' in task ? task.pendingActions : [];
  const reviewAction =
    task.status === 'pending_approval' && (modeData?.submissions?.length ?? 0) > 0
      ? pendingActions.find((action) => action.action === 'accept')
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

  return (
    <div className="grid w-full min-w-0 gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="block w-full min-w-0 space-y-6">
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
        <section
          aria-label="Task metrics"
          className="grid overflow-hidden rounded-lg border border-border/58 bg-card/38 md:grid-cols-2"
        >
          <DetailMetric
            footerLabel="Due"
            footerValue={taskDeadlineLabel(task)}
            label="Reward"
            value={<span className="text-primary">{formatUsdcUnits(task.reward)}</span>}
          />
          <DetailMetric
            footerLabel="Status"
            footerValue={statusContext(task)}
            label={taskActivityTitle}
            value={activityLabel(task, modeData)}
          />
        </section>
        <section className="grid gap-5 border-t border-border/58 pt-5">
          <div>
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="flex flex-wrap items-center gap-2">
                <Link href={modeHref}>
                  <Badge className="hover:opacity-80">{task.mode}</Badge>
                </Link>
                <Badge variant="outline">{labelize(task.status)}</Badge>
                {task.auctionType ? (
                  <Badge variant="terminal">{labelize(task.auctionType)} auction</Badge>
                ) : null}
                {taskTypesHref ? (
                  <Link
                    className="font-mono text-xs uppercase text-muted-foreground hover:text-primary"
                    href={taskTypesHref}
                  >
                    How {task.mode} works
                  </Link>
                ) : null}
              </div>
              <span className="font-mono text-xs uppercase text-primary">
                {statusContext(task)}
              </span>
            </div>
            <h1 className="mt-3 font-display text-2xl font-semibold tracking-tight text-foreground">
              {taskTitle(task)}
            </h1>
          </div>
          <div className="grid gap-5">
            {descriptionBody ? (
              <p className="whitespace-pre-wrap text-sm leading-6 text-muted-foreground">
                {descriptionBody}
              </p>
            ) : null}
            {detailTags.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {detailTags.map((tag) => (
                  <Link href={taskFiltersHref(listBase, { tags: tag }) as Route} key={tag}>
                    <Badge className="hover:opacity-80" variant="terminal">
                      {tag}
                    </Badge>
                  </Link>
                ))}
              </div>
            ) : null}
          </div>
        </section>
        {reviewAction ? (
          <ModeDataPanel
            modeData={modeData}
            profileBasePath={profileBasePath}
            reviewAction={reviewAction}
            task={task}
          />
        ) : null}
        {showNextActions ? (
          <TaskActionsPanel
            claimedBy={task.claimedBy}
            emptyReason={pendingActionEmptyReason(task)}
            pendingActions={mainNextActions}
            requester={task.requester}
            task={task}
            worker={task.worker}
          />
        ) : null}
        <WorkRequirementsPanel task={task} />
        {!reviewAction ? (
          <ModeDataPanel modeData={modeData} profileBasePath={profileBasePath} task={task} />
        ) : null}
      </div>
      <aside aria-label="Task sidebar" className="grid h-fit gap-6 lg:sticky lg:top-20">
        <TaskSummaryRail profileBasePath={profileBasePath} task={task} />
        {cancelActions.length > 0 ? (
          <TaskActionsPanel
            claimedBy={task.claimedBy}
            emptyReason={pendingActionEmptyReason(task)}
            hideWhenNoVisibleActions
            pendingActions={cancelActions}
            requester={task.requester}
            task={task}
            title="Task controls"
            worker={task.worker}
          />
        ) : null}
      </aside>
    </div>
  );
}

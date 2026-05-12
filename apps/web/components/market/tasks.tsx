import type {
  ArtifactResponse,
  BidResponse,
  ClaimResponse,
  PitchResponse,
  ProofResponse,
  SubmissionResponse,
  TaskDetailResponse,
  TaskModeType,
  TaskResponse,
  TaskStatusType,
} from '@taskmarket/shared';
import type { ReactNode } from 'react';

import { ArtifactPreviewButton } from '@/components/market/artifact-preview-button';
import { TaskActionsPanel } from '@/components/market/task-actions-panel';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
import { compactAddress } from '@/lib/format';
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

function formatUsdc(value: string | null | undefined) {
  const parsed = Number(value ?? 0) / 1_000_000;
  if (!Number.isFinite(parsed)) {
    return '+0.000 USDC';
  }

  return `+${parsed.toFixed(3)} USDC`;
}

function labelize(value?: string | null) {
  return value ? value.replaceAll('_', ' ') : 'standard';
}

function formatDateTime(value?: string | null) {
  if (!value) {
    return 'Not set';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return 'Not set';
  }

  return date.toLocaleString();
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
    case 'accepted':
      return task.rating === null ? 'Payout accepted, rating pending' : 'Payout accepted';
    case 'completed':
      return 'Completed';
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
    case 'accepted':
      return task.rating === null
        ? 'The payout has been accepted. The requester can rate once a rating command is available.'
        : 'The payout and rating are complete.';
    case 'completed':
      return 'This task is complete.';
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
        <CardContent>
          <p className="font-mono text-sm text-destructive" role="alert">
            {errorMessage}
          </p>
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
                  <a href={listHref}>Clear filters</a>
                </Button>
              ) : null}
              <Button asChild>
                <a href={createHref}>Post task</a>
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="min-w-0 max-w-full overflow-hidden border-border/68 bg-card/92">
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
                <a
                  className="font-medium text-foreground hover:text-primary"
                  href={`${normalizeBasePath(detailBasePath)}/${encodeURIComponent(task.id)}`}
                >
                  {taskTitle(task)}
                </a>
                <div className="mt-2 flex flex-wrap gap-1">
                  {task.tags.slice(0, 3).map((tag) => (
                    <Badge key={tag} variant="terminal">
                      {tag}
                    </Badge>
                  ))}
                </div>
              </TableCell>
              <TableCell>
                <Badge variant={task.mode === 'auction' ? 'default' : 'outline'}>{task.mode}</Badge>
              </TableCell>
              <TableCell className="font-mono text-sm uppercase">{labelize(task.status)}</TableCell>
              <TableCell className="font-mono text-xs text-muted-foreground">
                {compactAddress(task.requester)}
              </TableCell>
              <TableCell className="text-right font-mono text-primary">
                {formatUsdc(task.reward)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}

export function TaskFilterRail({
  basePath = '/dashboard/tasks',
  deadlineHours = '',
  maxReward = '',
  minReward = '',
  selectedMode = 'ALL',
  selectedStatus = 'ALL',
  tags = '',
}: {
  basePath?: string;
  deadlineHours?: string;
  maxReward?: string;
  minReward?: string;
  selectedMode?: 'ALL' | TaskModeType | string;
  selectedStatus?: 'ALL' | TaskStatusType | string;
  tags?: string;
}) {
  const currentFilters: TaskSearchParams = {
    deadlineHours,
    maxReward,
    minReward,
    mode: selectedMode,
    status: selectedStatus,
    tags,
  };

  return (
    <aside className="grid gap-4 lg:sticky lg:top-20">
      <Card className="gap-4 border-border/68 bg-card/68 py-4 shadow-[var(--shadow-soft)]">
        <CardHeader className="px-4">
          <CardTitle className="text-sm">Task filters</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 px-4">
          <div className="grid gap-2">
            <p className="font-mono text-xs uppercase text-muted-foreground">Mode</p>
            <div className="grid grid-cols-2 gap-1">
              {modes.map((mode) => (
                <a
                  className="min-h-8 rounded-full border border-border/62 bg-background/35 px-2 py-2 text-center font-mono text-[0.68rem] uppercase transition-[background-color,border-color,color,box-shadow] duration-300 ease-[var(--ease-premium)] hover:border-primary/50 hover:bg-primary/10 hover:text-primary data-[active=true]:border-primary/58 data-[active=true]:bg-primary/14 data-[active=true]:text-primary data-[active=true]:shadow-[var(--shadow-control)]"
                  data-active={selectedMode === mode}
                  href={taskFiltersHref(basePath, currentFilters, { mode })}
                  key={mode}
                >
                  {mode === 'ALL' ? 'All modes' : labelize(mode)}
                </a>
              ))}
            </div>
          </div>
          <div className="grid gap-2">
            <p className="font-mono text-xs uppercase text-muted-foreground">Status</p>
            <div className="grid grid-cols-2 gap-1">
              {statuses.map((status) => (
                <a
                  className="min-h-8 rounded-full border border-border/62 bg-background/35 px-2 py-2 text-center font-mono text-[0.68rem] uppercase transition-[background-color,border-color,color,box-shadow] duration-300 ease-[var(--ease-premium)] hover:border-primary/50 hover:bg-primary/10 hover:text-primary data-[active=true]:border-primary/58 data-[active=true]:bg-primary/14 data-[active=true]:text-primary data-[active=true]:shadow-[var(--shadow-control)]"
                  data-active={selectedStatus === status}
                  href={taskFiltersHref(basePath, currentFilters, { status })}
                  key={status}
                >
                  {status === 'ALL' ? 'All statuses' : labelize(status)}
                </a>
              ))}
            </div>
          </div>
          <form action={normalizeBasePath(basePath)} className="grid gap-4">
            {selectedMode !== 'ALL' ? (
              <input name="mode" type="hidden" value={selectedMode} />
            ) : null}
            {selectedStatus !== 'ALL' ? (
              <input name="status" type="hidden" value={selectedStatus} />
            ) : null}
            <div className="grid gap-2">
              <Label htmlFor="task-filter-tags">Tags</Label>
              <Input
                defaultValue={tags}
                id="task-filter-tags"
                name="tags"
                placeholder="scrape, react"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="grid gap-2">
                <Label htmlFor="task-filter-min-reward">Min reward</Label>
                <Input
                  defaultValue={minReward}
                  id="task-filter-min-reward"
                  min="0"
                  name="minReward"
                  placeholder="2.00"
                  step="0.01"
                  type="number"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="task-filter-max-reward">Max reward</Label>
                <Input
                  defaultValue={maxReward}
                  id="task-filter-max-reward"
                  min="0"
                  name="maxReward"
                  placeholder="500"
                  step="0.01"
                  type="number"
                />
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="task-filter-deadline">Deadline hours</Label>
              <Input
                defaultValue={deadlineHours}
                id="task-filter-deadline"
                min="1"
                name="deadlineHours"
                placeholder="72"
                type="number"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Button type="submit" variant="terminal">
                Apply filters
              </Button>
              <Button asChild variant="outline">
                <a aria-label="Clear filters" href={normalizeBasePath(basePath)}>
                  Clear
                </a>
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </aside>
  );
}

export function TaskListPageContent({
  activeFilters,
  basePath = '/dashboard/tasks',
  createHref = '/dashboard/tasks/new',
  detailBasePath = '/dashboard/tasks',
  filterParams,
  listHref = '/dashboard/tasks',
  tasks,
}: {
  activeFilters: ActiveFilter[];
  basePath?: string;
  createHref?: string;
  detailBasePath?: string;
  filterParams: {
    deadlineHours?: string;
    maxReward?: string;
    minReward?: string;
    selectedMode: string;
    selectedStatus: string;
    tags?: string;
  };
  listHref?: string;
  tasks: TaskResponse[];
}) {
  return (
    <div className="@container/main grid w-full grid-cols-[minmax(0,1fr)] items-start gap-6 px-4 py-4 md:gap-6 md:py-6 lg:grid-cols-[280px_minmax(0,1fr)] lg:px-6">
      <TaskFilterRail
        basePath={basePath}
        deadlineHours={filterParams.deadlineHours}
        maxReward={filterParams.maxReward}
        minReward={filterParams.minReward}
        selectedMode={filterParams.selectedMode}
        selectedStatus={filterParams.selectedStatus}
        tags={filterParams.tags}
      />
      <section className="grid w-full min-w-0 max-w-full gap-5 overflow-hidden">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="font-mono text-xs uppercase text-primary">Tasks</p>
            <h1 className="mt-2 font-display text-4xl font-semibold tracking-tight">Open tasks</h1>
          </div>
          <Button asChild>
            <a href={createHref}>Post task</a>
          </Button>
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
              <a href={listHref}>Clear filters</a>
            </Button>
          </div>
        ) : null}
        <TaskTable
          createHref={createHref}
          detailBasePath={detailBasePath}
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

function ArtifactRow({ artifact, taskId }: { artifact: ArtifactResponse; taskId: string }) {
  const label = artifact.role !== 'attachment' ? artifact.role : null;
  return (
    <div className="rounded-xl border border-border/60 bg-muted/34 px-3 py-2 text-sm">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          {label ? <Badge variant="outline">{label}</Badge> : null}
          <span className="truncate font-mono">{artifact.fileName}</span>
          <span className="shrink-0 text-xs text-muted-foreground">{artifact.mimeType}</span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="font-mono text-xs text-muted-foreground">
            {compactAddress(artifact.workerAgentId ?? artifact.workerAddress)}
          </span>
          <ArtifactPreviewButton artifactId={artifact.id} taskId={taskId} />
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

function SubmissionCard({ submission }: { submission: SubmissionResponse }) {
  const artifacts: ArtifactResponse[] = submission.artifacts ?? [];
  return (
    <div className="rounded-xl border border-border/68 bg-background/52 p-3 shadow-[var(--shadow-soft)]">
      <div className="flex flex-wrap items-center justify-between gap-2 font-mono text-sm">
        <span>{compactAddress(submission.workerAgentId ?? submission.workerAddress)}</span>
        <span className="text-muted-foreground">
          {new Date(submission.submittedAt).toLocaleString()}
        </span>
      </div>
      {artifacts.length > 0 ? (
        <div className="mt-2 grid gap-1">
          {artifacts.map((artifact) => (
            <ArtifactRow artifact={artifact} key={artifact.id} taskId={submission.taskId} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ModeDataPanel({
  modeData,
  task,
}: {
  modeData?: TaskModeData;
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

  return (
    <Card className="border-border/68 bg-card/90">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="grid gap-1">
            <CardTitle>Activity</CardTitle>
            <p className="text-sm leading-5 text-muted-foreground">
              Work, bids, proofs, and reviews tied to this task.
            </p>
          </div>
          <Badge variant="terminal">{activityLabel(task, modeData)}</Badge>
        </div>
      </CardHeader>
      <CardContent className="grid gap-3">
        {submissions.map((submission) => (
          <SubmissionCard key={submission.id} submission={submission} />
        ))}

        {pitches.map((pitch) => (
          <div
            className="rounded-xl border border-border/68 bg-background/52 p-3 shadow-[var(--shadow-soft)]"
            key={pitch.id}
          >
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline">{pitch.status}</Badge>
              <span className="font-mono text-sm">{compactAddress(pitch.workerAddress)}</span>
            </div>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">{pitch.pitchText}</p>
          </div>
        ))}

        {proofs.map((proof) => (
          <div
            className="rounded-xl border border-border/68 bg-background/52 p-3 shadow-[var(--shadow-soft)]"
            key={proof.id}
          >
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
            className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/68 bg-background/52 p-3 font-mono text-sm shadow-[var(--shadow-soft)]"
            key={bid.id}
          >
            <span>{compactAddress(bid.workerAgentId ?? bid.workerAddress)}</span>
            <span className="text-primary">{formatUsdc(bid.price)}</span>
          </div>
        ))}

        {claim ? (
          <div className="grid gap-2 rounded-xl border border-border/68 bg-background/52 p-3 font-mono text-sm shadow-[var(--shadow-soft)]">
            <div className="flex justify-between gap-3">
              <span className="text-muted-foreground">Claim worker</span>
              <span>{compactAddress(claim.workerAddress)}</span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-muted-foreground">Claim stake</span>
              <span>{formatUsdc(claim.stakeAmount)}</span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-muted-foreground">Claim status</span>
              <span>{claim.status}</span>
            </div>
          </div>
        ) : null}

        {!hasActivity ? (
          <div className="rounded-xl border border-dashed border-border/68 bg-background/35 p-4">
            <p className="text-sm font-semibold tracking-tight text-foreground">No activity yet</p>
            <p className="mt-1 text-sm leading-5 text-muted-foreground">
              {activityEmptyCopy(task)}
            </p>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function DetailMetric({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="min-w-0 rounded-xl border border-border/60 bg-background/42 p-3">
      <p className="font-mono text-[0.68rem] uppercase text-muted-foreground">{label}</p>
      <div className="mt-1 truncate font-mono text-sm text-foreground">{value}</div>
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
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
  const rows: Array<{ label: string; value: ReactNode }> = [];

  if (task.mode === 'auction') {
    rows.push({
      label: 'Auction type',
      value: task.auctionType ? `${labelize(task.auctionType)} auction` : 'Auction',
    });
    if (task.bidDeadline) {
      rows.push({ label: 'Bid deadline', value: formatDateTime(task.bidDeadline) });
    }
    if (task.maxPrice) {
      rows.push({ label: 'Max price', value: formatUsdc(task.maxPrice) });
    }
  }

  if (task.mode === 'pitch' && task.pitchDeadline) {
    rows.push({ label: 'Pitch deadline', value: formatDateTime(task.pitchDeadline) });
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
    rows.push({ label: 'Stake', value: `${formatBps(task.stakeBps)} of reward` });
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
    <Card className="border-border/68 bg-card/90">
      <CardHeader>
        <CardTitle>Work requirements</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3">
        {rows.map((row) => (
          <div
            className="grid gap-1 rounded-xl border border-border/62 bg-background/42 p-3"
            key={row.label}
          >
            <p className="font-mono text-[0.68rem] uppercase text-muted-foreground">{row.label}</p>
            <div className="text-sm leading-6 text-foreground">{row.value}</div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function TaskSummaryRail({
  backHref,
  modeData,
  task,
}: {
  backHref: string;
  modeData?: TaskModeData;
  task: TaskDetailResponse | TaskResponse;
}) {
  return (
    <Card className="w-full gap-5 border-border/68 bg-card/90 lg:sticky lg:top-20">
      <CardHeader>
        <CardTitle>Task facts</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-5">
        <SummaryGroup title="Payout">
          <SummaryRow
            label="Reward"
            value={<span className="text-primary">{formatUsdc(task.reward)}</span>}
          />
          {task.maxPrice ? (
            <SummaryRow label="Max price" value={formatUsdc(task.maxPrice)} />
          ) : null}
          {task.currentAuctionPrice ? (
            <SummaryRow
              label="Clock price"
              value={<span className="text-primary">{formatUsdc(task.currentAuctionPrice)}</span>}
            />
          ) : null}
          {task.currentLowestBid ? (
            <SummaryRow label="Lowest bid" value={formatUsdc(task.currentLowestBid)} />
          ) : null}
          {task.auctionStartPrice ? (
            <SummaryRow label="Start price" value={formatUsdc(task.auctionStartPrice)} />
          ) : null}
          {task.auctionFloorPrice ? (
            <SummaryRow label="Floor price" value={formatUsdc(task.auctionFloorPrice)} />
          ) : null}
          <SummaryRow label="Platform fee" value={formatBps(task.platformFeeBps)} />
        </SummaryGroup>

        <SummaryGroup title="Timing">
          <SummaryRow label="Created" value={formatDateTime(task.createdAt)} />
          <SummaryRow
            label={
              task.mode === 'auction'
                ? 'Bid deadline'
                : task.mode === 'pitch'
                  ? 'Pitch deadline'
                  : 'Expiry'
            }
            value={taskDeadlineLabel(task)}
          />
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

        <SummaryGroup title="Participants">
          <SummaryRow
            label="Requester"
            value={compactAddress(task.requesterAgentId ?? task.requester)}
          />
          {task.worker || task.claimedBy ? (
            <SummaryRow
              label="Worker"
              value={compactAddress(task.workerAgentId ?? task.worker ?? task.claimedBy)}
            />
          ) : null}
        </SummaryGroup>

        <SummaryGroup title="Progress">
          <SummaryRow label="Status" value={labelize(task.status)} />
          <SummaryRow label="Activity" value={activityLabel(task, modeData)} />
          {task.rating !== null ? <SummaryRow label="Rating" value={`${task.rating}/100`} /> : null}
          {task.stakeRequired || task.stakeBps > 0 ? (
            <SummaryRow label="Stake required" value={formatBps(task.stakeBps)} />
          ) : null}
        </SummaryGroup>

        <Button asChild className="mt-1" variant="terminal">
          <a href={backHref}>Back to tasks</a>
        </Button>
      </CardContent>
    </Card>
  );
}

export function TaskDetailPanel({
  backHref = '/dashboard/tasks',
  modeData,
  task,
}: {
  backHref?: string;
  modeData?: TaskModeData;
  task: TaskDetailResponse | TaskResponse;
}) {
  const pendingActions = 'pendingActions' in task ? task.pendingActions : [];

  return (
    <div className="grid w-full gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="block w-full min-w-0 space-y-6">
        <Card className="w-full border-border/68 bg-card/90">
          <CardHeader>
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="flex flex-wrap gap-2">
                <Badge>{task.mode}</Badge>
                <Badge variant="outline">{labelize(task.status)}</Badge>
                {task.auctionType ? (
                  <Badge variant="terminal">{labelize(task.auctionType)} auction</Badge>
                ) : null}
              </div>
              <span className="font-mono text-xs uppercase text-primary">
                {statusContext(task)}
              </span>
            </div>
            <CardTitle className="mt-3 text-2xl">{taskTitle(task)}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-5">
            <p className="whitespace-pre-wrap text-sm leading-6 text-muted-foreground">
              {task.description}
            </p>
            {task.tags.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {task.tags.map((tag) => (
                  <Badge key={tag} variant="terminal">
                    {tag}
                  </Badge>
                ))}
              </div>
            ) : null}
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
              <DetailMetric
                label="Reward"
                value={<span className="text-primary">{formatUsdc(task.reward)}</span>}
              />
              <DetailMetric label="Due" value={taskDeadlineLabel(task)} />
              <DetailMetric label="Activity" value={activityLabel(task, modeData)} />
              <DetailMetric
                label="Requester"
                value={compactAddress(task.requesterAgentId ?? task.requester)}
              />
            </div>
          </CardContent>
        </Card>
        <TaskActionsPanel
          claimedBy={task.claimedBy}
          emptyReason={pendingActionEmptyReason(task)}
          pendingActions={pendingActions}
          requester={task.requester}
          task={task}
          worker={task.worker}
        />
        <WorkRequirementsPanel task={task} />
        <ModeDataPanel modeData={modeData} task={task} />
      </div>
      <TaskSummaryRail backHref={backHref} modeData={modeData} task={task} />
    </div>
  );
}

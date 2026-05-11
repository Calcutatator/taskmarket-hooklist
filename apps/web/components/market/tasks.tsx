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

import { ArtifactPreviewButton } from '@/components/market/artifact-preview-button';
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

function normalizeBasePath(basePath: string) {
  return basePath.replace(/\/+$/, '') || '/';
}

function hrefForFilters(mode?: string, status?: string, basePath = '/dashboard/tasks') {
  const params = new URLSearchParams();
  if (mode && mode !== 'ALL') {
    params.set('mode', mode);
  }
  if (status && status !== 'ALL') {
    params.set('status', status);
  }

  const query = params.toString();
  const normalized = normalizeBasePath(basePath);
  return query ? `${normalized}?${query}` : normalized;
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
          <CardTitle>Loading marketplace rows</CardTitle>
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
      <Card className="w-full border-dashed bg-surface/50 py-10 shadow-none">
        <CardContent className="flex items-center justify-center">
          <div className="grid max-w-md gap-4 text-center">
            <div className="grid gap-2">
              <p className="font-mono text-sm font-semibold uppercase text-foreground">
                {hasActiveFilters ? 'No tasks match these filters' : 'No open tasks yet'}
              </p>
              <p className="text-sm text-muted-foreground">
                {hasActiveFilters
                  ? 'Try clearing filters or post the first task for this market.'
                  : 'Post the first task to seed the marketplace.'}
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
    <Card className="min-w-0 max-w-full overflow-hidden">
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
  return (
    <aside className="grid gap-4 lg:sticky lg:top-20">
      <Card className="gap-4 bg-surface/45 py-4 shadow-none">
        <CardHeader className="px-4">
          <CardTitle className="text-sm">Filters</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 px-4">
          <div className="grid gap-2">
            <p className="font-mono text-xs uppercase text-muted-foreground">Mode</p>
            <div className="grid grid-cols-2 gap-1">
              {modes.map((mode) => (
                <a
                  className="min-h-8 rounded-md border border-border/70 px-2 py-2 text-center font-mono text-[0.68rem] uppercase transition-colors hover:border-primary/60 hover:bg-primary/10 hover:text-primary data-[active=true]:border-primary/70 data-[active=true]:bg-primary/15 data-[active=true]:text-primary"
                  data-active={selectedMode === mode}
                  href={hrefForFilters(mode, selectedStatus, basePath)}
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
                  className="min-h-8 rounded-md border border-border/70 px-2 py-2 text-center font-mono text-[0.68rem] uppercase transition-colors hover:border-primary/60 hover:bg-primary/10 hover:text-primary data-[active=true]:border-primary/70 data-[active=true]:bg-primary/15 data-[active=true]:text-primary"
                  data-active={selectedStatus === status}
                  href={hrefForFilters(selectedMode, status, basePath)}
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
                Apply
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

export function CreateTaskPanel({ walletConnected }: { walletConnected: boolean }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Post work</CardTitle>
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
    <div className="rounded border border-border/60 bg-muted/40 px-3 py-2 text-sm">
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
          <pre className="mt-1 overflow-auto rounded bg-background p-2 font-mono text-xs leading-5 text-foreground">
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
    <div className="rounded-md border border-border/80 bg-background/60 p-3">
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
  const pendingActions = 'pendingActions' in task ? task.pendingActions : [];

  return (
    <div className="grid gap-6">
      {submissions.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Submissions</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3">
            {submissions.map((submission) => (
              <SubmissionCard key={submission.id} submission={submission} />
            ))}
          </CardContent>
        </Card>
      ) : null}

      {pitches.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Pitches</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3">
            {pitches.map((pitch) => (
              <div
                className="rounded-md border border-border/80 bg-background/60 p-3"
                key={pitch.id}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">{pitch.status}</Badge>
                  <span className="font-mono text-sm">{compactAddress(pitch.workerAddress)}</span>
                </div>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">{pitch.pitchText}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      {proofs.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Proofs</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3">
            {proofs.map((proof) => (
              <div
                className="rounded-md border border-border/80 bg-background/60 p-3"
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
          </CardContent>
        </Card>
      ) : null}

      {bids.length > 0 ? (
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <CardTitle>Auction bids</CardTitle>
              <div className="grid gap-1 text-right font-mono text-xs text-muted-foreground">
                {'currentLowestBid' in task && task.currentLowestBid ? (
                  <span>Lowest bid: {formatUsdc(task.currentLowestBid)}</span>
                ) : null}
                {'bidDeadline' in task && task.bidDeadline ? (
                  <span>Deadline: {new Date(task.bidDeadline).toLocaleString()}</span>
                ) : null}
              </div>
            </div>
          </CardHeader>
          <CardContent className="grid gap-3">
            {bids.map((bid) => (
              <div
                className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border/80 bg-background/60 p-3 font-mono text-sm"
                key={bid.id}
              >
                <span>{compactAddress(bid.workerAgentId ?? bid.workerAddress)}</span>
                <span className="text-primary">{formatUsdc(bid.price)}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      {claim ? (
        <Card>
          <CardHeader>
            <CardTitle>Claim</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2 font-mono text-sm">
            <div className="flex justify-between gap-3">
              <span className="text-muted-foreground">Worker</span>
              <span>{compactAddress(claim.workerAddress)}</span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-muted-foreground">Stake</span>
              <span>{formatUsdc(claim.stakeAmount)}</span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-muted-foreground">Status</span>
              <span>{claim.status}</span>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {pendingActions.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Pending actions</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3">
            {pendingActions.map((action) => (
              <pre
                className="overflow-x-auto rounded-md border border-border/80 bg-background/60 p-3 font-mono text-xs text-muted-foreground"
                key={`${action.role}-${action.action}`}
              >
                <code>{action.command}</code>
              </pre>
            ))}
          </CardContent>
        </Card>
      ) : null}
    </div>
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
  const hasModeContent =
    (modeData?.submissions?.length ?? 0) > 0 ||
    (modeData?.pitches?.length ?? 0) > 0 ||
    (modeData?.proofs?.length ?? 0) > 0 ||
    (modeData?.bids?.length ?? 0) > 0 ||
    modeData?.claim != null ||
    ('pendingActions' in task && task.pendingActions.length > 0);

  return (
    <div
      className={
        hasModeContent ? 'grid w-full gap-6 lg:grid-cols-[minmax(0,1fr)_320px]' : 'w-full space-y-6'
      }
    >
      <div className="block w-full min-w-0 space-y-6">
        <Card className="w-full">
          <CardHeader>
            <div className="flex flex-wrap gap-2">
              <Badge>{task.mode}</Badge>
              <Badge variant="outline">{labelize(task.status)}</Badge>
              {task.auctionType ? (
                <Badge variant="terminal">{labelize(task.auctionType)} auction</Badge>
              ) : null}
            </div>
            <CardTitle className="mt-3 text-2xl">{taskTitle(task)}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="whitespace-pre-wrap text-sm leading-6 text-muted-foreground">
              {task.description}
            </p>
          </CardContent>
        </Card>
        <ModeDataPanel modeData={modeData} task={task} />
      </div>
      <Card className="w-full">
        <CardHeader>
          <CardTitle>Settlement</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 font-mono text-sm">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Reward</span>
            <span className="text-primary">{formatUsdc(task.reward)}</span>
          </div>
          {'maxPrice' in task && task.maxPrice ? (
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Max price</span>
              <span>{formatUsdc(task.maxPrice)}</span>
            </div>
          ) : null}
          {'currentAuctionPrice' in task && task.currentAuctionPrice ? (
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Clock price</span>
              <span className="text-primary">{formatUsdc(task.currentAuctionPrice)}</span>
            </div>
          ) : null}
          {'auctionFloorPrice' in task && task.auctionFloorPrice ? (
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Floor price</span>
              <span>{formatUsdc(task.auctionFloorPrice)}</span>
            </div>
          ) : null}
          {'auctionStartPrice' in task && task.auctionStartPrice ? (
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Start price</span>
              <span>{formatUsdc(task.auctionStartPrice)}</span>
            </div>
          ) : null}
          {'bidDeadline' in task && task.bidDeadline ? (
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Bid deadline</span>
              <span>{new Date(task.bidDeadline).toLocaleDateString()}</span>
            </div>
          ) : null}
          {'pitchDeadline' in task && task.pitchDeadline ? (
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Pitch deadline</span>
              <span>{new Date(task.pitchDeadline).toLocaleDateString()}</span>
            </div>
          ) : null}
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Requester</span>
            <span title={task.requester}>
              {compactAddress(task.requesterAgentId ?? task.requester)}
            </span>
          </div>
          {'worker' in task && task.worker ? (
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Worker</span>
              <span title={task.worker}>{compactAddress(task.workerAgentId ?? task.worker)}</span>
            </div>
          ) : null}
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Submissions</span>
            <span>{task.submissionCount ?? 0}</span>
          </div>
          <Button asChild className="mt-3" variant="terminal">
            <a href={backHref}>Back to tasks</a>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

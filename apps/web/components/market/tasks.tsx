import type {
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

function hrefForFilters(mode?: string, status?: string) {
  const params = new URLSearchParams();
  if (mode && mode !== 'ALL') {
    params.set('mode', mode);
  }
  if (status && status !== 'ALL') {
    params.set('status', status);
  }

  const query = params.toString();
  return query ? `/dashboard/tasks?${query}` : '/dashboard/tasks';
}

export function TaskTable({
  errorMessage,
  isLoading,
  tasks,
}: {
  errorMessage?: string;
  isLoading?: boolean;
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
      <Card className="min-h-80 w-full justify-center">
        <CardContent className="flex min-h-64 items-center justify-center">
          <div className="grid max-w-sm gap-2 text-center">
            <p className="font-mono text-sm uppercase text-muted-foreground">No tasks found</p>
            <p className="text-sm text-muted-foreground">
              Clear the filters or post a new task to seed the marketplace.
            </p>
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
                  href={`/dashboard/tasks/${task.id}`}
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
  deadlineHours = '',
  maxReward = '',
  minReward = '',
  selectedMode = 'ALL',
  selectedStatus = 'ALL',
  tags = '',
}: {
  deadlineHours?: string;
  maxReward?: string;
  minReward?: string;
  selectedMode?: 'ALL' | TaskModeType | string;
  selectedStatus?: 'ALL' | TaskStatusType | string;
  tags?: string;
}) {
  return (
    <aside className="grid gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Filters</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-5">
          <div className="grid gap-2">
            <p className="font-mono text-xs uppercase text-muted-foreground">Mode</p>
            <div className="grid gap-1">
              {modes.map((mode) => (
                <a
                  className="rounded-md border border-border/80 px-3 py-2 font-mono text-xs uppercase transition-colors hover:border-primary/70 hover:bg-primary/10 hover:text-primary data-[active=true]:border-primary/70 data-[active=true]:bg-primary data-[active=true]:text-primary-foreground"
                  data-active={selectedMode === mode}
                  href={hrefForFilters(mode, selectedStatus)}
                  key={mode}
                >
                  {mode === 'ALL' ? 'All modes' : labelize(mode)}
                </a>
              ))}
            </div>
          </div>
          <div className="grid gap-2">
            <p className="font-mono text-xs uppercase text-muted-foreground">Status</p>
            <div className="grid gap-1">
              {statuses.map((status) => (
                <a
                  className="rounded-md border border-border/80 px-3 py-2 font-mono text-xs uppercase transition-colors hover:border-primary/70 hover:bg-primary/10 hover:text-primary data-[active=true]:border-primary/70 data-[active=true]:bg-primary data-[active=true]:text-primary-foreground"
                  data-active={selectedStatus === status}
                  href={hrefForFilters(selectedMode, status)}
                  key={status}
                >
                  {status === 'ALL' ? 'All statuses' : labelize(status)}
                </a>
              ))}
            </div>
          </div>
          <form action="/dashboard/tasks" className="grid gap-4">
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
            <Button type="submit" variant="terminal">
              Apply filters
            </Button>
          </form>
          <Button asChild variant="outline">
            <a href="/dashboard/tasks">Clear filters</a>
          </Button>
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
              <div
                className="rounded-md border border-border/80 bg-background/60 p-3"
                key={submission.id}
              >
                <div className="flex flex-wrap items-center justify-between gap-2 font-mono text-sm">
                  <span>{compactAddress(submission.workerAddress)}</span>
                  <span className="text-muted-foreground">
                    {new Date(submission.submittedAt).toLocaleString()}
                  </span>
                </div>
                <a className="mt-2 block break-all text-sm text-primary" href={submission.fileUrl}>
                  {submission.fileUrl}
                </a>
              </div>
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
            <CardTitle>Auction bids</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3">
            {bids.map((bid) => (
              <div
                className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border/80 bg-background/60 p-3 font-mono text-sm"
                key={bid.id}
              >
                <span>{compactAddress(bid.workerAddress)}</span>
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
  modeData,
  task,
}: {
  modeData?: TaskModeData;
  task: TaskDetailResponse | TaskResponse;
}) {
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
      <div className="grid gap-6">
        <Card>
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
      <Card>
        <CardHeader>
          <CardTitle>Settlement</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 font-mono text-sm">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Reward</span>
            <span className="text-primary">{formatUsdc(task.reward)}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Requester</span>
            <span>{compactAddress(task.requester)}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Submissions</span>
            <span>{task.submissionCount ?? 0}</span>
          </div>
          <Button asChild className="mt-3" variant="terminal">
            <a href="/dashboard/tasks">Back to tasks</a>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

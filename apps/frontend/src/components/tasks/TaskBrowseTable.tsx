import { Link } from '@tanstack/react-router';
import type { TaskResponse } from '@taskmarket/shared';
import { Button } from '@/components/ui/button';
import { formatUSDC } from '@/lib/format';
import { TerminalChip } from '@/components/landing/terminal';
import { cn } from '@/lib/utils';

interface TaskBrowseTableProps {
  tasks: TaskResponse[];
  isLoading?: boolean;
  errorMessage?: string;
  hasNextPage?: boolean;
  isFetchingNextPage?: boolean;
  onLoadMore?: () => void;
}

function displayId(taskId: string) {
  if (taskId.startsWith('TM-')) return taskId;
  return `${taskId.slice(0, 6)}...${taskId.slice(-4)}`;
}

function primaryTag(task: TaskResponse) {
  return task.tags[0] ?? task.mode;
}

function requesterLabel(task: TaskResponse) {
  if (task.requesterAgentId) return task.requesterAgentId;
  return `${task.requester.slice(0, 6)}...${task.requester.slice(-4)}`;
}

function bidCount(task: TaskResponse) {
  if (task.mode === 'auction') return task.auctionBidCount ?? 0;
  if (task.mode === 'pitch') return task.pitchCount;
  return task.submissionCount;
}

function modeLabel(task: TaskResponse) {
  return task.auctionType ?? task.mode;
}

function timeLeft(expiryTime: string) {
  const diffMs = new Date(expiryTime).getTime() - Date.now();
  if (diffMs <= 0) return 'expired';
  const diffMins = Math.floor(diffMs / 60_000);
  const diffHours = Math.floor(diffMs / 3_600_000);
  const diffDays = Math.floor(diffMs / 86_400_000);
  if (diffDays >= 1) return `${diffDays}d ${diffHours - diffDays * 24}h`;
  if (diffHours >= 1) return `${diffHours}h`;
  return `${Math.max(1, diffMins)}m`;
}

function statusTone(task: TaskResponse) {
  if (task.status === 'open') return 'success' as const;
  if (task.status === 'claimed' || task.status === 'worker_selected') return 'warning' as const;
  if (task.status === 'disputed' || task.status === 'expired') return 'error' as const;
  return 'accent' as const;
}

export function TaskBrowseTable({
  tasks,
  isLoading,
  errorMessage,
  hasNextPage,
  isFetchingNextPage,
  onLoadMore,
}: TaskBrowseTableProps) {
  if (isLoading) {
    return (
      <div className="tm-panel p-5" aria-live="polite">
        <p className="tm-muted font-mono text-xs uppercase tracking-[0.16em]">
          Loading marketplace rows
        </p>
        <div className="mt-4 space-y-2">
          {[0, 1, 2, 3, 4, 5].map((row) => (
            <div key={row} className="tm-skeleton h-12" />
          ))}
        </div>
      </div>
    );
  }

  if (errorMessage) {
    return (
      <div className="border border-state-error-border bg-state-error-bg p-5">
        <p className="font-mono text-sm text-state-error-text">{errorMessage}</p>
      </div>
    );
  }

  if (tasks.length === 0) {
    return (
      <div className="tm-panel p-8">
        <p className="tm-muted font-mono text-sm">No tasks found for these filters.</p>
      </div>
    );
  }

  return (
    <div className="tm-panel overflow-hidden">
      <div className="tm-table-head hidden grid-cols-[86px_86px_minmax(260px,1fr)_112px_72px_120px_132px_84px_112px] gap-3 px-4 py-3 xl:grid">
        <span>id</span>
        <span>tag</span>
        <span>spec</span>
        <span className="text-right">reward</span>
        <span>bids</span>
        <span>mode</span>
        <span>requester</span>
        <span>ttl</span>
        <span />
      </div>
      <div className="divide-y divide-border-primary">
        {tasks.map((task) => (
          <div
            key={task.id}
            className="tm-row grid gap-3 px-4 py-4 xl:grid-cols-[86px_86px_minmax(260px,1fr)_112px_72px_120px_132px_84px_112px] xl:items-center"
          >
            <Link
              to="/tasks/$taskId"
              params={{ taskId: task.id }}
              className="tm-faint font-mono text-xs hover:text-button-primary-bg"
            >
              {displayId(task.id)}
            </Link>
            <TerminalChip>{primaryTag(task)}</TerminalChip>
            <div className="min-w-0">
              <p className="truncate font-mono text-sm text-text-primary">{task.description}</p>
              <p className="tm-faint mt-1 font-mono text-[11px] xl:hidden">
                {modeLabel(task)} / {requesterLabel(task)} / {timeLeft(task.expiryTime)}
              </p>
            </div>
            <span className="tm-reward font-mono text-sm font-medium xl:text-right">
              +{formatUSDC(task.reward)}
            </span>
            <span className="tm-muted font-mono text-xs">{bidCount(task)}</span>
            <span className="tm-muted font-mono text-xs">{modeLabel(task)}</span>
            <span className="tm-muted font-mono text-xs">{requesterLabel(task)}</span>
            <span
              className={cn(
                'font-mono text-xs',
                task.status === 'expired' ? 'tm-danger' : 'tm-muted'
              )}
            >
              {timeLeft(task.expiryTime)}
            </span>
            <div className="flex justify-start xl:justify-end">
              <Button
                asChild
                size="sm"
                className="tm-btn-primary h-8 rounded-none px-3 font-mono text-[11px] uppercase tracking-[0.08em]"
              >
                <Link
                  to="/tasks/$taskId"
                  params={{ taskId: task.id }}
                  aria-label={`${task.status === 'open' ? 'Accept' : 'View'} ${displayId(task.id)}`}
                >
                  {task.status === 'open' ? 'Accept' : 'View'}
                </Link>
              </Button>
            </div>
            <span className="sr-only">{statusTone(task)}</span>
          </div>
        ))}
      </div>
      {hasNextPage && onLoadMore && (
        <div className="tm-divider border-t p-4 text-center">
          <Button
            variant="outline"
            onClick={onLoadMore}
            disabled={isFetchingNextPage}
            className="tm-btn-outline rounded-none font-mono text-xs uppercase tracking-[0.08em]"
          >
            {isFetchingNextPage ? 'Loading...' : 'Load more'}
          </Button>
        </div>
      )}
    </div>
  );
}

import type { TaskResponse } from '@taskmarket/shared';
import { formatUSDC } from '@/lib/format';
import { TerminalChip, StatusDot } from './terminal';

interface LiveTaskFeedProps {
  tasks: TaskResponse[];
  isLoading?: boolean;
  errorMessage?: string;
}

function primaryTag(task: TaskResponse) {
  return task.tags[0] ?? task.mode;
}

function requesterLabel(task: TaskResponse) {
  if (task.requesterAgentId) return task.requesterAgentId;
  return `${task.requester.slice(0, 6)}...${task.requester.slice(-4)}`;
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

export function LiveTaskFeed({ tasks, isLoading, errorMessage }: LiveTaskFeedProps) {
  if (isLoading) {
    return (
      <div className="tm-panel p-4" aria-live="polite">
        <p className="tm-muted font-mono text-xs uppercase tracking-[0.16em]">Loading open tasks</p>
        <div className="mt-4 space-y-2">
          {[0, 1, 2, 3].map((row) => (
            <div key={row} className="tm-skeleton h-11" />
          ))}
        </div>
      </div>
    );
  }

  if (errorMessage) {
    return (
      <div className="border border-state-error-border bg-state-error-bg p-4">
        <p className="font-mono text-sm text-state-error-text">{errorMessage}</p>
      </div>
    );
  }

  if (tasks.length === 0) {
    return (
      <div className="tm-panel p-6">
        <p className="tm-muted font-mono text-sm">No open tasks matched this feed.</p>
      </div>
    );
  }

  return (
    <div className="tm-panel overflow-hidden">
      <div className="tm-table-head hidden grid-cols-[86px_110px_minmax(240px,1fr)_120px_140px_80px] gap-3 px-4 py-3 lg:grid">
        <span>tag</span>
        <span>reward</span>
        <span>spec</span>
        <span>mode</span>
        <span>requester</span>
        <span className="text-right">ttl</span>
      </div>
      <div className="divide-y divide-border-primary">
        {tasks.map((task) => (
          <a
            key={task.id}
            href={`/tasks/${task.id}`}
            className="tm-row grid gap-3 px-4 py-4 lg:grid-cols-[86px_110px_minmax(240px,1fr)_120px_140px_80px] lg:items-center"
          >
            <div className="flex items-center justify-between gap-3 lg:block">
              <TerminalChip>{primaryTag(task)}</TerminalChip>
              <span className="tm-faint font-mono text-xs lg:hidden">
                {timeLeft(task.expiryTime)}
              </span>
            </div>
            <span className="tm-reward font-mono text-sm font-medium">
              +{formatUSDC(task.reward)} USDC
            </span>
            <span className="min-w-0 truncate font-mono text-sm text-text-primary">
              {task.description}
            </span>
            <span className="tm-muted font-mono text-xs">{modeLabel(task)}</span>
            <span className="tm-muted font-mono text-xs">{requesterLabel(task)}</span>
            <span className="tm-muted hidden text-right font-mono text-xs lg:block">
              {timeLeft(task.expiryTime)}
            </span>
            <span className="sr-only">
              <StatusDot tone="success" /> open
            </span>
          </a>
        ))}
      </div>
    </div>
  );
}

import { Link } from '@tanstack/react-router';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { Badge } from './ui/badge';
import type { TaskResponse } from '@taskmarket/shared';
import { formatUSDC } from '@/lib/format';
import { IdentityBadge } from './IdentityBadge';
import { getStatusVariant } from '@/lib/status';
import { BracketCard } from './ui/bracket-card';

interface TaskCardProps {
  task: TaskResponse;
}

export function TaskCard({ task }: TaskCardProps) {
  const expiryDate = new Date(task.expiryTime);
  const diffMs = expiryDate.getTime() - Date.now();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);
  const timeLeft =
    diffMs <= 0
      ? 'Expired'
      : diffDays >= 1
        ? `${diffDays}d ${diffHours - diffDays * 24}h left`
        : diffHours >= 1
          ? `${diffHours}h left`
          : `${Math.max(1, diffMins)}m left`;

  const modeVariant = task.mode as 'bounty' | 'claim' | 'pitch' | 'benchmark' | 'auction';

  return (
    <Link to="/tasks/$taskId" params={{ taskId: task.id }} className="h-full">
      <BracketCard className="h-full">
        <Card className="flex h-full cursor-pointer flex-col transition-colors hover:border-border-accent">
          <CardHeader className="flex-1">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap gap-2">
                <Badge variant={modeVariant}>{task.mode}</Badge>
                <Badge variant={getStatusVariant(task.status)}>
                  {task.status.replace(/_/g, ' ')}
                </Badge>
              </div>
              {task.mode === 'claim' && task.claimedBy && <Badge variant="warning">Claimed</Badge>}
            </div>
            <CardTitle className="text-lg leading-snug line-clamp-2">{task.description}</CardTitle>
            <CardDescription className="flex flex-wrap gap-x-2 gap-y-1">
              {task.tags.map((tag) => (
                <span key={tag}>#{tag}</span>
              ))}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-2xl font-bold">{formatUSDC(task.reward)} USDC</p>
                <p className="text-sm text-text-secondary">{timeLeft}</p>
              </div>
              {task.mode === 'pitch' && task.pitchCount > 0 && (
                <p className="text-right text-sm text-text-secondary">{task.pitchCount} pitches</p>
              )}
              {(task.mode === 'bounty' || task.mode === 'benchmark') &&
                task.submissionCount > 0 && (
                  <p className="text-right text-sm text-text-secondary">
                    {task.submissionCount} submissions
                  </p>
                )}
              {task.mode === 'auction' && task.maxPrice && (
                <p className="text-right text-sm text-text-secondary">
                  max {formatUSDC(task.maxPrice)} USDC
                </p>
              )}
            </div>
            <div className="text-xs">
              <IdentityBadge
                agentId={task.requesterAgentId}
                address={task.requester}
                linkable={false}
              />
            </div>
          </CardContent>
        </Card>
      </BracketCard>
    </Link>
  );
}

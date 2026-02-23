import { Link } from '@tanstack/react-router';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { Badge } from './ui/badge';
import type { TaskResponse } from '@taskmarket/shared';
import { formatUSDC } from '@/lib/format';

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
      <Card className="h-full hover:border-border-accent transition-colors cursor-pointer flex flex-col relative overflow-visible">
        {/* Top-left corner bracket */}
        <span className="absolute -top-px -left-px w-2.5 h-2.5 border-t border-l border-sidebar-item-active pointer-events-none" />
        {/* Bottom-right corner bracket */}
        <span className="absolute -bottom-px -right-px w-2.5 h-2.5 border-b border-r border-sidebar-item-active pointer-events-none" />
        <CardHeader className="flex-1">
          <div className="flex items-center justify-between mb-2">
            <Badge variant={modeVariant}>{task.mode}</Badge>
            <Badge variant={task.status === 'open' ? 'success' : 'default'}>{task.status}</Badge>
          </div>
          <CardTitle className="text-lg line-clamp-2">{task.description}</CardTitle>
          <CardDescription>
            {task.tags.map((tag) => (
              <span key={tag} className="mr-2">
                #{tag}
              </span>
            ))}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-2xl font-bold">{formatUSDC(task.reward)} USDC</p>
              <p className="text-sm text-text-secondary">{timeLeft}</p>
            </div>
            {task.mode === 'claim' && task.claimedBy && <Badge variant="warning">Claimed</Badge>}
            {task.mode === 'pitch' && task.pitchCount > 0 && (
              <p className="text-sm text-text-secondary">{task.pitchCount} pitches</p>
            )}
            {(task.mode === 'bounty' || task.mode === 'benchmark') && task.submissionCount > 0 && (
              <p className="text-sm text-text-secondary">{task.submissionCount} submissions</p>
            )}
            {task.mode === 'auction' && task.maxPrice && (
              <p className="text-sm text-text-secondary">max {formatUSDC(task.maxPrice)} USDC</p>
            )}
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

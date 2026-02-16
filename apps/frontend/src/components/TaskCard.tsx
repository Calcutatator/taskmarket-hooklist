import { Link } from '@tanstack/react-router';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { Badge } from './ui/badge';
import type { TaskResponse } from '@clawtasker/shared';

interface TaskCardProps {
  task: TaskResponse;
}

export function TaskCard({ task }: TaskCardProps) {
  const expiryDate = new Date(task.expiryTime);
  const now = new Date();
  const hoursLeft = Math.max(0, Math.floor((expiryDate.getTime() - now.getTime()) / (1000 * 60 * 60)));

  const modeVariant = task.mode as 'contest' | 'instant' | 'proposal' | 'race';

  return (
    <Link to="/tasks/$taskId" params={{ taskId: task.id }}>
      <Card className="hover:border-border-accent transition-colors cursor-pointer">
        <CardHeader>
          <div className="flex items-center justify-between mb-2">
            <Badge variant={modeVariant}>{task.mode}</Badge>
            <Badge variant={task.status === 'open' ? 'success' : 'default'}>{task.status}</Badge>
          </div>
          <CardTitle className="text-lg line-clamp-2">{task.description.substring(0, 80)}</CardTitle>
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
              <p className="text-2xl font-bold">{(Number(task.reward) / 1e6).toFixed(2)} USDC</p>
              <p className="text-sm text-text-secondary">
                {hoursLeft > 0 ? `${hoursLeft}h left` : 'Expired'}
              </p>
            </div>
            {task.mode === 'instant' && task.claimedBy && (
              <Badge variant="warning">Claimed</Badge>
            )}
            {task.mode === 'proposal' && task.proposalCount > 0 && (
              <p className="text-sm text-text-secondary">{task.proposalCount} proposals</p>
            )}
            {(task.mode === 'contest' || task.mode === 'race') && task.submissionCount > 0 && (
              <p className="text-sm text-text-secondary">{task.submissionCount} submissions</p>
            )}
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

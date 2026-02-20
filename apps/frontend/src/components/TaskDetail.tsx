import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { Badge } from './ui/badge';
import { Separator } from './ui/separator';
import type { TaskResponse } from '@clawtasker/shared';
import { formatUSDC } from '@/lib/format';

interface TaskDetailProps {
  task: TaskResponse;
}

export function TaskDetail({ task }: TaskDetailProps) {
  const modeVariant = task.mode as 'contest' | 'instant' | 'proposal' | 'race';
  const expiryDate = new Date(task.expiryTime);
  const createdDate = new Date(task.createdAt);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2 mb-2">
          <Badge variant={modeVariant}>{task.mode}</Badge>
          <Badge variant={task.status === 'open' ? 'success' : 'default'}>{task.status}</Badge>
        </div>
        <CardTitle className="text-2xl">Task Details</CardTitle>
        <CardDescription>
          Created by {task.requester.substring(0, 6)}...{task.requester.substring(38)}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <h3 className="font-semibold mb-2">Description</h3>
          <p className="text-text-secondary whitespace-pre-wrap">{task.description}</p>
        </div>

        <Separator />

        <div className="grid grid-cols-2 gap-4">
          <div>
            <h3 className="font-semibold text-sm mb-1">Reward</h3>
            <p className="text-2xl font-bold text-state-success-primary">
              {formatUSDC(task.reward)} USDC
            </p>
          </div>

          <div>
            <h3 className="font-semibold text-sm mb-1">Platform Fee</h3>
            <p className="text-lg">{(task.platformFeeBps / 100).toFixed(1)}%</p>
          </div>

          <div>
            <h3 className="font-semibold text-sm mb-1">Created</h3>
            <p className="text-sm text-text-secondary">{createdDate.toLocaleString()}</p>
          </div>

          <div>
            <h3 className="font-semibold text-sm mb-1">Expires</h3>
            <p className="text-sm text-text-secondary">{expiryDate.toLocaleString()}</p>
          </div>
        </div>

        {task.mode === 'instant' && task.stakeRequired && (
          <>
            <Separator />
            <div>
              <h3 className="font-semibold text-sm mb-1">Stake Required</h3>
              <p className="text-sm text-text-secondary">
                {(task.stakeBps / 100).toFixed(1)}% of reward
              </p>
            </div>
          </>
        )}

        {task.mode === 'proposal' && task.proposalDeadline && (
          <>
            <Separator />
            <div>
              <h3 className="font-semibold text-sm mb-1">Proposal Deadline</h3>
              <p className="text-sm text-text-secondary">
                {new Date(task.proposalDeadline).toLocaleString()}
              </p>
            </div>
          </>
        )}

        {task.mode === 'race' && task.metricDescription && (
          <>
            <Separator />
            <div>
              <h3 className="font-semibold text-sm mb-1">Metric</h3>
              <p className="text-sm text-text-secondary">{task.metricDescription}</p>
              <p className="text-sm font-semibold mt-1">Target: {task.metricTarget}</p>
            </div>
          </>
        )}

        {task.tags.length > 0 && (
          <>
            <Separator />
            <div>
              <h3 className="font-semibold text-sm mb-2">Tags</h3>
              <div className="flex flex-wrap gap-2">
                {task.tags.map((tag) => (
                  <Badge key={tag} variant="outline">
                    {tag}
                  </Badge>
                ))}
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { Badge } from './ui/badge';
import { Separator } from './ui/separator';
import { CopyCommand } from './ui/copy-button';
import type { TaskDetailResponse } from '@taskmarket/shared';
import { formatUSDC } from '@/lib/format';
import { useAccount } from 'wagmi';
import { IdentityBadge } from './IdentityBadge';
import { getStatusVariant } from '@/lib/status';

interface TaskDetailProps {
  task: TaskDetailResponse;
}

export function TaskDetail({ task }: TaskDetailProps) {
  const { address, isConnected } = useAccount();
  const isRequester = isConnected && address?.toLowerCase() === task.requester.toLowerCase();
  const visibleActions = isConnected
    ? task.pendingActions.filter((a) =>
        isRequester ? a.role === 'requester' : a.role === 'worker'
      )
    : task.pendingActions;
  const modeVariant = task.mode as 'bounty' | 'claim' | 'pitch' | 'benchmark' | 'auction';
  const expiryDate = new Date(task.expiryTime);
  const createdDate = new Date(task.createdAt);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2 mb-2">
          <Badge variant={modeVariant}>{task.mode}</Badge>
          <Badge variant={getStatusVariant(task.status)}>{task.status.replace(/_/g, ' ')}</Badge>
        </div>
        <CardTitle className="text-2xl">Task Details</CardTitle>
        <CardDescription>
          Created by <IdentityBadge agentId={task.requesterAgentId} address={task.requester} />
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <h3 className="font-heading font-semibold mb-2">Description</h3>
          <p className="text-text-secondary whitespace-pre-wrap">{task.description}</p>
        </div>

        <Separator />

        <div className="grid grid-cols-2 gap-4">
          <div>
            <h3 className="font-heading font-semibold text-sm mb-1">
              {task.mode === 'auction' ? 'Max Price' : 'Reward'}
            </h3>
            <p className="text-2xl font-bold text-state-success-primary">
              {formatUSDC(task.mode === 'auction' && task.maxPrice ? task.maxPrice : task.reward)}{' '}
              USDC
            </p>
          </div>

          <div>
            <h3 className="font-heading font-semibold text-sm mb-1">Platform Fee</h3>
            <p className="text-lg">{(task.platformFeeBps / 100).toFixed(1)}%</p>
          </div>

          <div>
            <h3 className="font-heading font-semibold text-sm mb-1">Created</h3>
            <p className="text-sm text-text-secondary">{createdDate.toLocaleString()}</p>
          </div>

          <div>
            <h3 className="font-heading font-semibold text-sm mb-1">Expires</h3>
            <p className="text-sm text-text-secondary">{expiryDate.toLocaleString()}</p>
          </div>
        </div>

        {task.mode === 'claim' && task.stakeRequired && (
          <>
            <Separator />
            <div>
              <h3 className="font-heading font-semibold text-sm mb-1">Stake Required</h3>
              <p className="text-sm text-text-secondary">
                {(task.stakeBps / 100).toFixed(1)}% of reward
              </p>
            </div>
          </>
        )}

        {task.mode === 'pitch' && task.pitchDeadline && (
          <>
            <Separator />
            <div>
              <h3 className="font-heading font-semibold text-sm mb-1">Pitch Deadline</h3>
              <p className="text-sm text-text-secondary">
                {new Date(task.pitchDeadline).toLocaleString()}
              </p>
            </div>
          </>
        )}

        {task.mode === 'benchmark' && task.metricDescription && (
          <>
            <Separator />
            <div>
              <h3 className="font-heading font-semibold text-sm mb-1">Metric</h3>
              <p className="text-sm text-text-secondary">{task.metricDescription}</p>
              <p className="text-sm font-semibold mt-1">Target: {task.metricTarget}</p>
            </div>
          </>
        )}

        {task.mode === 'auction' && (
          <>
            <Separator />
            <div className="space-y-2">
              {task.maxPrice && (
                <div>
                  <h3 className="font-heading font-semibold text-sm mb-1">Max Price</h3>
                  <p className="text-sm text-text-secondary">{formatUSDC(task.maxPrice)} USDC</p>
                </div>
              )}
              {task.bidDeadline && (
                <div>
                  <h3 className="font-heading font-semibold text-sm mb-1">Bid Deadline</h3>
                  <p className="text-sm text-text-secondary">
                    {new Date(task.bidDeadline).toLocaleString()}
                  </p>
                </div>
              )}
            </div>
          </>
        )}

        {task.tags.length > 0 && (
          <>
            <Separator />
            <div>
              <h3 className="font-heading font-semibold text-sm mb-2">Tags</h3>
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

        {visibleActions.length > 0 && (
          <>
            <Separator />
            <div>
              <h3 className="font-heading font-semibold text-sm mb-2">Available actions</h3>
              <div className="space-y-2">
                {visibleActions.map((a, i) => (
                  <CopyCommand
                    key={i}
                    command={a.command}
                    role={!isConnected ? a.role : undefined}
                  />
                ))}
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

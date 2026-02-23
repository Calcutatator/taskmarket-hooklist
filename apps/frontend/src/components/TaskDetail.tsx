import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { Badge } from './ui/badge';
import { Separator } from './ui/separator';
import type { TaskDetailResponse } from '@taskmarket/shared';
import { formatUSDC } from '@/lib/format';
import { useAccount } from 'wagmi';
import { IdentityBadge } from './IdentityBadge';

function CopyCommand({ command, role }: { command: string; role?: string }) {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    void navigator.clipboard.writeText(command).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div className="flex items-center gap-2 text-xs">
      {role && <span className="text-text-secondary shrink-0">[{role}]</span>}
      <code className="flex-1 bg-background-secondary px-2 py-1 rounded font-mono break-all">
        {command}
      </code>
      <button
        onClick={handleCopy}
        aria-label="Copy command"
        className="text-text-tertiary hover:text-text-primary transition-colors shrink-0"
      >
        {copied ? <Check size={13} /> : <Copy size={13} />}
      </button>
    </div>
  );
}

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
          <Badge variant={task.status === 'open' ? 'success' : 'default'}>{task.status}</Badge>
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

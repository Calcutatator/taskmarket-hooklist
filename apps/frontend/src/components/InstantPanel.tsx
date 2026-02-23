import { useState } from 'react';
import { Button } from './ui/button';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Badge } from './ui/badge';
import { useAccount, useSignMessage } from 'wagmi';
import type { TaskResponse } from '@taskmarket/shared';
import { formatUSDC } from '@/lib/format';
import { IdentityBadge } from './IdentityBadge';
import { API_URL } from '@/lib/api';

interface InstantPanelProps {
  task: TaskResponse;
}

export function InstantPanel({ task }: InstantPanelProps) {
  const { address } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isClaimed = task.status === 'claimed';
  const canClaim = task.status === 'open' && address;

  const stakeAmount = task.stakeRequired
    ? (BigInt(task.reward) * BigInt(task.stakeBps)) / 10000n
    : 0n;

  const handleClaim = async () => {
    if (!address || !canClaim) return;
    setError(null);
    setIsPending(true);

    try {
      const signature = await signMessageAsync({ message: task.id });

      const res = await fetch(`${API_URL}/api/tasks/${task.id}/claim`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          taskId: task.id,
          workerAddress: address,
          signature,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Server error: ${res.status}`);
      }

      window.location.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Claim failed');
    } finally {
      setIsPending(false);
    }
  };

  return (
    <div className="space-y-4">
      {isClaimed && (
        <Card>
          <CardHeader>
            <CardTitle>Task Claimed</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <div className="text-text-secondary flex items-center gap-1">
                Claimed by:{' '}
                <IdentityBadge
                  agentId={task.workerAgentId}
                  address={task.claimedBy ?? task.worker ?? ''}
                />
              </div>
              {task.claimedAt && (
                <p className="text-sm text-text-tertiary">
                  {new Date(task.claimedAt).toLocaleString()}
                </p>
              )}
              {task.stakeRequired && (
                <Badge variant="warning">Stake: {formatUSDC(stakeAmount.toString())} USDC</Badge>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {canClaim && (
        <Card>
          <CardHeader>
            <CardTitle>Claim This Task</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-text-secondary">
              Claim exclusive rights to work on this task. You'll be the only one who can submit.
            </p>
            {task.stakeRequired && (
              <div className="bg-background-secondary p-4 rounded">
                <p className="font-semibold mb-1">Stake Required</p>
                <p className="text-2xl font-bold text-state-warning-primary">
                  {formatUSDC(stakeAmount.toString())} USDC
                </p>
                <p className="text-sm text-text-tertiary mt-1">
                  Returned when your work is accepted
                </p>
              </div>
            )}
            {error && <p className="text-sm text-state-error-primary">{error}</p>}
            <Button onClick={handleClaim} disabled={isPending} variant="success" className="w-full">
              {isPending ? 'Claiming...' : 'Claim Task'}
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

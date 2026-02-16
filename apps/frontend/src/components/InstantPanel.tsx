import { Button } from './ui/button';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Badge } from './ui/badge';
import { useAccount } from 'wagmi';
import { useClaimTask } from '@/hooks/useTaskMarket';
import { useApproveUSDC } from '@/hooks/useApproveUSDC';
import { parseUnits } from 'viem';
import type { TaskResponse } from '@clawtasker/shared';

interface InstantPanelProps {
  task: TaskResponse;
}

export function InstantPanel({ task }: InstantPanelProps) {
  const { address } = useAccount();
  const { claimTask, isPending: isClaimPending } = useClaimTask();
  const { approve, isPending: isApprovePending } = useApproveUSDC();

  const isClaimed = task.status === 'claimed';
  const isClaimer = isClaimed && address?.toLowerCase() === task.claimedBy?.toLowerCase();
  const canClaim = task.status === 'open' && address;

  const stakeAmount = task.stakeRequired
    ? (BigInt(task.reward) * BigInt(task.stakeBps)) / 10000n
    : 0n;

  const handleClaim = async () => {
    if (!address || !canClaim) return;

    try {
      if (stakeAmount > 0) {
        await approve(stakeAmount);
      }

      await claimTask(task.id as `0x${string}`, stakeAmount);
    } catch (error) {
      console.error('Claim failed:', error);
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
              <p className="text-text-secondary">
                Claimed by: {task.claimedBy?.substring(0, 6)}...{task.claimedBy?.substring(38)}
              </p>
              {task.claimedAt && (
                <p className="text-sm text-text-tertiary">
                  {new Date(task.claimedAt).toLocaleString()}
                </p>
              )}
              {task.stakeRequired && (
                <Badge variant="warning">
                  Stake: {(Number(stakeAmount) / 1e6).toFixed(2)} USDC
                </Badge>
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
                  {(Number(stakeAmount) / 1e6).toFixed(2)} USDC
                </p>
                <p className="text-sm text-text-tertiary mt-1">
                  Returned when your work is accepted
                </p>
              </div>
            )}
            <Button
              onClick={handleClaim}
              disabled={isApprovePending || isClaimPending}
              variant="success"
              className="w-full"
            >
              {isApprovePending
                ? 'Approving Stake...'
                : isClaimPending
                  ? 'Claiming...'
                  : 'Claim Task'}
            </Button>
          </CardContent>
        </Card>
      )}

      {isClaimer && (
        <Card>
          <CardHeader>
            <CardTitle>Submit Your Work</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-text-secondary mb-4">Use the CLI to submit your encrypted work file:</p>
            <code className="block bg-background-secondary p-4 rounded text-sm">
              clawtasker submit {task.id} --file ./your-work.zip
            </code>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

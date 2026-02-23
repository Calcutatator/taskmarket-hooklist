import { useState } from 'react';
import { Button } from './ui/button';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { useAccount, useSignMessage } from 'wagmi';
import { keccak256, toBytes } from 'viem';
import type { TaskResponse } from '@taskmarket/shared';
import { IdentityBadge } from './IdentityBadge';
import { API_URL } from '@/lib/api';

interface ProposalPanelProps {
  task: TaskResponse;
  proposals: any[];
}

export function ProposalPanel({ task, proposals }: ProposalPanelProps) {
  const { address } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const isRequester = address?.toLowerCase() === task.requester.toLowerCase();
  const hasWorkerSelected = task.status === 'worker_selected';
  const [selectingPitch, setSelectingPitch] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSelect = async (pitchId: string, workerAddress: string) => {
    if (!address) return;
    setError(null);
    setSelectingPitch(pitchId);

    try {
      const hash = keccak256(toBytes(task.id + pitchId + workerAddress));
      const signature = await signMessageAsync({ message: { raw: hash } });

      const res = await fetch(`${API_URL}/api/tasks/${task.id}/pitches/select`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          taskId: task.id,
          pitchId,
          workerAddress,
          signature,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Server error: ${res.status}`);
      }

      window.location.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Selection failed');
    } finally {
      setSelectingPitch(null);
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Proposals ({proposals.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {proposals.length === 0 ? (
            <p className="text-text-secondary text-center py-8">No proposals yet</p>
          ) : (
            <div className="space-y-4">
              {error && <p className="text-sm text-state-error-primary">{error}</p>}
              {proposals.map((proposal: any) => (
                <Card key={proposal.id}>
                  <CardContent className="pt-6">
                    <div className="space-y-3">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <IdentityBadge
                            agentId={proposal.workerAgentId}
                            address={proposal.workerAddress}
                          />
                          {proposal.proposalText && (
                            <p className="text-sm text-text-secondary mt-1 whitespace-pre-wrap">
                              {proposal.proposalText}
                            </p>
                          )}
                          {proposal.workerStats && (
                            <p className="text-xs text-text-tertiary">
                              {proposal.workerStats.completedTasks} tasks •{' '}
                              {proposal.workerStats.averageRating?.toFixed(1) || 'N/A'} ⭐
                            </p>
                          )}
                          {proposal.estimatedDuration && (
                            <p className="text-xs text-text-tertiary mt-1">
                              Est. {proposal.estimatedDuration}h
                            </p>
                          )}
                          <p className="text-xs text-text-tertiary">
                            {new Date(proposal.submittedAt).toLocaleString()}
                          </p>
                        </div>
                        {isRequester && !hasWorkerSelected && proposal.status === 'pending' && (
                          <Button
                            onClick={() => handleSelect(proposal.id, proposal.workerAddress)}
                            disabled={selectingPitch !== null}
                            variant="success"
                            size="sm"
                          >
                            {selectingPitch === proposal.id ? 'Selecting...' : 'Select'}
                          </Button>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {hasWorkerSelected && task.worker && (
        <Card>
          <CardHeader>
            <CardTitle>Selected Worker</CardTitle>
          </CardHeader>
          <CardContent>
            <IdentityBadge agentId={task.workerAgentId} address={task.worker} />
            <p className="text-sm text-text-secondary mt-2">
              The requester has selected this worker. They can now submit their work.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

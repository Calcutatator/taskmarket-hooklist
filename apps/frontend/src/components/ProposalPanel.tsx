import { Button } from './ui/button';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { useAccount } from 'wagmi';
import { useSelectWorker } from '@/hooks/useTaskMarket';
import type { TaskResponse } from '@taskmarket/shared';
import { API_URL } from '@/lib/api';

interface ProposalPanelProps {
  task: TaskResponse;
  proposals: any[];
}

export function ProposalPanel({ task, proposals }: ProposalPanelProps) {
  const { address } = useAccount();
  const { selectWorker, isPending } = useSelectWorker();
  const isRequester = address?.toLowerCase() === task.requester.toLowerCase();
  const hasWorkerSelected = task.status === 'worker_selected';

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
              {proposals.map((proposal: any) => (
                <Card key={proposal.id}>
                  <CardContent className="pt-6">
                    <div className="space-y-3">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <p className="font-semibold">
                            {proposal.workerAddress.substring(0, 6)}...
                            {proposal.workerAddress.substring(38)}
                          </p>
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
                            onClick={() =>
                              selectWorker(
                                task.id as `0x${string}`,
                                proposal.workerAddress as `0x${string}`
                              )
                            }
                            disabled={isPending}
                            variant="success"
                            size="sm"
                          >
                            Select
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

      {!isRequester && task.status === 'open' && (
        <Card>
          <CardHeader>
            <CardTitle>Submit a Proposal</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <p className="text-text-secondary text-sm">Pitch your approach via the API:</p>
            <pre className="bg-background-secondary p-4 rounded text-xs overflow-x-auto whitespace-pre-wrap break-all">{`curl -X POST ${API_URL}/api/tasks/${task.id}/proposals \\
  -H "Content-Type: application/json" \\
  -d '{
    "taskId": "${task.id}",
    "workerAddress": "0xYOUR_ADDRESS",
    "proposalText": "Your approach, timeline, and any questions for the requester.",
    "estimatedDuration": 48,
    "signature": "0xSIG"
  }'`}</pre>
          </CardContent>
        </Card>
      )}

      {hasWorkerSelected && task.worker && (
        <Card>
          <CardHeader>
            <CardTitle>Selected Worker</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="font-semibold">
              {task.worker.substring(0, 6)}...{task.worker.substring(38)}
            </p>
            <p className="text-sm text-text-secondary mt-2">
              The requester has selected this worker. They can now submit their work.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

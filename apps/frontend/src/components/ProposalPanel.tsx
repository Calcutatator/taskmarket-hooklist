import { Button } from './ui/button';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { useAccount } from 'wagmi';
import { useSelectWorker } from '@/hooks/useTaskMarket';
import type { TaskResponse } from '@clawtasker/shared';

interface ProposalPanelProps {
  task: TaskResponse;
  proposals: any[];
}

export function ProposalPanel({ task, proposals }: ProposalPanelProps) {
  const { address } = useAccount();
  const { selectWorker, isPending } = useSelectWorker();
  const isRequester = address?.toLowerCase() === task.requester.toLowerCase();
  const hasWorkerSelected = task.status === 'worker_selected';

  const handleSelect = (proposalId: string, workerAddress: string) => {
    selectWorker(task.id as `0x${string}`, workerAddress as `0x${string}`);
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
                          {proposal.workerStats && (
                            <p className="text-xs text-text-tertiary">
                              {proposal.workerStats.completedTasks} tasks •{' '}
                              {proposal.workerStats.averageRating?.toFixed(1) || 'N/A'} ⭐
                            </p>
                          )}
                        </div>
                        {isRequester && !hasWorkerSelected && proposal.status === 'pending' && (
                          <Button
                            onClick={() => handleSelect(proposal.id, proposal.workerAddress)}
                            disabled={isPending}
                            variant="success"
                            size="sm"
                          >
                            Select
                          </Button>
                        )}
                      </div>

                      <div className="bg-background-secondary p-3 rounded">
                        <p className="text-sm whitespace-pre-wrap">{proposal.proposalText}</p>
                      </div>

                      {proposal.estimatedDuration && (
                        <p className="text-xs text-text-tertiary">
                          Est. duration: {Math.floor(proposal.estimatedDuration / 3600)}h
                        </p>
                      )}

                      <p className="text-xs text-text-tertiary">
                        {new Date(proposal.submittedAt).toLocaleString()}
                      </p>
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
          <CardContent>
            <p className="text-text-secondary mb-4">Use the CLI to submit your proposal:</p>
            <code className="block bg-background-secondary p-4 rounded text-sm">
              clawtasker propose {task.id} --text "Your proposal here" --estimated-duration 48
            </code>
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

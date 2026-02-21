import { Button } from './ui/button';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { useAccount } from 'wagmi';
import { useAcceptSubmission } from '@/hooks/useTaskMarket';
import type { TaskResponse } from '@taskmarket/shared';
import { API_URL } from '@/lib/api';

interface ContestPanelProps {
  task: TaskResponse;
  submissions: any[];
}

export function ContestPanel({ task, submissions }: ContestPanelProps) {
  const { address } = useAccount();
  const { acceptSubmission, isPending } = useAcceptSubmission();
  const isRequester = address?.toLowerCase() === task.requester.toLowerCase();

  const handleAccept = (workerAddress: string) => {
    acceptSubmission(task.id as `0x${string}`, workerAddress as `0x${string}`);
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Submissions ({submissions.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {submissions.length === 0 ? (
            <p className="text-text-secondary text-center py-8">No submissions yet</p>
          ) : (
            <div className="space-y-4">
              {submissions.map((submission: any) => (
                <Card key={submission.id}>
                  <CardContent className="pt-6">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-semibold">
                          {submission.workerAddress.substring(0, 6)}...
                          {submission.workerAddress.substring(38)}
                        </p>
                        <p className="text-sm text-text-secondary">
                          Submitted {new Date(submission.submittedAt).toLocaleString()}
                        </p>
                        {submission.workerStats && (
                          <p className="text-xs text-text-tertiary mt-1">
                            {submission.workerStats.completedTasks} tasks •{' '}
                            {submission.workerStats.averageRating?.toFixed(1) || 'N/A'} ⭐
                          </p>
                        )}
                      </div>
                      {isRequester && task.status === 'pending_approval' && (
                        <Button
                          onClick={() => handleAccept(submission.workerAddress)}
                          disabled={isPending}
                          variant="success"
                        >
                          Accept
                        </Button>
                      )}
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
            <CardTitle>Submit Your Work</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <p className="text-text-secondary text-sm">Submit your work via the API:</p>
            <pre className="bg-background-secondary p-4 rounded text-xs overflow-x-auto whitespace-pre-wrap break-all">{`curl -X POST ${API_URL}/api/tasks/${task.id}/submissions \\
  -H "Content-Type: application/json" \\
  -d '{
    "taskId": "${task.id}",
    "workerAddress": "0xYOUR_ADDRESS",
    "file": "BASE64_CONTENT",
    "signature": "0xSIG"
  }'`}</pre>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

import { Button } from './ui/button';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Badge } from './ui/badge';
import { useAccount } from 'wagmi';
import type { TaskResponse } from '@clawtasker/shared';

interface RacePanelProps {
  task: TaskResponse;
  proofs: any[];
}

export function RacePanel({ task, proofs }: RacePanelProps) {
  const { address } = useAccount();
  const isRequester = address?.toLowerCase() === task.requester.toLowerCase();

  return (
    <div className="space-y-4">
      {task.metricDescription && (
        <Card>
          <CardHeader>
            <CardTitle>Metric Challenge</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <div>
              <p className="font-semibold text-sm">Objective</p>
              <p className="text-text-secondary">{task.metricDescription}</p>
            </div>
            <div className="bg-background-secondary p-4 rounded">
              <p className="font-semibold text-sm mb-1">Target</p>
              <p className="text-2xl font-bold text-state-success-primary">{task.metricTarget}</p>
            </div>
            <p className="text-xs text-text-tertiary">
              First worker to hit the target wins the full reward
            </p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Proofs Submitted ({proofs.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {proofs.length === 0 ? (
            <p className="text-text-secondary text-center py-8">No proofs submitted yet</p>
          ) : (
            <div className="space-y-4">
              {proofs.map((proof: any) => (
                <Card key={proof.id}>
                  <CardContent className="pt-6">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <p className="font-semibold">
                          {proof.workerAddress.substring(0, 6)}...
                          {proof.workerAddress.substring(38)}
                        </p>
                        <p className="text-sm text-text-secondary mt-1">
                          Type: <Badge variant="outline">{proof.proofType}</Badge>
                        </p>
                        {proof.metricValue && (
                          <p className="text-lg font-bold mt-2 text-state-success-primary">
                            Value: {proof.metricValue}
                          </p>
                        )}
                        <p className="text-sm text-text-tertiary mt-2 break-all">
                          {proof.proofData}
                        </p>
                        <p className="text-xs text-text-tertiary mt-2">
                          {new Date(proof.submittedAt).toLocaleString()}
                        </p>
                      </div>
                      <Badge variant={proof.status === 'verified' ? 'success' : 'default'}>
                        {proof.status}
                      </Badge>
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
            <CardTitle>Submit Proof</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-text-secondary mb-4">Use the CLI to submit your proof:</p>
            <code className="block bg-background-secondary p-4 rounded text-sm">
              clawtasker submit {task.id} --proof-url "https://..." --proof-type url --metric-value
              "1000"
            </code>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

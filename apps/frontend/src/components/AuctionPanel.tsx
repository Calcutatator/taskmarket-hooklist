import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { trpc } from '@/contexts/TRPCProvider';
import type { TaskResponse } from '@taskmarket/shared';
import { formatUSDC } from '@/lib/format';
import { IdentityBadge } from './IdentityBadge';

interface AuctionPanelProps {
  task: TaskResponse;
}

export function AuctionPanel({ task }: AuctionPanelProps) {
  const { data: bids } = trpc.bids.listByTask.useQuery({ taskId: task.id });

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Bids ({bids?.length ?? 0})</CardTitle>
        </CardHeader>
        <CardContent>
          {!bids || bids.length === 0 ? (
            <p className="text-text-secondary text-center py-8">No bids yet</p>
          ) : (
            <div className="space-y-3">
              {bids.map((bid, index) => (
                <Card key={bid.id}>
                  <CardContent className="pt-4 pb-4">
                    <div className="flex items-center justify-between">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          {index === 0 && (
                            <span className="text-xs font-semibold text-state-success-primary">
                              Lowest
                            </span>
                          )}
                          <IdentityBadge agentId={bid.workerAgentId} address={bid.workerAddress} />
                        </div>
                        <p className="text-xs text-text-tertiary">
                          {new Date(bid.createdAt).toLocaleString()}
                        </p>
                      </div>
                      <p className="text-xl font-bold text-state-success-primary">
                        {formatUSDC(bid.price)} USDC
                      </p>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

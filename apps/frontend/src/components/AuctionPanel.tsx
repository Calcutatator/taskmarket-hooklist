import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { trpc } from '@/contexts/TRPCProvider';
import type { TaskResponse } from '@taskmarket/shared';
import { formatUSDC } from '@/lib/format';
import { IdentityBadge } from './IdentityBadge';

interface AuctionPanelProps {
  task: TaskResponse;
}

function ClockPriceDisplay({ task }: { task: TaskResponse }) {
  if (task.auctionType !== 'dutch' && task.auctionType !== 'reverse_dutch') return null;
  if (!task.currentAuctionPrice) return null;

  const isDutch = task.auctionType === 'dutch';
  const scheduleTs = isDutch ? task.auctionPriceReachesFloorAt : task.auctionPriceReachesMaxAt;
  const scheduleLabel = isDutch ? 'Reaches floor at' : 'Reaches max at';

  return (
    <Card>
      <CardContent className="pt-4 pb-4">
        <div className="space-y-2">
          <p className="text-sm text-text-secondary">
            {isDutch
              ? 'Descending clock — first to accept wins'
              : 'Ascending clock — first to accept wins'}
          </p>
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">Current price</p>
            <p className="text-2xl font-bold text-state-success-primary">
              {formatUSDC(task.currentAuctionPrice)} USDC
            </p>
          </div>
          {scheduleTs && (
            <p className="text-xs text-text-tertiary">
              {scheduleLabel}: {new Date(scheduleTs).toLocaleString()}
            </p>
          )}
          {task.bidDeadline && (
            <p className="text-xs text-text-tertiary">
              Clock expires: {new Date(task.bidDeadline).toLocaleString()}
            </p>
          )}
          <p className="text-xs text-text-secondary mt-1">
            Run: <code>taskmarket task auction-accept {task.id}</code>
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

export function AuctionPanel({ task }: AuctionPanelProps) {
  const { data: bids } = trpc.bids.listByTask.useQuery({ taskId: task.id });

  const now = new Date();
  const deadlinePassed = task.bidDeadline ? now >= new Date(task.bidDeadline) : true;
  const isSealed =
    task.auctionType === 'reverse_english' && task.status === 'open' && !deadlinePassed;

  const subtypeLabel: Record<string, string> = {
    dutch: 'Dutch (Descending Clock)',
    english: 'English (Open Bids)',
    reverse_dutch: 'Reverse Dutch (Ascending Clock)',
    reverse_english: 'Reverse English (Sealed Bids)',
  };

  return (
    <div className="space-y-4">
      {task.auctionType && (
        <p className="text-sm text-text-secondary">
          Subtype:{' '}
          <span className="font-medium">{subtypeLabel[task.auctionType] ?? task.auctionType}</span>
        </p>
      )}

      <ClockPriceDisplay task={task} />

      <Card>
        <CardHeader>
          <CardTitle>
            Bids (
            {task.auctionBidCount !== null && task.auctionBidCount !== undefined
              ? task.auctionBidCount
              : (bids?.length ?? 0)}
            )
            {isSealed && (
              <span className="ml-2 text-sm font-normal text-text-secondary">
                — sealed until deadline
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {task.auctionType === 'english' && task.currentLowestBid && (
            <p className="text-sm mb-3">
              Current lowest:{' '}
              <span className="font-bold text-state-success-primary">
                {formatUSDC(task.currentLowestBid)} USDC
              </span>
            </p>
          )}
          {isSealed ? (
            <p className="text-text-secondary text-center py-8">
              {task.auctionBidCount ?? 0} sealed bid(s) — prices hidden until deadline
            </p>
          ) : !bids || bids.length === 0 ? (
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
                          {bid.workerAddress ? (
                            <IdentityBadge
                              agentId={bid.workerAgentId ?? null}
                              address={bid.workerAddress}
                            />
                          ) : (
                            <span className="text-xs text-text-tertiary">Hidden</span>
                          )}
                        </div>
                        <p className="text-xs text-text-tertiary">
                          {new Date(bid.createdAt).toLocaleString()}
                        </p>
                      </div>
                      <p className="text-xl font-bold text-state-success-primary">
                        {bid.price ? `${formatUSDC(bid.price)} USDC` : '—'}
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

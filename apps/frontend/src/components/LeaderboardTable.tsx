import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { trpc } from '@/contexts/TRPCProvider';

export function LeaderboardTable() {
  const { data: leaderboard, isLoading } = trpc.agents.leaderboard.useQuery({
    limit: 50,
  });

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Top Workers</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {[...Array(10)].map((_, i) => (
              <div key={i} className="h-12 bg-background-secondary animate-pulse rounded" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!leaderboard || leaderboard.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Top Workers</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-text-secondary text-center py-8">No workers yet</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Top Workers</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border-primary">
                <th className="text-left py-3 px-4 font-semibold text-sm">Rank</th>
                <th className="text-left py-3 px-4 font-semibold text-sm">Worker</th>
                <th className="text-right py-3 px-4 font-semibold text-sm">Tasks</th>
                <th className="text-right py-3 px-4 font-semibold text-sm">Rating</th>
                <th className="text-right py-3 px-4 font-semibold text-sm">Total Earned</th>
              </tr>
            </thead>
            <tbody>
              {leaderboard.map((worker, index) => (
                <tr
                  key={worker.address}
                  className="border-b border-border-primary hover:bg-background-secondary transition-colors"
                >
                  <td className="py-3 px-4">
                    <span
                      className={`font-bold ${
                        index === 0
                          ? 'text-yellow-500'
                          : index === 1
                            ? 'text-gray-400'
                            : index === 2
                              ? 'text-orange-600'
                              : 'text-text-secondary'
                      }`}
                    >
                      #{index + 1}
                    </span>
                  </td>
                  <td className="py-3 px-4 font-mono text-sm">
                    {worker.address.substring(0, 6)}...{worker.address.substring(38)}
                  </td>
                  <td className="py-3 px-4 text-right">
                    <span className="font-semibold">{worker.completedTasks}</span>
                  </td>
                  <td className="py-3 px-4 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <span className="font-semibold">
                        {worker.averageRating?.toFixed(1) || 'N/A'}
                      </span>
                      {worker.averageRating && <span className="text-yellow-500">★</span>}
                    </div>
                  </td>
                  <td className="py-3 px-4 text-right">
                    <span className="font-semibold text-state-success-primary">
                      {(worker.totalEarned / 1e6).toFixed(2)} USDC
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

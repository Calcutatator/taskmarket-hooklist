import { useParams } from '@tanstack/react-router';
import { trpc } from '@/contexts/TRPCProvider';
import { formatUSDC } from '@/lib/format';
import { PageLayout } from '../layout/PageLayout';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';

export function AgentProfileView() {
  const { agentId } = useParams({ from: '/agents/$agentId' });

  const { data: agent, isLoading } = trpc.agents.stats.useQuery({ agentId });

  if (isLoading) {
    return (
      <PageLayout>
        <div className="space-y-4">
          <div className="h-8 w-48 bg-background-secondary animate-pulse rounded" />
          <div className="h-32 bg-background-secondary animate-pulse rounded" />
        </div>
      </PageLayout>
    );
  }

  if (!agent) {
    return (
      <PageLayout>
        <p className="text-text-secondary">Agent not found.</p>
      </PageLayout>
    );
  }

  return (
    <PageLayout>
      <div className="space-y-6">
        <div>
          <h1 className="font-heading text-3xl font-bold mb-1">
            Agent {agent.agentId ? `#${agent.agentId}` : agentId}
          </h1>
          <p className="font-mono text-sm text-text-secondary">{agent.address}</p>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-6">
              <div className="text-2xl font-bold">{agent.completedTasks}</div>
              <div className="text-xs text-text-secondary mt-1">Tasks Completed</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="text-2xl font-bold">
                {agent.averageRating > 0 ? agent.averageRating.toFixed(1) : 'N/A'}
              </div>
              <div className="text-xs text-text-secondary mt-1">Avg Rating</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="text-2xl font-bold text-state-success-primary">
                {formatUSDC(agent.totalEarnings)} USDC
              </div>
              <div className="text-xs text-text-secondary mt-1">Total Earned</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="text-2xl font-bold">{agent.ratedTasks}</div>
              <div className="text-xs text-text-secondary mt-1">Rated Tasks</div>
            </CardContent>
          </Card>
        </div>

        {agent.skills && agent.skills.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Skills</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2">
                {agent.skills.map((skill) => (
                  <span
                    key={skill}
                    className="px-2 py-1 text-sm rounded bg-background-secondary text-text-secondary border border-border-primary"
                  >
                    {skill}
                  </span>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {agent.recentRatings && agent.recentRatings.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Recent Ratings</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {agent.recentRatings.map((r) => (
                  <div
                    key={r.taskId}
                    className="flex justify-between items-center py-2 border-b border-border-primary last:border-0"
                  >
                    <span className="font-mono text-sm text-text-secondary">
                      {r.taskId.slice(0, 8)}...
                    </span>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">{r.rating}/100</span>
                      <span className="text-xs text-text-secondary">
                        {new Date(r.createdAt).toLocaleDateString()}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </PageLayout>
  );
}

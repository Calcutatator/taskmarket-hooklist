import { useState } from 'react';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { trpc } from '@/contexts/TRPCProvider';
import { formatUSDC } from '@/lib/format';
import { PageLayout } from '../layout/PageLayout';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';

export function AgentDirectoryView() {
  const search = useSearch({ from: '/agents/' });
  const navigate = useNavigate({ from: '/agents/' });

  const [searchInput, setSearchInput] = useState(search.search ?? '');
  const [skillInput, setSkillInput] = useState(search.skill ?? '');
  const sort = search.sort ?? 'reputation';

  const { data: agents, isLoading } = trpc.agents.leaderboard.useQuery({
    limit: 50,
    sort,
    skill: search.skill,
    search: search.search,
  });

  function applyFilters(overrides: {
    sort?: 'reputation' | 'tasks';
    skill?: string;
    search?: string;
  }) {
    void navigate({
      search: (prev) => ({
        ...prev,
        ...overrides,
        skill: overrides.skill || undefined,
        search: overrides.search || undefined,
      }),
    });
  }

  function handleSearchSubmit(e: React.FormEvent) {
    e.preventDefault();
    applyFilters({ sort, skill: skillInput, search: searchInput });
  }

  return (
    <PageLayout>
      <div className="space-y-6">
        <div>
          <h1 className="font-heading text-3xl font-bold mb-1">Agent Directory</h1>
          <p className="text-text-secondary text-sm">
            Browse workers by reputation, task count, and skill.
          </p>
        </div>

        <form onSubmit={handleSearchSubmit} className="flex flex-wrap gap-3 items-end">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-text-secondary">Search</label>
            <input
              type="text"
              placeholder="Agent ID or address"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              className="px-3 py-1.5 text-sm border border-border-primary rounded bg-background-primary text-text-primary w-56"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-text-secondary">Skill</label>
            <input
              type="text"
              placeholder="e.g. python"
              value={skillInput}
              onChange={(e) => setSkillInput(e.target.value)}
              className="px-3 py-1.5 text-sm border border-border-primary rounded bg-background-primary text-text-primary w-36"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-text-secondary">Sort</label>
            <div className="flex gap-1">
              <button
                type="button"
                onClick={() =>
                  applyFilters({ sort: 'reputation', skill: skillInput, search: searchInput })
                }
                className={`px-3 py-1.5 text-sm rounded border transition-colors ${
                  sort === 'reputation'
                    ? 'bg-sidebar-item-active text-white border-sidebar-item-active'
                    : 'border-border-primary text-text-secondary hover:text-text-primary'
                }`}
              >
                Reputation
              </button>
              <button
                type="button"
                onClick={() =>
                  applyFilters({ sort: 'tasks', skill: skillInput, search: searchInput })
                }
                className={`px-3 py-1.5 text-sm rounded border transition-colors ${
                  sort === 'tasks'
                    ? 'bg-sidebar-item-active text-white border-sidebar-item-active'
                    : 'border-border-primary text-text-secondary hover:text-text-primary'
                }`}
              >
                Task Count
              </button>
            </div>
          </div>

          <button
            type="submit"
            className="px-4 py-1.5 text-sm bg-sidebar-item-active text-white rounded hover:opacity-90 transition-opacity"
          >
            Filter
          </button>

          {(search.skill || search.search) && (
            <button
              type="button"
              onClick={() => {
                setSearchInput('');
                setSkillInput('');
                applyFilters({ sort, skill: '', search: '' });
              }}
              className="px-4 py-1.5 text-sm border border-border-primary text-text-secondary rounded hover:text-text-primary transition-colors"
            >
              Clear
            </button>
          )}
        </form>

        <Card>
          <CardHeader>
            <CardTitle>Agents</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-2">
                {[...Array(10)].map((_, i) => (
                  <div key={i} className="h-12 bg-background-secondary animate-pulse rounded" />
                ))}
              </div>
            ) : !agents || agents.length === 0 ? (
              <p className="text-text-secondary text-center py-8">No agents found.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-border-primary">
                      <th className="text-left py-3 px-4 font-semibold text-sm">Rank</th>
                      <th className="text-left py-3 px-4 font-semibold text-sm">Agent</th>
                      <th className="text-right py-3 px-4 font-semibold text-sm">Tasks</th>
                      <th className="text-right py-3 px-4 font-semibold text-sm">Rating</th>
                      <th className="text-right py-3 px-4 font-semibold text-sm">Earned</th>
                      <th className="text-left py-3 px-4 font-semibold text-sm">Skills</th>
                    </tr>
                  </thead>
                  <tbody>
                    {agents.map((agent, index) => (
                      <tr
                        key={agent.address}
                        className="border-b border-border-primary hover:bg-background-secondary transition-colors"
                      >
                        <td className="py-3 px-4">
                          <span
                            className={`font-bold ${
                              index === 0
                                ? 'text-yellow-1000'
                                : index === 1
                                  ? 'text-slate-700'
                                  : index === 2
                                    ? 'text-orange-1000'
                                    : 'text-text-secondary'
                            }`}
                          >
                            #{agent.rank}
                          </span>
                        </td>
                        <td className="py-3 px-4">
                          {agent.agentId ? (
                            <Link
                              to="/agents/$agentId"
                              params={{ agentId: agent.agentId }}
                              className="text-sm font-medium hover:underline text-sidebar-item-active"
                            >
                              #{agent.agentId}
                            </Link>
                          ) : null}
                          <div className="font-mono text-xs text-text-secondary">
                            {agent.address.slice(0, 6)}...{agent.address.slice(-4)}
                          </div>
                        </td>
                        <td className="py-3 px-4 text-right">
                          <span className="font-semibold">{agent.completedTasks}</span>
                        </td>
                        <td className="py-3 px-4 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <span className="font-semibold">
                              {agent.averageRating > 0 ? agent.averageRating.toFixed(1) : 'N/A'}
                            </span>
                            {agent.averageRating > 0 && <span className="text-yellow-1000">*</span>}
                          </div>
                        </td>
                        <td className="py-3 px-4 text-right">
                          <span className="font-semibold text-state-success-primary">
                            {formatUSDC(agent.totalEarnings)} USDC
                          </span>
                        </td>
                        <td className="py-3 px-4">
                          <div className="flex flex-wrap gap-1">
                            {agent.skills.slice(0, 5).map((skill) => (
                              <span
                                key={skill}
                                className="px-1.5 py-0.5 text-xs rounded bg-background-secondary text-text-secondary border border-border-primary"
                              >
                                {skill}
                              </span>
                            ))}
                            {agent.skills.length > 5 && (
                              <span className="text-xs text-text-secondary">
                                +{agent.skills.length - 5}
                              </span>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </PageLayout>
  );
}

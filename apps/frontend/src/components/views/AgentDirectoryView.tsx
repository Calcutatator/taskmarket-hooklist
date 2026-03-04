import { useState, useEffect, useRef } from 'react';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { trpc } from '@/contexts/TRPCProvider';
import { formatUSDC } from '@/lib/format';
import { getAgentName, getAgentIdByName } from '@taskmarket/shared';
import { AgentAvatar } from '../AgentAvatar';
import { PageLayout } from '../layout/PageLayout';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';

const PAGE_SIZE_OPTIONS = [10, 20, 50] as const;
const MIN_RATING_OPTIONS = [
  { label: 'Any', value: undefined },
  { label: '3+', value: 3 },
  { label: '4+', value: 4 },
  { label: '4.5+', value: 4.5 },
] as const;
const MIN_TASKS_OPTIONS = [
  { label: 'Any', value: undefined },
  { label: '5+', value: 5 },
  { label: '10+', value: 10 },
  { label: '50+', value: 50 },
] as const;

export function AgentDirectoryView() {
  const search = useSearch({ from: '/agents/' });
  const navigate = useNavigate({ from: '/agents/' });

  const [searchInput, setSearchInput] = useState(search.search ?? '');
  const [skillInput, setSkillInput] = useState(search.skill ?? '');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sort = search.sort ?? 'reputation';
  const page = search.page ?? 1;
  const pageSize = search.limit ?? 20;
  const offset = (page - 1) * pageSize;

  // Sync inputs when URL params change (e.g. browser back/forward)
  useEffect(() => {
    setSearchInput(search.search ?? '');
    setSkillInput(search.skill ?? '');
  }, [search.search, search.skill]);

  const { data: agents, isLoading } = trpc.agents.leaderboard.useQuery({
    limit: pageSize,
    offset,
    sort,
    skill: search.skill,
    search: search.search,
    minRating: search.minRating,
    minTasks: search.minTasks,
  });

  const hasNextPage = agents !== undefined && agents.length === pageSize;
  const hasPrevPage = page > 1;

  function applyFilters(overrides: {
    sort?: 'reputation' | 'tasks';
    skill?: string;
    search?: string;
    page?: number;
    limit?: number;
    minRating?: number;
    minTasks?: number;
  }) {
    void navigate({
      search: (prev) => ({
        ...prev,
        ...overrides,
        skill: overrides.skill || undefined,
        search: overrides.search || undefined,
        page: overrides.page && overrides.page > 1 ? overrides.page : undefined,
        limit: overrides.limit && overrides.limit !== 20 ? overrides.limit : undefined,
        minRating: 'minRating' in overrides ? overrides.minRating : prev.minRating,
        minTasks: 'minTasks' in overrides ? overrides.minTasks : prev.minTasks,
      }),
    });
  }

  function resolveSearch(input: string): string {
    const trimmed = input.trim();
    if (!trimmed) return trimmed;
    // Numeric → pass as-is
    if (/^\d+$/.test(trimmed)) return trimmed;
    // Try resolving as a generated name
    const id = getAgentIdByName(trimmed);
    if (id !== null) return String(id);
    return trimmed;
  }

  function scheduleApplyFilters(nextSearch: string, nextSkill: string) {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      applyFilters({
        sort,
        skill: nextSkill,
        search: resolveSearch(nextSearch),
        page: 1,
        limit: pageSize,
      });
    }, 400);
  }

  function handleSearchSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (debounceRef.current) clearTimeout(debounceRef.current);
    applyFilters({
      sort,
      skill: skillInput,
      search: resolveSearch(searchInput),
      page: 1,
      limit: pageSize,
    });
  }

  function goToPage(nextPage: number) {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    applyFilters({
      sort,
      skill: skillInput,
      search: searchInput,
      page: nextPage,
      limit: pageSize,
    });
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
              placeholder="Search by name, ID, or address"
              value={searchInput}
              onChange={(e) => {
                const val = e.target.value;
                setSearchInput(val);
                scheduleApplyFilters(val, skillInput);
              }}
              className="px-3 py-1.5 text-sm border border-border-primary rounded bg-background-primary text-text-primary w-56"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-text-secondary">Skill</label>
            <input
              type="text"
              placeholder="e.g. python"
              value={skillInput}
              onChange={(e) => {
                const val = e.target.value;
                setSkillInput(val);
                scheduleApplyFilters(searchInput, val);
              }}
              className="px-3 py-1.5 text-sm border border-border-primary rounded bg-background-primary text-text-primary w-36"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-text-secondary">Min Rating</label>
            <select
              value={search.minRating ?? ''}
              onChange={(e) => {
                const val = e.target.value === '' ? undefined : Number(e.target.value);
                applyFilters({ minRating: val, minTasks: search.minTasks, page: 1 });
              }}
              className="px-3 py-1.5 text-sm border border-border-primary rounded bg-background-primary text-text-primary"
            >
              {MIN_RATING_OPTIONS.map((o) => (
                <option key={o.label} value={o.value ?? ''}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-text-secondary">Min Tasks</label>
            <select
              value={search.minTasks ?? ''}
              onChange={(e) => {
                const val = e.target.value === '' ? undefined : Number(e.target.value);
                applyFilters({ minTasks: val, minRating: search.minRating, page: 1 });
              }}
              className="px-3 py-1.5 text-sm border border-border-primary rounded bg-background-primary text-text-primary"
            >
              {MIN_TASKS_OPTIONS.map((o) => (
                <option key={o.label} value={o.value ?? ''}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-text-secondary">Sort</label>
            <div className="flex gap-1">
              <button
                type="button"
                onClick={() =>
                  applyFilters({
                    sort: 'reputation',
                    skill: skillInput,
                    search: searchInput,
                    page: 1,
                    limit: pageSize,
                  })
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
                  applyFilters({
                    sort: 'tasks',
                    skill: skillInput,
                    search: searchInput,
                    page: 1,
                    limit: pageSize,
                  })
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

          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-text-secondary">Per page</label>
            <select
              value={pageSize}
              onChange={(e) =>
                applyFilters({
                  sort,
                  skill: skillInput,
                  search: searchInput,
                  page: 1,
                  limit: Number(e.target.value) as (typeof PAGE_SIZE_OPTIONS)[number],
                })
              }
              className="px-3 py-1.5 text-sm border border-border-primary rounded bg-background-primary text-text-primary"
            >
              {PAGE_SIZE_OPTIONS.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </div>

          {(search.skill || search.search || search.minRating || search.minTasks) && (
            <button
              type="button"
              onClick={() => {
                setSearchInput('');
                setSkillInput('');
                applyFilters({
                  sort,
                  skill: '',
                  search: '',
                  page: 1,
                  limit: pageSize,
                  minRating: undefined,
                  minTasks: undefined,
                });
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
                {[...Array(pageSize > 20 ? 10 : pageSize)].map((_, i) => (
                  <div key={i} className="h-12 bg-background-secondary animate-pulse rounded" />
                ))}
              </div>
            ) : !agents || agents.length === 0 ? (
              <p className="text-text-secondary text-center py-8">No agents found.</p>
            ) : (
              <>
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
                                index === 0 && page === 1
                                  ? 'text-yellow-1000'
                                  : index === 1 && page === 1
                                    ? 'text-slate-700'
                                    : index === 2 && page === 1
                                      ? 'text-orange-1000'
                                      : 'text-text-secondary'
                              }`}
                            >
                              #{agent.rank}
                            </span>
                          </td>
                          <td className="py-3 px-4">
                            <div className="flex items-center gap-3">
                              <AgentAvatar
                                address={agent.address}
                                size={32}
                                className="rounded-full overflow-hidden shrink-0"
                              />
                              <div>
                                {agent.agentId ? (
                                  <Link
                                    to="/agents/$agentId"
                                    params={{ agentId: agent.agentId }}
                                    title={`#${agent.agentId}`}
                                    className="text-sm font-medium hover:underline text-sidebar-item-active"
                                  >
                                    {getAgentName(agent.agentId) ?? `Agent #${agent.agentId}`}
                                  </Link>
                                ) : null}
                                <div className="font-mono text-xs text-text-secondary">
                                  {agent.address.slice(0, 6)}...{agent.address.slice(-4)}
                                </div>
                              </div>
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
                              {agent.averageRating > 0 && (
                                <span className="text-yellow-1000">*</span>
                              )}
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

                <div className="flex items-center justify-between mt-4 pt-4 border-t border-border-primary">
                  <span className="text-sm text-text-secondary">Page {page}</span>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => goToPage(page - 1)}
                      disabled={!hasPrevPage}
                      className="px-3 py-1.5 text-sm border border-border-primary rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed hover:enabled:bg-background-secondary"
                    >
                      Previous
                    </button>
                    <button
                      type="button"
                      onClick={() => goToPage(page + 1)}
                      disabled={!hasNextPage}
                      className="px-3 py-1.5 text-sm border border-border-primary rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed hover:enabled:bg-background-secondary"
                    >
                      Next
                    </button>
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </PageLayout>
  );
}

import { useState } from 'react';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { trpc } from '@/contexts/TRPCProvider';
import { formatUSDC } from '@/lib/format';
import { IdentityBadge } from './IdentityBadge';

const PAGE_SIZE_OPTIONS = [10, 20, 50] as const;

export function LeaderboardTable() {
  const search = useSearch({ from: '/leaderboard' });
  const navigate = useNavigate({ from: '/leaderboard' });

  const sort = search.sort ?? 'reputation';
  const page = search.page ?? 1;
  const pageSize = search.limit ?? 20;
  const offset = (page - 1) * pageSize;

  const [searchInput, setSearchInput] = useState(search.search ?? '');
  const [skillInput, setSkillInput] = useState(search.skill ?? '');

  const { data: leaderboard, isLoading } = trpc.agents.leaderboard.useQuery({
    limit: pageSize,
    offset,
    sort,
    skill: search.skill,
    search: search.search,
  });

  const hasNextPage = leaderboard !== undefined && leaderboard.length === pageSize;
  const hasPrevPage = page > 1;

  function applyFilters(overrides: {
    sort?: 'reputation' | 'tasks';
    skill?: string;
    search?: string;
    page?: number;
    limit?: number;
  }) {
    void navigate({
      search: (prev) => ({
        ...prev,
        ...overrides,
        skill: overrides.skill || undefined,
        search: overrides.search || undefined,
        page: overrides.page && overrides.page > 1 ? overrides.page : undefined,
        limit: overrides.limit && overrides.limit !== 20 ? overrides.limit : undefined,
      }),
    });
  }

  function handleSearchSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    applyFilters({ sort, skill: skillInput, search: searchInput, page: 1, limit: pageSize });
  }

  function goToPage(nextPage: number) {
    applyFilters({
      sort,
      skill: search.skill,
      search: search.search,
      page: nextPage,
      limit: pageSize,
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Top Workers</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
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
                applyFilters({ sort, skill: '', search: '', page: 1, limit: pageSize });
              }}
              className="px-4 py-1.5 text-sm border border-border-primary text-text-secondary rounded hover:text-text-primary transition-colors"
            >
              Clear
            </button>
          )}
        </form>

        {isLoading ? (
          <div className="space-y-2">
            {[...Array(pageSize > 20 ? 10 : pageSize)].map((_, i) => (
              <div key={i} className="h-12 bg-background-secondary animate-pulse rounded" />
            ))}
          </div>
        ) : !leaderboard || leaderboard.length === 0 ? (
          <p className="text-text-secondary text-center py-8">No workers found.</p>
        ) : (
          <>
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
                            index === 0 && page === 1
                              ? 'text-yellow-1000'
                              : index === 1 && page === 1
                                ? 'text-slate-700'
                                : index === 2 && page === 1
                                  ? 'text-orange-1000'
                                  : 'text-text-secondary'
                          }`}
                        >
                          #{worker.rank}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-sm">
                        <IdentityBadge agentId={worker.agentId} address={worker.address} />
                      </td>
                      <td className="py-3 px-4 text-right">
                        <span className="font-semibold">{worker.completedTasks}</span>
                      </td>
                      <td className="py-3 px-4 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <span className="font-semibold">
                            {worker.averageRating?.toFixed(1) || 'N/A'}
                          </span>
                          {worker.averageRating ? (
                            <span className="text-yellow-1000">*</span>
                          ) : null}
                        </div>
                      </td>
                      <td className="py-3 px-4 text-right">
                        <span className="font-semibold text-state-success-primary">
                          {formatUSDC(worker.totalEarnings ?? '0')} USDC
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-between pt-4 border-t border-border-primary">
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
  );
}

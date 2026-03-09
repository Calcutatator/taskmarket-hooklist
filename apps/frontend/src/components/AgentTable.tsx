import { Link } from '@tanstack/react-router';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { NativeSelect } from './ui/native-select';
import { PAGE_SIZE_OPTIONS, MIN_RATING_OPTIONS, MIN_TASKS_OPTIONS } from '@/lib/filter-constants';
import { formatUSDC } from '@/lib/format';
import { IdentityBadge } from './IdentityBadge';
import { AgentAvatar } from './AgentAvatar';
import { getAgentName } from '@taskmarket/shared';
import { FilterPanel } from './ui/FilterPanel';
import { Badge } from './ui/badge';

interface AgentTableRow {
  agentId: string | null;
  address: string;
  rank: number;
  completedTasks: number;
  averageRating: number;
  totalEarnings: string;
  skills: string[];
}

interface AgentTableProps {
  variant: 'leaderboard' | 'directory';
  data: AgentTableRow[] | undefined;
  isLoading: boolean;
  page: number;
  pageSize: number;
  sort: string;
  searchInput: string;
  skillInput: string;
  minRating: number | undefined;
  minTasks: number | undefined;
  hasNextPage: boolean;
  hasPrevPage: boolean;
  hasActiveFilters: boolean;
  onSearchChange: (val: string) => void;
  onSkillChange: (val: string) => void;
  onMinRatingChange: (val: number | undefined) => void;
  onMinTasksChange: (val: number | undefined) => void;
  onSortChange: (sort: string) => void;
  onPageSizeChange: (size: number) => void;
  onPageChange: (page: number) => void;
  onSearchSubmit: (e: React.FormEvent) => void;
  onClearFilters: () => void;
  searchPlaceholder?: string;
}

function getRankColor(index: number, page: number): string {
  if (page !== 1) return 'text-text-secondary';
  if (index === 0) return 'text-yellow-1000';
  if (index === 1) return 'text-slate-700';
  if (index === 2) return 'text-orange-1000';
  return 'text-text-secondary';
}

export function AgentTable({
  variant,
  data,
  isLoading,
  page,
  pageSize,
  sort,
  searchInput,
  skillInput,
  minRating,
  minTasks,
  hasNextPage,
  hasPrevPage,
  hasActiveFilters,
  onSearchChange,
  onSkillChange,
  onMinRatingChange,
  onMinTasksChange,
  onSortChange,
  onPageSizeChange,
  onPageChange,
  onSearchSubmit,
  onClearFilters,
  searchPlaceholder = 'Agent ID or address',
}: AgentTableProps) {
  const emptyMessage = variant === 'leaderboard' ? 'No workers found.' : 'No agents found.';
  const workerColumnLabel = variant === 'leaderboard' ? 'Worker' : 'Agent';
  const earnedColumnLabel = variant === 'leaderboard' ? 'Total Earned' : 'Earned';
  const filterTitle = variant === 'leaderboard' ? 'Filter rankings' : 'Filter agents';
  const filterDescription =
    variant === 'leaderboard'
      ? 'Adjust sorting, thresholds, and query terms for the current rankings.'
      : 'Refine the current directory by reputation, skills, and activity.';

  return (
    <div className="space-y-4">
      <FilterPanel title={filterTitle} description={filterDescription}>
        <form onSubmit={onSearchSubmit} className="grid grid-cols-1 gap-4 lg:grid-cols-6">
          <div className="space-y-2 lg:col-span-2">
            <Label className="text-xs font-medium text-text-secondary">Search</Label>
            <Input
              type="text"
              placeholder={searchPlaceholder}
              value={searchInput}
              onChange={(e) => onSearchChange(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label className="text-xs font-medium text-text-secondary">Skill</Label>
            <Input
              type="text"
              placeholder="e.g. python"
              value={skillInput}
              onChange={(e) => onSkillChange(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label className="text-xs font-medium text-text-secondary">Min Rating</Label>
            <NativeSelect
              value={minRating ?? ''}
              onChange={(e) => {
                const val = e.target.value === '' ? undefined : Number(e.target.value);
                onMinRatingChange(val);
              }}
            >
              {MIN_RATING_OPTIONS.map((o) => (
                <option key={o.label} value={o.value ?? ''}>
                  {o.label}
                </option>
              ))}
            </NativeSelect>
          </div>

          <div className="space-y-2">
            <Label className="text-xs font-medium text-text-secondary">Min Tasks</Label>
            <NativeSelect
              value={minTasks ?? ''}
              onChange={(e) => {
                const val = e.target.value === '' ? undefined : Number(e.target.value);
                onMinTasksChange(val);
              }}
            >
              {MIN_TASKS_OPTIONS.map((o) => (
                <option key={o.label} value={o.value ?? ''}>
                  {o.label}
                </option>
              ))}
            </NativeSelect>
          </div>

          <div className="space-y-2">
            <Label className="text-xs font-medium text-text-secondary">Per page</Label>
            <NativeSelect
              value={pageSize}
              onChange={(e) => onPageSizeChange(Number(e.target.value))}
            >
              {PAGE_SIZE_OPTIONS.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </NativeSelect>
          </div>

          <div className="space-y-2 lg:col-span-6">
            <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
              <div className="space-y-2">
                <Label className="text-xs font-medium text-text-secondary">Sort</Label>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant={sort === 'reputation' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => onSortChange('reputation')}
                  >
                    Reputation
                  </Button>
                  <Button
                    type="button"
                    variant={sort === 'tasks' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => onSortChange('tasks')}
                  >
                    Task Count
                  </Button>
                </div>
              </div>

              {hasActiveFilters && (
                <Button type="button" variant="outline" size="sm" onClick={onClearFilters}>
                  Clear filters
                </Button>
              )}
            </div>
          </div>
        </form>
      </FilterPanel>

      {isLoading ? (
        <div className="space-y-2">
          {[...Array(pageSize > 20 ? 10 : pageSize)].map((_, i) => (
            <div key={i} className="h-12 bg-background-secondary animate-pulse rounded" />
          ))}
        </div>
      ) : !data || data.length === 0 ? (
        <p className="text-text-secondary text-center py-10">{emptyMessage}</p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border-primary">
                  <th className="text-left py-3 px-4 text-xs font-medium text-text-secondary uppercase tracking-wider">
                    Rank
                  </th>
                  <th className="text-left py-3 px-4 text-xs font-medium text-text-secondary uppercase tracking-wider">
                    {workerColumnLabel}
                  </th>
                  <th className="text-right py-3 px-4 text-xs font-medium text-text-secondary uppercase tracking-wider">
                    Tasks
                  </th>
                  <th className="text-right py-3 px-4 text-xs font-medium text-text-secondary uppercase tracking-wider">
                    Rating
                  </th>
                  <th className="text-right py-3 px-4 text-xs font-medium text-text-secondary uppercase tracking-wider">
                    {earnedColumnLabel}
                  </th>
                  {variant === 'directory' && (
                    <th className="text-left py-3 px-4 text-xs font-medium text-text-secondary uppercase tracking-wider">
                      Skills
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {data.map((row, index) => (
                  <tr
                    key={row.address}
                    className="border-b border-border-primary hover:bg-background-secondary transition-colors"
                  >
                    <td className="py-3 px-4">
                      <span className={`font-bold ${getRankColor(index, page)}`}>#{row.rank}</span>
                    </td>
                    <td className="py-3 px-4">
                      {variant === 'leaderboard' ? (
                        <span className="text-sm">
                          <IdentityBadge agentId={row.agentId} address={row.address} />
                        </span>
                      ) : (
                        <div className="flex items-center gap-3">
                          <AgentAvatar
                            address={row.address}
                            size={32}
                            className="rounded-full overflow-hidden shrink-0"
                            aria-hidden="true"
                          />
                          <div>
                            {row.agentId ? (
                              <Link
                                to="/agents/$agentId"
                                params={{ agentId: row.agentId }}
                                title={`Agent #${row.agentId}`}
                                className="text-sm font-medium hover:underline text-sidebar-item-active"
                              >
                                {getAgentName(row.agentId) ?? `Agent #${row.agentId}`}
                              </Link>
                            ) : null}
                            {row.agentId ? (
                              <div className="font-mono text-xs text-text-secondary">
                                Agent #{row.agentId}
                              </div>
                            ) : null}
                          </div>
                        </div>
                      )}
                    </td>
                    <td className="py-3 px-4 text-right">
                      <span className="font-semibold">{row.completedTasks}</span>
                    </td>
                    <td className="py-3 px-4 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <span className="font-semibold">
                          {variant === 'leaderboard'
                            ? row.averageRating?.toFixed(1) || 'N/A'
                            : row.averageRating > 0
                              ? row.averageRating.toFixed(1)
                              : 'N/A'}
                        </span>
                        {variant === 'leaderboard' ? (
                          row.averageRating ? (
                            <span className="text-yellow-1000">*</span>
                          ) : null
                        ) : (
                          row.averageRating > 0 && <span className="text-yellow-1000">*</span>
                        )}
                      </div>
                    </td>
                    <td className="py-3 px-4 text-right">
                      <span className="font-semibold text-state-success-primary">
                        {formatUSDC(row.totalEarnings ?? '0')} USDC
                      </span>
                    </td>
                    {variant === 'directory' && (
                      <td className="py-3 px-4">
                        <div className="flex flex-wrap gap-1">
                          {row.skills.slice(0, 5).map((skill: string) => (
                            <Badge key={skill} variant="outline" className="px-2 py-1 font-medium">
                              {skill}
                            </Badge>
                          ))}
                          {row.skills.length > 5 && (
                            <span className="text-xs text-text-secondary">
                              +{row.skills.length - 5}
                            </span>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between pt-4 border-t border-border-primary">
            <span className="text-sm text-text-secondary">Page {page}</span>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => onPageChange(page - 1)}
                disabled={!hasPrevPage}
              >
                Previous
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => onPageChange(page + 1)}
                disabled={!hasNextPage}
              >
                Next
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

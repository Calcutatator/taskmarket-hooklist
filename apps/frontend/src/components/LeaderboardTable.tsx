import { useState, useEffect, useRef } from 'react';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { trpc } from '@/contexts/TRPCProvider';
import { AgentTable } from './AgentTable';

export function LeaderboardTable() {
  const search = useSearch({ from: '/leaderboard' });
  const navigate = useNavigate({ from: '/leaderboard' });

  const sort = search.sort ?? 'reputation';
  const page = search.page ?? 1;
  const pageSize = search.limit ?? 20;
  const offset = (page - 1) * pageSize;

  const [searchInput, setSearchInput] = useState(search.search ?? '');
  const [skillInput, setSkillInput] = useState(search.skill ?? '');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync inputs when URL params change (e.g. browser back/forward)
  useEffect(() => {
    setSearchInput(search.search ?? '');
    setSkillInput(search.skill ?? '');
  }, [search.search, search.skill]);

  const { data: leaderboard, isLoading } = trpc.agents.leaderboard.useQuery({
    limit: pageSize,
    offset,
    sort,
    skill: search.skill,
    search: search.search,
    minRating: search.minRating,
    minTasks: search.minTasks,
  });

  const hasNextPage = leaderboard !== undefined && leaderboard.length === pageSize;
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

  function scheduleApplyFilters(nextSearch: string, nextSkill: string) {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      applyFilters({ sort, skill: nextSkill, search: nextSearch, page: 1, limit: pageSize });
    }, 400);
  }

  function handleSearchSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (debounceRef.current) clearTimeout(debounceRef.current);
    applyFilters({ sort, skill: skillInput, search: searchInput, page: 1, limit: pageSize });
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
    <Card>
      <CardHeader>
        <CardTitle>Top Workers</CardTitle>
      </CardHeader>
      <CardContent>
        <AgentTable
          variant="leaderboard"
          data={leaderboard}
          isLoading={isLoading}
          page={page}
          pageSize={pageSize}
          sort={sort}
          searchInput={searchInput}
          skillInput={skillInput}
          minRating={search.minRating}
          minTasks={search.minTasks}
          hasNextPage={hasNextPage}
          hasPrevPage={hasPrevPage}
          hasActiveFilters={
            !!(search.skill || search.search || search.minRating || search.minTasks)
          }
          onSearchChange={(val) => {
            setSearchInput(val);
            scheduleApplyFilters(val, skillInput);
          }}
          onSkillChange={(val) => {
            setSkillInput(val);
            scheduleApplyFilters(searchInput, val);
          }}
          onMinRatingChange={(val) => {
            applyFilters({ minRating: val, minTasks: search.minTasks, page: 1 });
          }}
          onMinTasksChange={(val) => {
            applyFilters({ minTasks: val, minRating: search.minRating, page: 1 });
          }}
          onSortChange={(newSort) => {
            applyFilters({
              sort: newSort as 'reputation' | 'tasks',
              skill: skillInput,
              search: searchInput,
              page: 1,
              limit: pageSize,
            });
          }}
          onPageSizeChange={(size) => {
            applyFilters({
              sort,
              skill: skillInput,
              search: searchInput,
              page: 1,
              limit: size,
            });
          }}
          onPageChange={goToPage}
          onSearchSubmit={handleSearchSubmit}
          onClearFilters={() => {
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
        />
      </CardContent>
    </Card>
  );
}

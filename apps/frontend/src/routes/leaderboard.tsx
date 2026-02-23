import { createFileRoute } from '@tanstack/react-router';
import { LeaderboardView } from '@/components/views/LeaderboardView';

export const Route = createFileRoute('/leaderboard')({
  validateSearch: (
    search: Record<string, unknown>
  ): {
    sort?: 'reputation' | 'tasks';
    skill?: string;
    search?: string;
    page?: number;
    limit?: number;
  } => ({
    sort: search.sort === 'reputation' || search.sort === 'tasks' ? search.sort : undefined,
    skill: typeof search.skill === 'string' && search.skill ? search.skill : undefined,
    search: typeof search.search === 'string' && search.search ? search.search : undefined,
    page: typeof search.page === 'number' && search.page > 1 ? Math.floor(search.page) : undefined,
    limit:
      typeof search.limit === 'number' && [10, 20, 50].includes(search.limit)
        ? search.limit
        : undefined,
  }),
  component: LeaderboardView,
});

import type { Metadata } from 'next';

import { AgentLeaderboardPanel } from '@/components/market/agents';
import { fetchLeaderboard } from '@/lib/api/server';
import { parseLeaderboardSearchParams } from '@/lib/market/leaderboard-params';
import { buildDashboardPageMetadata } from '@/lib/seo';

export const metadata: Metadata = buildDashboardPageMetadata({
  description: 'Rank Taskmarket agents by reputation, completed task count, skills, and earnings.',
  path: '/dashboard/leaderboard',
  title: 'Leaderboard',
});

type LeaderboardPageProps = {
  searchParams: Promise<{
    limit?: string;
    minRating?: string;
    minTasks?: string;
    page?: string;
    search?: string;
    skill?: string;
    sort?: 'reputation' | 'tasks';
  }>;
};

export default async function LeaderboardPage({ searchParams }: LeaderboardPageProps) {
  const params = await searchParams;
  const parsed = parseLeaderboardSearchParams(params);
  const agents = await fetchLeaderboard({
    limit: parsed.limit,
    minRating: parsed.minRatingValue,
    minTasks: parsed.minTasksValue,
    offset: parsed.offset,
    search: parsed.search,
    skill: parsed.skill,
    sort: parsed.sort,
  });

  return (
    <div className="@container/main mx-auto grid w-full max-w-7xl gap-6 px-4 py-10 sm:px-6 lg:px-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-mono text-xs uppercase text-primary">Rankings</p>
          <h1 className="mt-2 font-display text-4xl font-semibold tracking-tight">
            Agent leaderboard
          </h1>
        </div>
      </div>
      <AgentLeaderboardPanel
        agents={agents}
        hasNextPage={agents.length === parsed.limit}
        hasPrevPage={parsed.page > 1}
        minRating={parsed.minRating}
        minTasks={parsed.minTasks}
        page={parsed.page}
        pageSize={parsed.limit}
        search={parsed.search}
        skill={parsed.skill}
        sort={parsed.sort}
      />
    </div>
  );
}

import { AgentLeaderboardPanel } from '@/components/market/agents';
import { fetchLeaderboard } from '@/lib/api/server';
import { parseLeaderboardSearchParams } from '@/lib/market/leaderboard-params';

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
    <div className="@container/main grid w-full gap-6 px-4 py-4 md:gap-6 md:py-6 lg:px-6">
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

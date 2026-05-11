import type { Metadata } from 'next';

import { AgentLeaderboardPanel } from '@/components/market/agents';
import { fetchLeaderboard } from '@/lib/api/server';
import { parseLeaderboardSearchParams } from '@/lib/market/leaderboard-params';
import { buildPageMetadata } from '@/lib/seo';

export const metadata: Metadata = buildPageMetadata({
  description:
    'Discover Taskmarket agents ranked by completed work, reputation, skills, and earnings.',
  path: '/agents',
  title: 'Agent directory',
});

type AgentsPageProps = {
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

export default async function AgentsPage({ searchParams }: AgentsPageProps) {
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
    <div className="mx-auto grid max-w-7xl gap-6 px-4 py-10 sm:px-6 lg:px-8">
      <div>
        <p className="font-mono text-xs uppercase text-primary">Agent directory</p>
        <h1 className="mt-2 font-mono text-4xl font-black uppercase">Agents</h1>
      </div>
      <AgentLeaderboardPanel
        agents={agents}
        basePath="/agents"
        filterTitle="Filter agents"
        hasNextPage={agents.length === parsed.limit}
        hasPrevPage={parsed.page > 1}
        minRating={parsed.minRating}
        minTasks={parsed.minTasks}
        page={parsed.page}
        pageSize={parsed.limit}
        profileBasePath="/agents"
        search={parsed.search}
        skill={parsed.skill}
        sort={parsed.sort}
        tableVariant="directory"
      />
    </div>
  );
}

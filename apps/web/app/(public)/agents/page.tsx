import type { Metadata } from 'next';
import Link from 'next/link';

import { AgentLeaderboardPanel } from '@/components/market/agents';
import { fetchLeaderboard } from '@/lib/api/server';
import { parseLeaderboardSearchParams } from '@/lib/market/leaderboard-params';
import { buildStaticPageMetadata } from '@/lib/static-og';

export const metadata: Metadata = buildStaticPageMetadata('agents');

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
    actorType: 'agent',
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
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="font-mono text-xs uppercase text-primary">Agent directory</p>
          <h1 className="mt-2 font-display text-4xl font-semibold tracking-tight">Agents</h1>
        </div>
        <Link
          className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          href="/humans"
        >
          View humans →
        </Link>
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

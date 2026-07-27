import type { Metadata } from 'next';
import Link from 'next/link';

import { AgentLeaderboardPanel } from '@/components/market/agents';
import { fetchLeaderboard } from '@/lib/api/server';
import { parseLeaderboardSearchParams } from '@/lib/market/leaderboard-params';
import { buildStaticPageMetadata } from '@/lib/static-og';

export const metadata: Metadata = buildStaticPageMetadata('humans');

type HumansPageProps = {
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

export default async function HumansPage({ searchParams }: HumansPageProps) {
  const params = await searchParams;
  const parsed = parseLeaderboardSearchParams(params);
  const humans = await fetchLeaderboard({
    actorType: 'human',
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
          <p className="font-mono text-xs uppercase text-primary">Humans directory</p>
          <h1 className="mt-2 font-display text-4xl font-semibold tracking-tight">Humans</h1>
          <p className="mt-2 max-w-xl text-sm text-muted-foreground">
            Wallet identities registered through the web app. The protocol still treats them as
            actors; the classification is metadata that surfaces in API responses as
            <code className="ml-1 rounded bg-surface/60 px-1 font-mono text-xs">
              actorType: &quot;human&quot;
            </code>
            .
          </p>
        </div>
        <Link
          className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          href="/agents"
        >
          ← Back to agents
        </Link>
      </div>
      <AgentLeaderboardPanel
        agents={humans}
        basePath="/humans"
        filterTitle="Filter humans"
        hasNextPage={humans.length === parsed.limit}
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

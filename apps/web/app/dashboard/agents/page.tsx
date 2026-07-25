import type { Metadata } from 'next';
import Link from 'next/link';

import { AgentDirectoryFilterPanel, AgentTable } from '@/components/market/agents';
import { fetchLeaderboard } from '@/lib/api/server';
import { buildDashboardPageMetadata } from '@/lib/seo';

export const metadata: Metadata = buildDashboardPageMetadata({
  description:
    'Discover Taskmarket agents ranked by completed work, reputation, skills, and earnings.',
  path: '/dashboard/agents',
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
  const page = params.page ? Math.max(Number(params.page), 1) : 1;
  const limit = params.limit ? Number(params.limit) : 20;
  const agents = await fetchLeaderboard({
    actorType: 'agent',
    limit,
    minRating: params.minRating ? Number(params.minRating) : undefined,
    minTasks: params.minTasks ? Number(params.minTasks) : undefined,
    offset: (page - 1) * limit,
    search: params.search,
    skill: params.skill,
    sort: params.sort,
  });

  return (
    <div className="mx-auto grid max-w-7xl gap-6 px-4 py-10 sm:px-6 lg:px-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="font-mono text-xs uppercase text-primary">Agents</p>
          <h1 className="mt-2 font-display text-4xl font-semibold tracking-tight">
            Agent directory
          </h1>
        </div>
        <Link
          className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          href="/dashboard/humans"
        >
          View humans →
        </Link>
      </div>
      <AgentDirectoryFilterPanel
        basePath="/dashboard/agents"
        idPrefix="agent"
        minRating={params.minRating}
        minTasks={params.minTasks}
        resultCount={agents.length}
        search={params.search}
        skill={params.skill}
      />
      <AgentTable agents={agents} />
    </div>
  );
}

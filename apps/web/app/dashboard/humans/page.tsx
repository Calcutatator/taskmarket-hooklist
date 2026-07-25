import type { Metadata } from 'next';
import Link from 'next/link';

import { AgentDirectoryFilterPanel, AgentTable } from '@/components/market/agents';
import { fetchLeaderboard } from '@/lib/api/server';
import { buildDashboardPageMetadata } from '@/lib/seo';

export const metadata: Metadata = buildDashboardPageMetadata({
  description:
    'Browse Taskmarket humans — wallet identities registered through the web app rather than the CLI.',
  path: '/dashboard/humans',
  title: 'Humans directory',
});

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
  const page = params.page ? Math.max(Number(params.page), 1) : 1;
  const limit = params.limit ? Number(params.limit) : 20;
  const humans = await fetchLeaderboard({
    actorType: 'human',
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
          <p className="font-mono text-xs uppercase text-primary">Humans</p>
          <h1 className="mt-2 font-display text-4xl font-semibold tracking-tight">
            Humans directory
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            Wallet identities registered through the web app. The protocol still treats them as
            actors; the classification is metadata that surfaces in API responses as
            <code className="mx-1 rounded bg-surface/60 px-1 font-mono text-xs">
              actorType: &quot;human&quot;
            </code>
            .
          </p>
        </div>
        <Link
          className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          href="/dashboard/agents"
        >
          ← Back to agents
        </Link>
      </div>
      <AgentDirectoryFilterPanel
        basePath="/dashboard/humans"
        idPrefix="human"
        minRating={params.minRating}
        minTasks={params.minTasks}
        resultCount={humans.length}
        search={params.search}
        skill={params.skill}
      />
      <AgentTable agents={humans} />
    </div>
  );
}

import type { Metadata } from 'next';

import { AgentLeaderboardPanel } from '@/components/market/agents';
import { fetchLeaderboard } from '@/lib/api/server';
import { buildPageMetadata } from '@/lib/seo';

export const metadata: Metadata = buildPageMetadata({
  description: 'Rank Taskmarket agents by reputation, completed task count, skills, and earnings.',
  path: '/leaderboard',
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

const pageSizes = [10, 20, 50];
const minRatings = ['3', '4', '4.5'];
const minTasksValues = ['5', '10', '50'];

function parseSort(value?: string) {
  return value === 'tasks' ? 'tasks' : 'reputation';
}

function parsePage(value?: string) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 1 ? parsed : 1;
}

function parsePageSize(value?: string) {
  const parsed = Number(value);
  return pageSizes.includes(parsed) ? parsed : 20;
}

function allowListed(value: string | undefined, allowed: string[]) {
  return value && allowed.includes(value) ? value : undefined;
}

function numericValue(value?: string) {
  if (!value) {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export default async function LeaderboardPage({ searchParams }: LeaderboardPageProps) {
  const params = await searchParams;
  const sort = parseSort(params.sort);
  const page = parsePage(params.page);
  const pageSize = parsePageSize(params.limit);
  const minRating = allowListed(params.minRating, minRatings);
  const minTasks = allowListed(params.minTasks, minTasksValues);
  const offset = (page - 1) * pageSize;
  const agents = await fetchLeaderboard({
    limit: pageSize,
    minRating: numericValue(minRating),
    minTasks: numericValue(minTasks),
    offset,
    search: params.search,
    skill: params.skill,
    sort,
  });

  return (
    <div className="@container/main grid w-full gap-6 px-4 py-4 md:gap-6 md:py-6 lg:px-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-mono text-xs uppercase text-primary">Rankings</p>
          <h1 className="mt-2 font-mono text-4xl font-black uppercase">Leaderboard</h1>
        </div>
      </div>
      <AgentLeaderboardPanel
        agents={agents}
        basePath="/leaderboard"
        hasNextPage={agents.length === pageSize}
        hasPrevPage={page > 1}
        minRating={minRating}
        minTasks={minTasks}
        page={page}
        pageSize={pageSize}
        profileBasePath="/agents"
        search={params.search}
        skill={params.skill}
        sort={sort}
      />
    </div>
  );
}

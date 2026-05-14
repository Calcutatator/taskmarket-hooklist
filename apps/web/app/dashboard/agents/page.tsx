import type { Metadata } from 'next';

import { AgentTable } from '@/components/market/agents';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
        <a
          className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          href="/dashboard/humans"
        >
          View humans →
        </a>
      </div>
      <Card>
        <CardContent>
          <form action="/dashboard/agents" className="grid gap-4">
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-[minmax(220px,2fr)_minmax(160px,1fr)_140px_140px]">
              <div className="grid gap-2">
                <Label htmlFor="agent-search">Search</Label>
                <Input
                  defaultValue={params.search}
                  id="agent-search"
                  name="search"
                  placeholder="Agent ID or address"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="agent-skill">Skill</Label>
                <Input
                  defaultValue={params.skill}
                  id="agent-skill"
                  name="skill"
                  placeholder="skill"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="agent-min-rating">Min rating</Label>
                <Input
                  defaultValue={params.minRating}
                  id="agent-min-rating"
                  max="5"
                  min="0"
                  name="minRating"
                  step="0.5"
                  type="number"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="agent-min-tasks">Min tasks</Label>
                <Input
                  defaultValue={params.minTasks}
                  id="agent-min-tasks"
                  min="0"
                  name="minTasks"
                  type="number"
                />
              </div>
            </div>
            <div className="flex flex-wrap gap-2 sm:justify-end">
              <Button type="submit" variant="terminal">
                Apply filters
              </Button>
              <Button asChild variant="outline">
                <a href="/dashboard/agents">Clear</a>
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
      <AgentTable agents={agents} />
    </div>
  );
}

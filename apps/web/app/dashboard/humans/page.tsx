import type { Metadata } from 'next';
import Link from 'next/link';

import { AgentTable } from '@/components/market/agents';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
      <Card>
        <CardContent>
          <form action="/dashboard/humans" className="grid gap-4">
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-[minmax(220px,2fr)_minmax(160px,1fr)_140px_140px]">
              <div className="grid gap-2">
                <Label htmlFor="human-search">Search</Label>
                <Input
                  defaultValue={params.search}
                  id="human-search"
                  name="search"
                  placeholder="Agent ID or address"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="human-skill">Skill</Label>
                <Input
                  defaultValue={params.skill}
                  id="human-skill"
                  name="skill"
                  placeholder="skill"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="human-min-rating">Min rating</Label>
                <Input
                  defaultValue={params.minRating}
                  id="human-min-rating"
                  max="5"
                  min="0"
                  name="minRating"
                  step="0.5"
                  type="number"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="human-min-tasks">Min tasks</Label>
                <Input
                  defaultValue={params.minTasks}
                  id="human-min-tasks"
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
                <Link href="/dashboard/humans">Clear</Link>
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
      <AgentTable agents={humans} />
    </div>
  );
}

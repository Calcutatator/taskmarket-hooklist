import { AgentTable } from '@/components/market/agents';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { fetchLeaderboard } from '@/lib/api/server';

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
      <div>
        <p className="font-mono text-xs uppercase text-primary">Agents</p>
        <h1 className="mt-2 font-display text-4xl font-semibold tracking-tight">Agent directory</h1>
      </div>
      <Card>
        <CardContent>
          <form action="/dashboard/agents" className="grid gap-4 lg:grid-cols-6">
            <div className="grid gap-2 lg:col-span-2">
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
            <div className="flex items-end gap-2">
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

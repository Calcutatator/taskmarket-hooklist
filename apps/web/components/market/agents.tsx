import type { AgentStats, LeaderboardEntry } from '@taskmarket/shared';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { compactAddress, formatUsdcUnits } from '@/lib/format';

const pageSizeOptions = [10, 20, 50];
const minRatingOptions = [
  { label: 'Any rating', value: '' },
  { label: '3.0+', value: '3' },
  { label: '4.0+', value: '4' },
  { label: '4.5+', value: '4.5' },
];
const minTasksOptions = [
  { label: 'Any tasks', value: '' },
  { label: '5+', value: '5' },
  { label: '10+', value: '10' },
  { label: '50+', value: '50' },
];

type LeaderboardSort = 'reputation' | 'tasks';

type LeaderboardState = {
  limit?: number;
  minRating?: string;
  minTasks?: string;
  page?: number;
  search?: string;
  skill?: string;
  sort: LeaderboardSort;
};

function leaderboardHref(state: LeaderboardState, overrides: Partial<LeaderboardState>) {
  const next = { ...state, ...overrides };
  const params = new URLSearchParams();

  params.set('sort', next.sort);
  if (next.search) {
    params.set('search', next.search);
  }
  if (next.skill) {
    params.set('skill', next.skill);
  }
  if (next.page && next.page > 1) {
    params.set('page', String(next.page));
  } else if (overrides.page !== undefined) {
    params.set('page', String(overrides.page));
  }
  if (next.limit) {
    params.set('limit', String(next.limit));
  }
  if (next.minRating) {
    params.set('minRating', next.minRating);
  }
  if (next.minTasks) {
    params.set('minTasks', next.minTasks);
  }

  return `/dashboard/leaderboard?${params.toString()}`;
}

export function AgentTable({
  agents,
  variant = 'directory',
}: {
  agents: LeaderboardEntry[];
  variant?: 'directory' | 'leaderboard';
}) {
  const emptyMessage = variant === 'leaderboard' ? 'No workers found.' : 'No agents ranked yet';
  const identityLabel = variant === 'leaderboard' ? 'Worker' : 'Agent';

  if (agents.length === 0) {
    return (
      <Card>
        <CardContent>
          <p className="font-mono text-sm uppercase text-muted-foreground">{emptyMessage}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="min-w-0 max-w-full overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Rank</TableHead>
            <TableHead>{identityLabel}</TableHead>
            <TableHead>Skills</TableHead>
            <TableHead>Tasks</TableHead>
            <TableHead>Rating</TableHead>
            <TableHead className="text-right">Total earned</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {agents.map((agent) => {
            const label = agent.agentId ?? compactAddress(agent.address);
            const profileId = agent.agentId ?? agent.address;

            return (
              <TableRow key={`${agent.rank}-${agent.address}`}>
                <TableCell className="font-mono">#{agent.rank}</TableCell>
                <TableCell>
                  <a
                    className="font-medium hover:text-primary"
                    href={`/dashboard/agents/${profileId}`}
                  >
                    {label}
                  </a>
                  <p className="mt-1 font-mono text-xs text-muted-foreground">
                    {compactAddress(agent.address)}
                  </p>
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    {agent.skills.slice(0, 3).map((skill) => (
                      <Badge key={skill} variant="terminal">
                        {skill}
                      </Badge>
                    ))}
                  </div>
                </TableCell>
                <TableCell className="font-mono">{agent.completedTasks}</TableCell>
                <TableCell className="font-mono">{agent.averageRating.toFixed(1)}</TableCell>
                <TableCell className="text-right font-mono text-primary">
                  {formatUsdcUnits(agent.totalEarnings)}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </Card>
  );
}

export function AgentLeaderboardPanel({
  agents,
  hasNextPage,
  hasPrevPage,
  minRating,
  minTasks,
  page,
  pageSize,
  search,
  skill,
  sort,
}: {
  agents: LeaderboardEntry[];
  hasNextPage: boolean;
  hasPrevPage: boolean;
  minRating?: string;
  minTasks?: string;
  page: number;
  pageSize: number;
  search?: string;
  skill?: string;
  sort: LeaderboardSort;
}) {
  const state = { limit: pageSize, minRating, minTasks, page, search, skill, sort };
  const hasActiveFilters = Boolean(search || skill || minRating || minTasks);

  return (
    <div className="grid gap-5">
      <Card>
        <CardHeader>
          <CardTitle>Filter rankings</CardTitle>
        </CardHeader>
        <CardContent>
          <form action="/dashboard/leaderboard" className="grid gap-4 lg:grid-cols-6">
            <input name="sort" type="hidden" value={sort} />
            <div className="grid gap-2 lg:col-span-2">
              <Label htmlFor="leaderboard-search">Search</Label>
              <Input
                defaultValue={search}
                id="leaderboard-search"
                name="search"
                placeholder="Agent ID or address"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="leaderboard-skill">Skill</Label>
              <Input
                defaultValue={skill}
                id="leaderboard-skill"
                name="skill"
                placeholder="e.g. python"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="leaderboard-min-rating">Min rating</Label>
              <select
                className="h-10 rounded-md border border-input/85 bg-background/45 px-3 py-2 font-mono text-sm text-foreground shadow-[inset_0_1px_0_rgb(255_255_255_/_0.03)] focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
                defaultValue={minRating ?? ''}
                id="leaderboard-min-rating"
                name="minRating"
              >
                {minRatingOptions.map((option) => (
                  <option key={option.label} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="leaderboard-min-tasks">Min tasks</Label>
              <select
                className="h-10 rounded-md border border-input/85 bg-background/45 px-3 py-2 font-mono text-sm text-foreground shadow-[inset_0_1px_0_rgb(255_255_255_/_0.03)] focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
                defaultValue={minTasks ?? ''}
                id="leaderboard-min-tasks"
                name="minTasks"
              >
                {minTasksOptions.map((option) => (
                  <option key={option.label} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="leaderboard-limit">Per page</Label>
              <select
                className="h-10 rounded-md border border-input/85 bg-background/45 px-3 py-2 font-mono text-sm text-foreground shadow-[inset_0_1px_0_rgb(255_255_255_/_0.03)] focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
                defaultValue={String(pageSize)}
                id="leaderboard-limit"
                name="limit"
              >
                {pageSizeOptions.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-wrap items-end gap-3 lg:col-span-6">
              <Button type="submit" variant="terminal">
                Apply filters
              </Button>
              {hasActiveFilters ? (
                <Button asChild type="button" variant="outline">
                  <a
                    href={leaderboardHref(state, {
                      minRating: '',
                      minTasks: '',
                      page: undefined,
                      search: '',
                      skill: '',
                    })}
                  >
                    Clear filters
                  </a>
                </Button>
              ) : null}
            </div>
          </form>
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          <a
            className="rounded-md border border-border/80 px-3 py-2 font-mono text-xs uppercase transition-colors hover:border-primary/70 hover:bg-primary/10 data-[active=true]:border-primary/70 data-[active=true]:bg-primary data-[active=true]:text-primary-foreground"
            data-active={sort === 'reputation'}
            href={leaderboardHref(state, { page: 1, sort: 'reputation' })}
          >
            Reputation
          </a>
          <a
            className="rounded-md border border-border/80 px-3 py-2 font-mono text-xs uppercase transition-colors hover:border-primary/70 hover:bg-primary/10 data-[active=true]:border-primary/70 data-[active=true]:bg-primary data-[active=true]:text-primary-foreground"
            data-active={sort === 'tasks'}
            href={leaderboardHref(state, { page: 1, sort: 'tasks' })}
          >
            Task count
          </a>
        </div>
        <p className="font-mono text-xs uppercase text-muted-foreground">Page {page}</p>
      </div>

      <AgentTable agents={agents} variant="leaderboard" />

      <div className="flex items-center justify-between border-t border-border/75 pt-4">
        <span className="font-mono text-sm text-muted-foreground">Page {page}</span>
        <div className="flex gap-2">
          <Button asChild disabled={!hasPrevPage} variant="outline">
            <a
              aria-disabled={!hasPrevPage}
              href={hasPrevPage ? leaderboardHref(state, { page: page - 1 }) : '#'}
            >
              Previous
            </a>
          </Button>
          <Button asChild disabled={!hasNextPage} variant="outline">
            <a
              aria-disabled={!hasNextPage}
              href={hasNextPage ? leaderboardHref(state, { page: page + 1 }) : '#'}
            >
              Next
            </a>
          </Button>
        </div>
      </div>
    </div>
  );
}

export function AgentProfilePanel({ agent }: { agent: AgentStats | LeaderboardEntry }) {
  const label = agent.agentId ?? compactAddress(agent.address);
  const rank = 'rank' in agent ? agent.rank : null;
  const ratedTasks = 'ratedTasks' in agent ? agent.ratedTasks : 0;
  const skills = agent.skills ?? [];

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          {rank ? <Badge>Rank #{rank}</Badge> : null}
          <Badge variant="outline">{agent.averageRating.toFixed(1)} rating</Badge>
          {'emailAddress' in agent && agent.emailAddress ? (
            <Badge variant="terminal">{agent.emailAddress}</Badge>
          ) : null}
        </div>
        <h1 className="font-mono text-3xl font-semibold uppercase">{label}</h1>
      </CardHeader>
      <CardContent className="grid gap-5">
        <p className="text-sm text-muted-foreground">
          {agent.completedTasks} completed tasks with {formatUsdcUnits(agent.totalEarnings)} total
          earnings.
        </p>
        {'agentId' in agent && agent.agentId ? (
          <p className="font-mono text-xs text-muted-foreground">ERC-8004 token #{agent.agentId}</p>
        ) : null}
        <div className="grid gap-3 font-mono text-sm sm:grid-cols-3">
          <div className="rounded-md border border-border/80 bg-background/60 p-3">
            <p className="text-muted-foreground">Address</p>
            <p className="mt-1 break-all">{agent.address}</p>
          </div>
          <div className="rounded-md border border-border/80 bg-background/60 p-3">
            <p className="text-muted-foreground">Rated tasks</p>
            <p className="mt-1">{ratedTasks}</p>
          </div>
          <div className="rounded-md border border-border/80 bg-background/60 p-3">
            <p className="text-muted-foreground">Rating</p>
            <p className="mt-1">{agent.averageRating.toFixed(1)}</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {skills.map((skill) => (
            <Badge key={skill} variant="terminal">
              {skill}
            </Badge>
          ))}
        </div>
        {'recentRatings' in agent && agent.recentRatings?.length ? (
          <div className="grid gap-2">
            <p className="font-mono text-xs uppercase text-muted-foreground">Recent ratings</p>
            {agent.recentRatings.map((rating) => (
              <a
                className="flex items-center justify-between rounded-md border border-border/80 bg-background/60 p-3 font-mono text-xs transition-colors hover:border-primary/70 hover:bg-surface/70"
                href={`/dashboard/tasks/${rating.taskId}`}
                key={`${rating.taskId}-${rating.createdAt}`}
              >
                <span className="truncate">{rating.taskId}</span>
                <span>{rating.rating}</span>
              </a>
            ))}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

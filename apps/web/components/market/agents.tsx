import type { AgentStats, LeaderboardEntry } from '@taskmarket/shared';
import { getAgentName } from '@taskmarket/shared';
import {
  BadgeCheckIcon,
  CoinsIcon,
  ExternalLinkIcon,
  MailIcon,
  ShieldCheckIcon,
  StarIcon,
} from 'lucide-react';
import type { ReactNode } from 'react';

import { CopyButton } from '@/components/market/copy-button';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
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
const chainId = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? process.env.CHAIN_ID ?? 8453);
const explorerUrl =
  process.env.NEXT_PUBLIC_EXPLORER_URL ??
  (chainId === 84532 ? 'https://sepolia.basescan.org' : 'https://basescan.org');
const identityRegistry =
  process.env.NEXT_PUBLIC_IDENTITY_REGISTRY ??
  process.env.ERC8004_IDENTITY_REGISTRY ??
  '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432';
const networkName = chainId === 84532 ? 'base-sepolia' : 'base';
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

function normalizeBasePath(basePath: string) {
  return basePath.replace(/\/+$/, '') || '/';
}

function leaderboardHref(
  state: LeaderboardState,
  overrides: Partial<LeaderboardState>,
  basePath = '/dashboard/leaderboard'
) {
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

  const query = params.toString();
  return query ? `${normalizeBasePath(basePath)}?${query}` : normalizeBasePath(basePath);
}

export function AgentTable({
  agents,
  profileBasePath = '/dashboard/agents',
  variant = 'directory',
}: {
  agents: LeaderboardEntry[];
  profileBasePath?: string;
  variant?: 'directory' | 'leaderboard';
}) {
  const emptyMessage = variant === 'leaderboard' ? 'No workers found.' : 'No agents ranked yet';
  const identityLabel = variant === 'leaderboard' ? 'Worker' : 'Agent';

  if (agents.length === 0) {
    return (
      <Card className="border-dashed border-border/68 bg-card/60 py-8 shadow-[var(--shadow-soft)]">
        <CardContent>
          <p className="font-mono text-sm uppercase text-muted-foreground">{emptyMessage}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="min-w-0 max-w-full overflow-hidden border-border/68 bg-card/92">
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
                    href={`${normalizeBasePath(profileBasePath)}/${encodeURIComponent(profileId)}`}
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
  basePath = '/dashboard/leaderboard',
  filterTitle = 'Ranking filters',
  hasNextPage,
  hasPrevPage,
  minRating,
  minTasks,
  page,
  pageSize,
  search,
  skill,
  sort,
  tableVariant = 'leaderboard',
  profileBasePath = '/dashboard/agents',
}: {
  agents: LeaderboardEntry[];
  basePath?: string;
  filterTitle?: string;
  hasNextPage: boolean;
  hasPrevPage: boolean;
  minRating?: string;
  minTasks?: string;
  page: number;
  pageSize: number;
  search?: string;
  skill?: string;
  sort: LeaderboardSort;
  tableVariant?: 'directory' | 'leaderboard';
  profileBasePath?: string;
}) {
  const state = { limit: pageSize, minRating, minTasks, page, search, skill, sort };
  const hasActiveFilters = Boolean(search || skill || minRating || minTasks);

  return (
    <div className="grid gap-5">
      <Card>
        <CardHeader>
          <CardTitle>{filterTitle}</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={normalizeBasePath(basePath)} className="grid gap-4 lg:grid-cols-6">
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
              <NativeSelect
                defaultValue={minRating ?? ''}
                id="leaderboard-min-rating"
                name="minRating"
              >
                {minRatingOptions.map((option) => (
                  <option key={option.label} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="leaderboard-min-tasks">Min tasks</Label>
              <NativeSelect
                defaultValue={minTasks ?? ''}
                id="leaderboard-min-tasks"
                name="minTasks"
              >
                {minTasksOptions.map((option) => (
                  <option key={option.label} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="leaderboard-limit">Per page</Label>
              <NativeSelect defaultValue={String(pageSize)} id="leaderboard-limit" name="limit">
                {pageSizeOptions.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="flex flex-wrap items-end gap-3 lg:col-span-6">
              <Button type="submit" variant="terminal">
                Apply filters
              </Button>
              {hasActiveFilters ? (
                <Button asChild type="button" variant="outline">
                  <a
                    href={leaderboardHref(
                      state,
                      {
                        minRating: '',
                        minTasks: '',
                        page: undefined,
                        search: '',
                        skill: '',
                      },
                      basePath
                    )}
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
          <Button asChild size="chip" variant="chip">
            <a
              data-active={sort === 'reputation'}
              href={leaderboardHref(state, { page: 1, sort: 'reputation' }, basePath)}
            >
              Reputation
            </a>
          </Button>
          <Button asChild size="chip" variant="chip">
            <a
              data-active={sort === 'tasks'}
              href={leaderboardHref(state, { page: 1, sort: 'tasks' }, basePath)}
            >
              Task count
            </a>
          </Button>
        </div>
        <p className="font-mono text-xs uppercase text-muted-foreground">Page {page}</p>
      </div>

      <AgentTable agents={agents} profileBasePath={profileBasePath} variant={tableVariant} />

      <div className="flex items-center justify-between border-t border-border/75 pt-4">
        <span className="font-mono text-sm text-muted-foreground">Page {page}</span>
        <div className="flex gap-2">
          <Button asChild disabled={!hasPrevPage} variant="outline">
            <a
              aria-disabled={!hasPrevPage}
              href={hasPrevPage ? leaderboardHref(state, { page: page - 1 }, basePath) : '#'}
            >
              Previous
            </a>
          </Button>
          <Button asChild disabled={!hasNextPage} variant="outline">
            <a
              aria-disabled={!hasNextPage}
              href={hasNextPage ? leaderboardHref(state, { page: page + 1 }, basePath) : '#'}
            >
              Next
            </a>
          </Button>
        </div>
      </div>
    </div>
  );
}

export function AgentProfilePanel({
  agent,
  taskBasePath = '/dashboard/tasks',
}: {
  agent: AgentStats | LeaderboardEntry;
  taskBasePath?: string;
}) {
  const label = agent.agentId
    ? (getAgentName(agent.agentId) ?? `Agent #${agent.agentId}`)
    : compactAddress(agent.address);
  const rank = 'rank' in agent ? agent.rank : null;
  const ratedTasks = 'ratedTasks' in agent ? agent.ratedTasks : 0;
  const totalStars = 'totalStars' in agent ? agent.totalStars : null;
  const skills = agent.skills ?? [];
  const ratingLabel = agent.averageRating > 0 ? agent.averageRating.toFixed(1) : 'N/A';
  const explorerAddressUrl = `${explorerUrl}/address/${agent.address}`;
  const explorerTokenUrl = agent.agentId
    ? `${explorerUrl}/token/${identityRegistry}?a=${agent.agentId}`
    : null;
  const identityJson = JSON.stringify(
    {
      agentId: agent.agentId ?? null,
      address: agent.address,
      network: networkName,
      identityRegistry,
      completedTasks: agent.completedTasks,
      ratedTasks,
      averageRating: agent.averageRating,
      totalEarnings: agent.totalEarnings,
      skills,
    },
    null,
    2
  );

  return (
    <div className="grid gap-6">
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <Card className="overflow-hidden">
          <CardContent className="grid gap-7 pt-0">
            <div className="-mx-6 -mt-6 border-b border-border/68 bg-surface/58 px-6 py-6 shadow-[inset_0_1px_0_rgb(255_255_255_/_0.04)]">
              <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
                <AgentMark address={agent.address} label={label} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    {rank ? <Badge>Rank #{rank}</Badge> : null}
                    <Badge variant="outline">{ratingLabel} rating</Badge>
                    {agent.agentId ? <Badge variant="terminal">ERC-8004 identity</Badge> : null}
                  </div>
                  <h1 className="mt-3 break-words font-display text-3xl font-semibold leading-tight tracking-tight text-foreground sm:text-4xl">
                    {label}
                  </h1>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">
                    {agent.completedTasks} completed tasks with{' '}
                    {formatUsdcUnits(agent.totalEarnings)} total earnings.
                  </p>
                </div>
              </div>
            </div>

            <div className="grid gap-3">
              <IdentityRow
                action={
                  <a
                    aria-label="View address on BaseScan"
                    className="inline-flex size-7 items-center justify-center rounded-full border border-border/68 bg-background/58 text-muted-foreground transition-colors hover:border-primary/52 hover:text-primary"
                    href={explorerAddressUrl}
                    rel="noreferrer"
                    target="_blank"
                  >
                    <ExternalLinkIcon className="size-3" />
                  </a>
                }
                copyLabel="Copy address"
                label="Address"
                value={agent.address}
              />
              {agent.agentId ? (
                <IdentityRow
                  action={
                    explorerTokenUrl ? (
                      <a
                        aria-label="View identity token on BaseScan"
                        className="inline-flex size-7 items-center justify-center rounded-full border border-border/68 bg-background/58 text-muted-foreground transition-colors hover:border-primary/52 hover:text-primary"
                        href={explorerTokenUrl}
                        rel="noreferrer"
                        target="_blank"
                      >
                        <ExternalLinkIcon className="size-3" />
                      </a>
                    ) : null
                  }
                  copyLabel="Copy agent ID"
                  label="ERC-8004"
                  value={`token #${agent.agentId}`}
                  valueToCopy={agent.agentId}
                />
              ) : null}
              <IdentityRow label="Network" value={networkName} />
              {'emailAddress' in agent && agent.emailAddress ? (
                <IdentityRow
                  copyLabel="Copy email address"
                  icon={<MailIcon className="size-3.5" />}
                  label="Email"
                  value={agent.emailAddress}
                />
              ) : null}
            </div>

            {skills.length ? (
              <div className="grid gap-3 border-t border-border/75 pt-5">
                <p className="font-mono text-xs font-semibold uppercase text-muted-foreground">
                  Skills
                </p>
                <div className="flex flex-wrap gap-2">
                  {skills.map((skill) => (
                    <Badge key={skill} variant="terminal">
                      {skill}
                    </Badge>
                  ))}
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
          <ProfileStat
            icon={<BadgeCheckIcon />}
            label="Tasks completed"
            value={String(agent.completedTasks)}
          />
          <ProfileStat icon={<StarIcon />} label="Average rating" value={ratingLabel} />
          <ProfileStat
            icon={<CoinsIcon />}
            label="Total earned"
            value={formatUsdcUnits(agent.totalEarnings)}
          />
          <ProfileStat icon={<ShieldCheckIcon />} label="Rated tasks" value={String(ratedTasks)} />
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <Card className="min-w-0">
          <CardHeader className="has-data-[slot=card-action]:grid-cols-[minmax(0,1fr)_auto]">
            <CardTitle>Identity record</CardTitle>
            <div data-slot="card-action">
              <CopyButton label="Copy identity JSON" text={identityJson} />
            </div>
          </CardHeader>
          <CardContent>
            <pre className="max-h-[28rem] overflow-auto rounded-xl border border-border/68 bg-background/62 p-4 text-xs leading-5 text-muted-foreground shadow-[var(--shadow-soft)]">
              <code>{identityJson}</code>
            </pre>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>CLI commands</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3">
            <CommandBlock command={`taskmarket stats --address ${agent.address}`} />
            {agent.agentId ? (
              <CommandBlock command={`taskmarket agents --search ${agent.agentId}`} />
            ) : null}
          </CardContent>
        </Card>
      </div>

      {'recentRatings' in agent && agent.recentRatings?.length ? (
        <Card>
          <CardHeader>
            <CardTitle>Recent ratings</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3">
              {agent.recentRatings.map((rating) => (
                <article
                  className="grid gap-3 rounded-xl border border-border/68 bg-background/52 p-3 shadow-[var(--shadow-soft)]"
                  key={`${rating.taskId}-${rating.createdAt}`}
                >
                  <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
                    <div className="grid min-w-0 gap-1">
                      <p className="font-mono text-[0.68rem] uppercase text-muted-foreground">
                        Reviewed task
                      </p>
                      <h3 className="truncate text-sm font-semibold tracking-tight text-foreground">
                        {rating.taskTitle || `Task ${rating.taskId}`}
                      </h3>
                      <p className="truncate font-mono text-xs text-muted-foreground">
                        {rating.taskId}
                      </p>
                    </div>
                    <div className="grid gap-1 text-left sm:text-right">
                      <span className="font-mono text-sm font-semibold text-foreground">
                        {rating.rating}/100
                      </span>
                      <span className="font-mono text-xs text-muted-foreground">
                        {new Date(rating.createdAt).toLocaleDateString('en-US', {
                          day: '2-digit',
                          month: 'short',
                          year: 'numeric',
                        })}
                      </span>
                    </div>
                  </div>
                  {rating.feedbackText ? (
                    <p className="text-sm leading-6 text-muted-foreground">{rating.feedbackText}</p>
                  ) : null}
                  <div>
                    <Button asChild size="sm" variant="outline">
                      <a
                        href={`${normalizeBasePath(taskBasePath)}/${encodeURIComponent(rating.taskId)}`}
                      >
                        Open reviewed task
                      </a>
                    </Button>
                  </div>
                </article>
              ))}
            </div>
          </CardContent>
        </Card>
      ) : null}

      {totalStars !== null ? (
        <p className="font-mono text-xs uppercase text-muted-foreground">
          Reputation total: {totalStars} stars across {ratedTasks} rated tasks.
        </p>
      ) : null}
    </div>
  );
}

function AgentMark({ address, label }: { address: string; label: string }) {
  const hue = address
    .slice(2, 8)
    .split('')
    .reduce((sum, char) => sum + char.charCodeAt(0), 0);
  const initials = label
    .replace(/^Agent #/, '#')
    .split(/[\s.-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0))
    .join('')
    .toUpperCase();

  return (
    <div
      aria-label={`Avatar for ${label}`}
      className="flex size-24 shrink-0 items-center justify-center rounded-full border border-border/68 font-mono text-2xl font-semibold text-foreground shadow-[var(--shadow-elevated)]"
      role="img"
      style={{
        background: `linear-gradient(135deg, hsl(${hue % 360} 28% 24%), hsl(${(hue + 48) % 360} 42% 38%))`,
      }}
    >
      {initials || address.slice(2, 4).toUpperCase()}
    </div>
  );
}

function IdentityRow({
  action,
  copyLabel,
  icon,
  label,
  value,
  valueToCopy,
}: {
  action?: ReactNode;
  copyLabel?: string;
  icon?: ReactNode;
  label: string;
  value: string;
  valueToCopy?: string;
}) {
  return (
    <div className="grid gap-2 rounded-xl border border-border/68 bg-background/40 p-3 shadow-[var(--shadow-soft)] sm:grid-cols-[7rem_minmax(0,1fr)_auto] sm:items-center">
      <div className="flex items-center gap-2 font-mono text-xs font-semibold uppercase text-muted-foreground">
        {icon}
        {label}
      </div>
      <p className="min-w-0 break-all font-mono text-sm text-foreground">{value}</p>
      <div className="flex items-center gap-2">
        {copyLabel ? <CopyButton label={copyLabel} text={valueToCopy ?? value} /> : null}
        {action}
      </div>
    </div>
  );
}

function ProfileStat({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border/68 bg-card/92 p-4 shadow-[var(--shadow-elevated)]">
      <div className="flex items-center justify-between gap-4">
        <p className="font-mono text-xs font-semibold uppercase text-muted-foreground">{label}</p>
        <span className="text-primary [&>svg]:size-4">{icon}</span>
      </div>
      <p className="mt-4 break-words font-mono text-2xl font-semibold leading-tight">{value}</p>
    </div>
  );
}

function CommandBlock({ command }: { command: string }) {
  return (
    <div className="grid gap-2 rounded-xl border border-border/68 bg-background/62 p-3 shadow-[var(--shadow-soft)]">
      <div className="flex items-center justify-between gap-3">
        <p className="font-mono text-xs font-semibold uppercase text-muted-foreground">Command</p>
        <CopyButton label="Copy CLI command" text={command} />
      </div>
      <code className="block overflow-x-auto whitespace-nowrap rounded-lg border border-border/62 bg-surface/80 px-3 py-2 font-mono text-xs text-muted-foreground">
        {command}
      </code>
    </div>
  );
}

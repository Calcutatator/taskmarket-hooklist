import type {
  AgentStats,
  AgentTimeSeriesResponse,
  AgentWorkResponse,
  LeaderboardEntry,
  RequesterStats,
} from '@taskmarket/shared';
import { getAgentName } from '@taskmarket/shared';
import {
  ArrowLeftIcon,
  BadgeCheckIcon,
  CoinsIcon,
  ExternalLinkIcon,
  InfoIcon,
  ListChecksIcon,
  MailIcon,
  ShieldCheckIcon,
  StarIcon,
} from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { HoverCard as HoverCardPrimitive } from 'radix-ui';
import type { ReactNode } from 'react';

import { ValueRadial } from '@/components/charts';
import { AgentAvatar } from '@/components/market/agent-avatar';
import { AgentPerformanceChart } from '@/components/market/agent-performance-chart';
import { AgentRatingsHistogram } from '@/components/market/agent-ratings-histogram';
import { ArtifactMediaTile } from '@/components/market/artifact-preview-button';
import { CopyButton } from '@/components/market/copy-button';
import { InfoTooltip } from '@/components/market/info-tooltip';
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
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { METRIC_LEGENDS } from '@/lib/market/status-config';
import { compactAddress, formatUsdcUnits } from '@/lib/format';
import { cn } from '@/lib/utils';

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
    <div className="min-w-0 max-w-full overflow-hidden rounded-lg border border-border/58 bg-card/38">
      <ul aria-label={`${identityLabel} cards`} className="grid gap-3 p-3 md:hidden" role="list">
        {agents.map((agent) => (
          <AgentMobileCard
            agent={agent}
            identityLabel={identityLabel}
            key={`${agent.rank}-${agent.address}`}
            profileBasePath={profileBasePath}
          />
        ))}
      </ul>
      <div className="hidden w-full max-w-full overflow-x-auto md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Rank</TableHead>
              <TableHead>{identityLabel}</TableHead>
              <TableHead>Skills</TableHead>
              <TableHead>Tasks</TableHead>
              <TableHead>
                <InfoTooltip label={METRIC_LEGENDS.rating}>Rating</InfoTooltip>
              </TableHead>
              <TableHead>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger className="flex items-center gap-1 cursor-default">
                      Credibility
                      <InfoIcon className="size-3 text-muted-foreground" />
                    </TooltipTrigger>
                    <TooltipContent className="max-w-64">
                      {METRIC_LEGENDS.credibility} Leaderboard is sorted by Bayesian-weighted
                      reputation score.
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </TableHead>
              <TableHead className="text-right">Total earned</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {agents.map((agent) => {
              const label = agent.agentId ?? compactAddress(agent.address);
              const profileId = agent.agentId ?? agent.address;
              const profileHref =
                `${normalizeBasePath(profileBasePath)}/${encodeURIComponent(profileId)}` as Route;

              return (
                <TableRow key={`${agent.rank}-${agent.address}`}>
                  <TableCell className="font-mono">#{agent.rank}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2.5">
                      <AgentAvatar
                        address={agent.address}
                        agentId={agent.agentId ?? undefined}
                        size="sm"
                      />
                      <div className="min-w-0">
                        <AgentHoverCard agent={agent} profileHref={profileHref}>
                          <Link className="font-medium hover:text-primary" href={profileHref}>
                            {label}
                          </Link>
                        </AgentHoverCard>
                        <p className="mt-0.5 font-mono text-xs text-muted-foreground">
                          {compactAddress(agent.address)}
                        </p>
                      </div>
                    </div>
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
                  <TableCell className="font-mono">
                    {`${((agent.credibility ?? 0) / 10).toFixed(0)}%`}
                  </TableCell>
                  <TableCell className="text-right font-mono text-primary">
                    {formatUsdcUnits(agent.totalEarnings)}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function AgentMobileCard({
  agent,
  identityLabel,
  profileBasePath,
}: {
  agent: LeaderboardEntry;
  identityLabel: string;
  profileBasePath: string;
}) {
  const label = agent.agentId ?? compactAddress(agent.address);
  const profileId = agent.agentId ?? agent.address;
  const profileHref = `${normalizeBasePath(profileBasePath)}/${encodeURIComponent(profileId)}`;
  const credibilityLabel = `${((agent.credibility ?? 0) / 10).toFixed(0)}%`;

  return (
    <li className="grid gap-3 rounded-lg border border-border/58 bg-background/38 p-4">
      <div className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-3">
        <span className="font-mono text-xs text-muted-foreground">#{agent.rank}</span>
        <div className="min-w-0">
          <Link
            className="block truncate text-base font-semibold leading-6 text-foreground hover:text-primary"
            href={profileHref as Route}
          >
            {label}
          </Link>
          <p className="mt-1 truncate font-mono text-xs text-muted-foreground">
            {compactAddress(agent.address)}
          </p>
          {agent.skills.length ? (
            <div className="mt-2 flex flex-wrap gap-1">
              {agent.skills.slice(0, 3).map((skill) => (
                <Badge key={skill} variant="terminal">
                  {skill}
                </Badge>
              ))}
            </div>
          ) : null}
        </div>
      </div>
      <dl className="grid grid-cols-2 gap-3 text-sm">
        <div className="min-w-0">
          <dt className="font-mono text-[0.68rem] uppercase text-muted-foreground">Rating</dt>
          <dd className="mt-1 font-mono text-foreground">{agent.averageRating.toFixed(1)}</dd>
        </div>
        <div className="min-w-0">
          <dt className="font-mono text-[0.68rem] uppercase text-muted-foreground">Credibility</dt>
          <dd className="mt-1 font-mono text-foreground">{credibilityLabel}</dd>
        </div>
        <div className="min-w-0">
          <dt className="font-mono text-[0.68rem] uppercase text-muted-foreground">Tasks</dt>
          <dd className="mt-1 font-mono text-foreground">{agent.completedTasks}</dd>
        </div>
        <div className="min-w-0">
          <dt className="font-mono text-[0.68rem] uppercase text-muted-foreground">Total earned</dt>
          <dd className="mt-1 font-mono text-primary">{formatUsdcUnits(agent.totalEarnings)}</dd>
        </div>
      </dl>
      <Button asChild className="w-full sm:w-fit" variant="outline">
        <Link href={profileHref as Route}>View {identityLabel.toLowerCase()}</Link>
      </Button>
    </li>
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
      <section className="grid gap-4 border-y border-border/58 py-5">
        <h2 className="font-display font-semibold leading-none tracking-tight text-foreground">
          {filterTitle}
        </h2>
        <div>
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
                  <Link
                    href={
                      leaderboardHref(
                        state,
                        {
                          minRating: '',
                          minTasks: '',
                          page: undefined,
                          search: '',
                          skill: '',
                        },
                        basePath
                      ) as Route
                    }
                  >
                    Clear filters
                  </Link>
                </Button>
              ) : null}
            </div>
          </form>
        </div>
      </section>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          <Button asChild size="chip" variant="chip">
            <Link
              data-active={sort === 'reputation'}
              href={leaderboardHref(state, { page: 1, sort: 'reputation' }, basePath) as Route}
            >
              Reputation
            </Link>
          </Button>
          <Button asChild size="chip" variant="chip">
            <Link
              data-active={sort === 'tasks'}
              href={leaderboardHref(state, { page: 1, sort: 'tasks' }, basePath) as Route}
            >
              Task count
            </Link>
          </Button>
        </div>
        <p className="font-mono text-xs uppercase text-muted-foreground">Page {page}</p>
      </div>

      <AgentTable agents={agents} profileBasePath={profileBasePath} variant={tableVariant} />

      <div className="flex items-center justify-between border-t border-border/75 pt-4">
        <span className="font-mono text-sm text-muted-foreground">Page {page}</span>
        <div className="flex gap-2">
          <Button asChild disabled={!hasPrevPage} variant="outline">
            {hasPrevPage ? (
              <Link href={leaderboardHref(state, { page: page - 1 }, basePath) as Route}>
                Previous
              </Link>
            ) : (
              <a aria-disabled="true" href="#">
                Previous
              </a>
            )}
          </Button>
          <Button asChild disabled={!hasNextPage} variant="outline">
            {hasNextPage ? (
              <Link href={leaderboardHref(state, { page: page + 1 }, basePath) as Route}>Next</Link>
            ) : (
              <a aria-disabled="true" href="#">
                Next
              </a>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}

export function AgentProfilePanel({
  agent,
  agentWork = [],
  taskBasePath = '/dashboard/tasks',
  directoryBasePath = '/dashboard/agents',
  performanceSeries,
  requesterStats,
}: {
  agent: AgentStats | LeaderboardEntry;
  agentWork?: AgentWorkResponse;
  taskBasePath?: string;
  directoryBasePath?: string;
  performanceSeries?: AgentTimeSeriesResponse;
  requesterStats?: RequesterStats | null;
}) {
  const label = agent.agentId
    ? (getAgentName(agent.agentId) ?? `Agent #${agent.agentId}`)
    : compactAddress(agent.address);
  const rank = 'rank' in agent ? agent.rank : null;
  const ratedTasks = 'ratedTasks' in agent ? agent.ratedTasks : 0;
  const totalStars = 'totalStars' in agent ? agent.totalStars : null;
  // Whether the Work section is showing the artifact gallery (vs. the recent-ratings
  // fallback). When true, the standalone Recent ratings card renders below; when false
  // the fallback already carries the rating/feedback so the card is suppressed to avoid
  // duplicating the same tasks.
  const hasPortfolioArtifacts = agentWork.some((item) => item.artifacts.length > 0);
  const skills = agent.skills ?? [];
  const ratingLabel = agent.averageRating > 0 ? agent.averageRating.toFixed(1) : 'N/A';
  const credibility =
    agent.credibility ??
    (ratedTasks === 0 ? 0 : Math.floor((ratedTasks / (ratedTasks + 10)) * 1000));
  const credibilityLabel = `${(credibility / 10).toFixed(0)}%`;
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

  const tasksWorkedHref = agent.address
    ? (`${normalizeBasePath(taskBasePath)}?worker=${encodeURIComponent(agent.address)}` as Route)
    : null;

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link
          className="inline-flex w-fit items-center gap-1.5 font-mono text-xs font-semibold uppercase text-muted-foreground transition-colors hover:text-primary"
          href={normalizeBasePath(directoryBasePath) as Route}
        >
          <ArrowLeftIcon className="size-3.5" />
          Back to agents
        </Link>
        {tasksWorkedHref ? (
          <Link
            className="inline-flex w-fit items-center gap-1.5 font-mono text-xs font-semibold uppercase text-muted-foreground transition-colors hover:text-primary"
            href={tasksWorkedHref}
          >
            <ListChecksIcon className="size-3.5" />
            Tasks worked by this agent
          </Link>
        ) : null}
      </div>
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <Card className="overflow-hidden">
          <CardContent className="grid gap-7 pt-0">
            <div className="-mx-6 -mt-6 border-b border-border/68 bg-surface/58 px-6 py-6 shadow-[inset_0_1px_0_rgb(255_255_255_/_0.04)]">
              <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
                <AgentAvatar
                  address={agent.address}
                  agentId={agent.agentId ?? undefined}
                  size="lg"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    {rank ? <Badge>Rank #{rank}</Badge> : null}
                    <Badge variant="outline">{ratingLabel} rating</Badge>
                    {agent.agentId ? (
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger aria-label="What is ERC-8004" className="cursor-default">
                            <Badge variant="terminal">
                              ERC-8004 identity
                              <InfoIcon className="size-3 text-muted-foreground" />
                            </Badge>
                          </TooltipTrigger>
                          <TooltipContent className="max-w-64">
                            ERC-8004 is an on-chain identity standard - this agent has a verifiable,
                            portable identity registered on-chain.
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    ) : null}
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
                  label={
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger
                          aria-label="What is ERC-8004"
                          className="flex items-center gap-1 cursor-default uppercase"
                        >
                          ERC-8004
                          <InfoIcon className="size-3 text-muted-foreground" />
                        </TooltipTrigger>
                        <TooltipContent className="max-w-64 normal-case">
                          ERC-8004 is an on-chain identity standard - this token is the agent's
                          verifiable, portable on-chain identity.
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  }
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
          <div className="rounded-lg border border-border/58 bg-card/42 p-4 sm:col-span-2 xl:col-span-1">
            <p className="font-mono text-xs font-semibold uppercase text-muted-foreground">
              <InfoTooltip label={METRIC_LEGENDS.credibility}>Credibility</InfoTooltip>
            </p>
            <ValueRadial
              caption="credibility"
              height={160}
              label={credibilityLabel}
              max={1000}
              value={credibility}
            />
          </div>
          <ProfileStat
            icon={<BadgeCheckIcon />}
            label="Tasks completed"
            value={String(agent.completedTasks)}
          />
          <ProfileStat
            icon={<StarIcon />}
            label="Average rating"
            tooltip={METRIC_LEGENDS.rating}
            value={ratingLabel}
          />
          <ProfileStat
            icon={<CoinsIcon />}
            label="Total earned"
            value={formatUsdcUnits(agent.totalEarnings)}
          />
          <ProfileStat icon={<ShieldCheckIcon />} label="Rated tasks" value={String(ratedTasks)} />
        </div>
      </div>

      <AgentPerformanceChart
        address={agent.address}
        initialData={performanceSeries}
        profileHref={`${normalizeBasePath(directoryBasePath)}/${encodeURIComponent(
          agent.agentId ?? agent.address
        )}`}
      />

      <AgentPortfolio
        agentWork={agentWork}
        recentRatings={'recentRatings' in agent ? (agent.recentRatings ?? []) : []}
        taskBasePath={taskBasePath}
      />

      {requesterStats ? (
        <Card>
          <CardHeader>
            <CardTitle>Requester activity</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-lg border border-border/58 bg-card/42 p-4">
                <p className="font-mono text-xs font-semibold uppercase text-muted-foreground">
                  Tasks created
                </p>
                <p className="mt-3 font-mono text-2xl font-semibold">
                  {requesterStats.totalTasksCreated}
                </p>
              </div>
              <div className="rounded-lg border border-border/58 bg-card/42 p-4">
                <p className="font-mono text-xs font-semibold uppercase text-muted-foreground">
                  Completed
                </p>
                <p className="mt-3 font-mono text-2xl font-semibold">
                  {requesterStats.completedCount}
                </p>
              </div>
              <div className="rounded-lg border border-border/58 bg-card/42 p-4">
                <p className="font-mono text-xs font-semibold uppercase text-muted-foreground">
                  Unique workers
                </p>
                <p className="mt-3 font-mono text-2xl font-semibold">
                  {requesterStats.totalUniqueWorkers}
                </p>
              </div>
              <div className="rounded-lg border border-border/58 bg-card/42 p-4">
                <p className="font-mono text-xs font-semibold uppercase text-muted-foreground">
                  Submission attempts
                </p>
                <p className="mt-3 font-mono text-2xl font-semibold">
                  {requesterStats.totalSubmissionAttempts}
                </p>
              </div>
            </div>
            {requesterStats.selfAwardCount > 0 ||
            requesterStats.cancelledAfterSubmissionsCount > 0 ||
            requesterStats.expiredNoActionCount > 0 ||
            requesterStats.expiredAfterRejectionsCount > 0 ? (
              <div className="mt-4 grid gap-2 border-t border-border/58 pt-4">
                <p className="font-mono text-xs font-semibold uppercase text-muted-foreground">
                  Reputation signals
                </p>
                <div className="flex flex-wrap gap-2">
                  {requesterStats.selfAwardCount > 0 ? (
                    <Badge variant="destructive">
                      {requesterStats.selfAwardCount} self-award
                      {requesterStats.selfAwardCount !== 1 ? 's' : ''}
                    </Badge>
                  ) : null}
                  {requesterStats.cancelledAfterSubmissionsCount > 0 ? (
                    <Badge variant="warning">
                      {requesterStats.cancelledAfterSubmissionsCount} cancelled after submissions
                    </Badge>
                  ) : null}
                  {requesterStats.expiredAfterRejectionsCount > 0 ? (
                    <Badge variant="warning">
                      {requesterStats.expiredAfterRejectionsCount} expired after rejections
                    </Badge>
                  ) : null}
                  {requesterStats.expiredNoActionCount > 0 ? (
                    <Badge variant="secondary">
                      {requesterStats.expiredNoActionCount} expired with no action
                    </Badge>
                  ) : null}
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <Card className="min-w-0">
          <CardHeader className="has-data-[slot=card-action]:grid-cols-[minmax(0,1fr)_auto]">
            <CardTitle>Identity record</CardTitle>
            <div data-slot="card-action">
              <CopyButton label="Copy identity JSON" text={identityJson} />
            </div>
          </CardHeader>
          <CardContent>
            <pre className="max-h-[28rem] overflow-auto rounded-lg border border-border/58 bg-background/52 p-4 text-xs leading-5 text-muted-foreground">
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
        <AgentRatingsHistogram ratings={agent.recentRatings} />
      ) : null}

      {hasPortfolioArtifacts && 'recentRatings' in agent && agent.recentRatings?.length ? (
        <Card>
          <CardHeader>
            <CardTitle>Recent ratings</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3">
              {agent.recentRatings.map((rating) => (
                <article
                  className="grid gap-3 rounded-lg border border-border/58 bg-background/36 p-3"
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
                      <Link
                        href={
                          `${normalizeBasePath(taskBasePath)}/${encodeURIComponent(rating.taskId)}` as Route
                        }
                      >
                        Open reviewed task
                      </Link>
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

// Lightweight hover preview for a directory/leaderboard row. Sourced entirely from the
// LeaderboardEntry already in the row - no extra fetch. Uses the radix HoverCard primitive
// directly (no shared ui wrapper exists) and degrades to plain children for touch / no-hover
// inputs. Motion is opt-out via prefers-reduced-motion (motion-safe:* gates the animations).
function AgentHoverCard({
  agent,
  children,
  profileHref,
}: {
  agent: LeaderboardEntry;
  children: ReactNode;
  profileHref: Route;
}) {
  const name = agent.agentId
    ? (getAgentName(agent.agentId) ?? `Agent #${agent.agentId}`)
    : compactAddress(agent.address);
  const ratingLabel = agent.averageRating > 0 ? agent.averageRating.toFixed(1) : 'N/A';
  const credibilityLabel = `${((agent.credibility ?? 0) / 10).toFixed(0)}%`;
  const topSkills = agent.skills.slice(0, 4);

  return (
    <HoverCardPrimitive.Root closeDelay={80} openDelay={140}>
      <HoverCardPrimitive.Trigger asChild>{children}</HoverCardPrimitive.Trigger>
      <HoverCardPrimitive.Portal>
        <HoverCardPrimitive.Content
          align="start"
          className={cn(
            'z-50 w-72 origin-(--radix-hover-card-content-transform-origin) rounded-lg border border-border/68 bg-popover p-4 text-popover-foreground shadow-[var(--shadow-control)] outline-none',
            'motion-safe:animate-in motion-safe:fade-in-0 motion-safe:zoom-in-95 motion-safe:data-[state=closed]:animate-out motion-safe:data-[state=closed]:fade-out-0 motion-safe:data-[state=closed]:zoom-out-95'
          )}
          sideOffset={8}
        >
          <div className="grid gap-3">
            <div className="flex items-center gap-3">
              <AgentAvatar address={agent.address} agentId={agent.agentId ?? undefined} size="md" />
              <div className="min-w-0">
                <Link
                  className="block truncate text-sm font-semibold hover:text-primary"
                  href={profileHref}
                >
                  {name}
                </Link>
                <p className="truncate font-mono text-xs text-muted-foreground">
                  {compactAddress(agent.address)}
                </p>
              </div>
              <span className="ml-auto shrink-0 font-mono text-xs text-muted-foreground">
                #{agent.rank}
              </span>
            </div>
            <dl className="grid grid-cols-2 gap-2 text-xs">
              <div>
                <dt className="font-mono uppercase text-muted-foreground">Rating</dt>
                <dd className="mt-0.5 font-mono text-foreground">{ratingLabel}</dd>
              </div>
              <div>
                <dt className="font-mono uppercase text-muted-foreground">Credibility</dt>
                <dd className="mt-0.5 font-mono text-foreground">{credibilityLabel}</dd>
              </div>
              <div>
                <dt className="font-mono uppercase text-muted-foreground">Completed</dt>
                <dd className="mt-0.5 font-mono text-foreground">{agent.completedTasks}</dd>
              </div>
              <div>
                <dt className="font-mono uppercase text-muted-foreground">Total earned</dt>
                <dd className="mt-0.5 font-mono text-primary">
                  {formatUsdcUnits(agent.totalEarnings)}
                </dd>
              </div>
            </dl>
            {topSkills.length ? (
              <div className="flex flex-wrap gap-1">
                {topSkills.map((skill) => (
                  <Badge key={skill} variant="terminal">
                    {skill}
                  </Badge>
                ))}
              </div>
            ) : null}
          </div>
          <HoverCardPrimitive.Arrow className="fill-popover" />
        </HoverCardPrimitive.Content>
      </HoverCardPrimitive.Portal>
    </HoverCardPrimitive.Root>
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
  label: ReactNode;
  value: string;
  valueToCopy?: string;
}) {
  return (
    <div className="grid gap-2 rounded-lg border border-border/52 bg-background/30 p-3 sm:grid-cols-[7rem_minmax(0,1fr)_auto] sm:items-center">
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

function ProfileStat({
  icon,
  label,
  tooltip,
  value,
}: {
  icon: ReactNode;
  label: string;
  tooltip?: string;
  value: string;
}) {
  return (
    <div className="rounded-lg border border-border/58 bg-card/42 p-4">
      <div className="flex items-center justify-between gap-4">
        <p className="font-mono text-xs font-semibold uppercase text-muted-foreground">
          {tooltip ? <InfoTooltip label={tooltip}>{label}</InfoTooltip> : label}
        </p>
        <span className="text-primary [&>svg]:size-4">{icon}</span>
      </div>
      <p className="mt-4 break-words font-mono text-2xl font-semibold leading-tight">{value}</p>
    </div>
  );
}

function CommandBlock({ command }: { command: string }) {
  return (
    <div className="grid gap-2 rounded-lg border border-border/58 bg-background/42 p-3">
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

type RecentRating = NonNullable<AgentStats['recentRatings']>[number];

// Portfolio / "Work" section for the agent detail page. Prefers SSR-seeded accepted work
// (AgentWorkResponse) and renders each task's artifacts inline via ArtifactMediaTile
// (which handles its own presigned-URL refresh). When no portfolio work is available it
// falls back to task cards built from the agent's recent ratings so the section never
// renders an empty void.
function AgentPortfolio({
  agentWork,
  recentRatings,
  taskBasePath,
}: {
  agentWork: AgentWorkResponse;
  recentRatings: RecentRating[];
  taskBasePath: string;
}) {
  const workWithArtifacts = agentWork.filter((item) => item.artifacts.length > 0);

  if (workWithArtifacts.length > 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Work</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-6">
            {workWithArtifacts.map((item) => {
              const taskHref =
                `${normalizeBasePath(taskBasePath)}/${encodeURIComponent(item.taskId)}` as Route;
              return (
                <section className="grid gap-3" key={`${item.taskId}-${item.completedAt}`}>
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <Link
                      className="min-w-0 truncate text-sm font-semibold tracking-tight text-foreground hover:text-primary"
                      href={taskHref}
                    >
                      {item.taskTitle || `Task ${item.taskId}`}
                    </Link>
                    <span className="font-mono text-xs text-muted-foreground">
                      {new Date(item.completedAt).toLocaleDateString('en-US', {
                        day: '2-digit',
                        month: 'short',
                        year: 'numeric',
                      })}
                    </span>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {item.artifacts.map((artifact) => (
                      <ArtifactMediaTile
                        artifact={artifact}
                        key={artifact.id}
                        taskId={item.taskId}
                      />
                    ))}
                  </div>
                </section>
              );
            })}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (recentRatings.length > 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Work</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-4 text-sm text-muted-foreground">
            No shared deliverables yet. Showing recently completed tasks.
          </p>
          <div className="grid gap-3">
            {recentRatings.map((rating) => {
              const taskHref =
                `${normalizeBasePath(taskBasePath)}/${encodeURIComponent(rating.taskId)}` as Route;
              return (
                <article
                  className="grid gap-3 rounded-lg border border-border/58 bg-background/36 p-3"
                  key={`${rating.taskId}-${rating.createdAt}`}
                >
                  <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
                    <div className="grid min-w-0 gap-1">
                      <p className="font-mono text-[0.68rem] uppercase text-muted-foreground">
                        Completed task
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
                      <Link href={taskHref}>Open reviewed task</Link>
                    </Button>
                  </div>
                </article>
              );
            })}
          </div>
        </CardContent>
      </Card>
    );
  }

  return null;
}

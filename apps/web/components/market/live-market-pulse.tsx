'use client';

import type { TaskResponse, TaskModeType } from '@taskmarket/shared';
import { IconActivity } from '@tabler/icons-react';
import { AnimatePresence, motion } from 'motion/react';
import { useMemo, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { trpc } from '@/lib/api/client';
import { compactAddress, formatNumber, formatUsdcUnits } from '@/lib/format';
import { taskModeOptions } from '@/lib/market/task-mode-config';

type LandingStats = {
  agentCount?: number;
  taskCount?: number;
  totalRewards?: string;
};

type ModeFilter = TaskModeType | 'all';

type ModeTab = {
  id: ModeFilter;
  label: string;
  icon: typeof IconActivity;
};

const modeTabs: ModeTab[] = [
  { id: 'all', label: 'All', icon: IconActivity },
  ...taskModeOptions.map((mode) => ({
    icon: mode.icon,
    id: mode.value,
    label: mode.label,
  })),
];

const easeOut = [0.16, 1, 0.3, 1] as const;

function labelize(value?: string | null) {
  return value ? value.replaceAll('_', ' ') : 'standard';
}

function taskTitle(task: TaskResponse) {
  const first = task.description.split('\n')[0]?.trim();
  return first ? first.slice(0, 96) : 'Untitled task';
}

function PulseStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1 border-l border-border/68 bg-card/52 px-3 py-2 first:border-l-0">
      <p className="font-mono text-[0.65rem] font-semibold uppercase text-muted-foreground">
        {label}
      </p>
      <AnimatePresence mode="popLayout">
        <motion.span
          animate={{ opacity: 1, y: 0 }}
          className="block font-mono text-2xl font-semibold text-foreground"
          exit={{ opacity: 0, y: -8 }}
          initial={{ opacity: 0, y: 8 }}
          key={value}
          transition={{ duration: 0.4, ease: easeOut }}
        >
          {value}
        </motion.span>
      </AnimatePresence>
    </div>
  );
}

function AnimatedCount({ label, value }: { label: string; value: number }) {
  return (
    <span className="inline-flex items-center gap-1 font-mono text-[0.7rem] uppercase text-muted-foreground">
      <AnimatePresence mode="popLayout">
        <motion.span
          animate={{ opacity: 1, y: 0 }}
          className="inline-block font-semibold text-foreground"
          exit={{ opacity: 0, y: -6 }}
          initial={{ opacity: 0, y: 6 }}
          key={value}
          transition={{ duration: 0.3, ease: easeOut }}
        >
          {formatNumber(value)}
        </motion.span>
      </AnimatePresence>
      <span>{label}</span>
    </span>
  );
}

function TaskPulseCard({ task }: { task: TaskResponse }) {
  const href = `/dashboard/tasks/${task.id}`;
  const modeLabel = task.auctionType
    ? `${labelize(task.auctionType)} auction`
    : labelize(task.mode);
  const bidCount = task.auctionBidCount ?? 0;
  const pitchCount = task.pitchCount ?? 0;
  const submissionCount = task.submissionCount ?? 0;

  return (
    <motion.li
      animate={{ opacity: 1, y: 0 }}
      className="grid gap-3 border border-border/68 bg-card/72 p-4 shadow-[var(--shadow-soft)] transition-[background-color,border-color,box-shadow,transform] duration-300 ease-[var(--ease-premium)] hover:-translate-y-0.5 hover:border-primary/35 hover:bg-surface/82 hover:shadow-[var(--shadow-control)]"
      exit={{ opacity: 0, y: -12 }}
      initial={{ opacity: 0, y: 14 }}
      layout
      transition={{ duration: 0.5, ease: easeOut }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="terminal">{modeLabel}</Badge>
        <Badge variant={task.status === 'open' ? 'success' : 'outline'}>
          {labelize(task.status)}
        </Badge>
        {task.tags.slice(0, 3).map((tag) => (
          <Badge key={tag} variant="outline">
            {tag}
          </Badge>
        ))}
      </div>

      <a
        className="block truncate font-sans text-sm font-semibold tracking-tight text-foreground transition-colors hover:text-primary"
        href={href}
        title={taskTitle(task)}
      >
        {taskTitle(task)}
      </a>

      <div className="grid gap-3 border-t border-border/70 pt-3 sm:grid-cols-[auto_1fr] sm:items-end">
        <div>
          <p className="font-mono text-[0.65rem] uppercase text-muted-foreground">Reward</p>
          <p className="mt-1 font-mono text-xl font-semibold text-primary">
            {formatUsdcUnits(task.reward)}
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-start gap-x-4 gap-y-1 sm:justify-end">
          <AnimatedCount label="bids" value={bidCount} />
          <AnimatedCount label="pitches" value={pitchCount} />
          <AnimatedCount label="subs" value={submissionCount} />
          <span className="font-mono text-[0.7rem] uppercase text-muted-foreground">
            {compactAddress(task.requester)}
          </span>
        </div>
      </div>
    </motion.li>
  );
}

export function LiveMarketPulseSection({
  initialStats,
  initialTasks,
}: {
  initialTasks: TaskResponse[];
  initialStats: LandingStats;
}) {
  const [mode, setMode] = useState<ModeFilter>('all');

  const { data } = trpc.tasks.list.useQuery(
    { status: 'open', limit: 24 },
    {
      initialData: { tasks: initialTasks, nextCursor: null, hasMore: false },
      refetchInterval: 15_000,
      refetchOnWindowFocus: true,
    }
  );

  const tasks = data?.tasks ?? [];

  const filtered = useMemo(
    () => (mode === 'all' ? tasks : tasks.filter((task) => task.mode === mode)).slice(0, 8),
    [mode, tasks]
  );

  const activeModeLabel = mode === 'all' ? 'tasks' : labelize(mode);

  return (
    <section
      aria-labelledby="live-market-pulse-title"
      className="flex min-h-[100dvh] flex-col justify-center border-b border-border/68 px-4 py-16 sm:px-6 sm:py-24 lg:px-8"
      id="live-market-pulse"
    >
      <div className="mx-auto grid max-w-7xl gap-8">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,0.66fr)_minmax(0,1.34fr)] lg:items-end">
          <div className="grid gap-3">
            <Badge className="w-fit" variant="terminal">
              Market terminal
            </Badge>
            <h2
              className="font-display text-3xl font-semibold tracking-tight leading-none sm:text-5xl"
              id="live-market-pulse-title"
            >
              Live funded work
            </h2>
            <p className="max-w-xl text-base leading-7 text-muted-foreground">
              Funded tasks as agents see them. Counts and rewards refresh every fifteen seconds, so
              buyers can see what the market is doing before they post.
            </p>
          </div>

          <div className="grid overflow-hidden rounded-2xl border border-border/68 bg-background/58 shadow-[var(--shadow-soft)] backdrop-blur sm:grid-cols-3">
            <PulseStat label="Open tasks" value={formatNumber(initialStats.taskCount)} />
            <PulseStat label="Agents" value={formatNumber(initialStats.agentCount)} />
            <PulseStat label="Posted volume" value={formatUsdcUnits(initialStats.totalRewards)} />
          </div>
        </div>

        <Tabs onValueChange={(value) => setMode(value as ModeFilter)} value={mode}>
          <TabsList className="flex w-full flex-wrap gap-1 rounded-2xl border border-border/68 bg-surface/68 p-1 shadow-[var(--shadow-soft)]">
            {modeTabs.map((tab) => {
              const Icon = tab.icon;
              return (
                <TabsTrigger className="font-mono text-xs uppercase" key={tab.id} value={tab.id}>
                  <Icon />
                  {tab.label}
                </TabsTrigger>
              );
            })}
          </TabsList>

          <TabsContent className="mt-4" value={mode}>
            {filtered.length === 0 ? (
              <div className="border border-dashed border-border/68 bg-card/60 p-8 text-center font-mono text-sm uppercase text-muted-foreground shadow-[var(--shadow-soft)]">
                No open {activeModeLabel} right now. Check back soon.
              </div>
            ) : (
              <ul className="grid gap-3 sm:grid-cols-2">
                <AnimatePresence initial={false} mode="popLayout">
                  {filtered.map((task) => (
                    <TaskPulseCard key={task.id} task={task} />
                  ))}
                </AnimatePresence>
              </ul>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </section>
  );
}

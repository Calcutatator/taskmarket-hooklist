import { IconUsers } from '@tabler/icons-react';

import type { MarketStats } from '@/lib/api/server';
import { cn } from '@/lib/utils';

type MarketLiquidityProps = {
  stats: MarketStats | null;
};

// Below this active-worker count we avoid implying a busy market and instead
// frame the registered pool with a "be among the first" message.
const ACTIVE_THRESHOLD = 3;

function pluralize(count: number, noun: string) {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

export function MarketLiquidityStrip({ stats }: MarketLiquidityProps) {
  if (!stats) {
    return null;
  }

  const quiet = stats.activeWorkers7d < ACTIVE_THRESHOLD;
  const dotClassName = quiet ? 'bg-muted-foreground/60' : 'bg-accent';

  return (
    <p className="flex flex-wrap items-center gap-2 font-mono text-xs uppercase tracking-[0.08em] text-muted-foreground">
      <IconUsers aria-hidden="true" className="size-4" />
      <span aria-hidden="true" className={cn('size-2 rounded-full', dotClassName)} />
      <span>Labour market</span>
      <span aria-hidden="true">-</span>
      <span className="text-foreground">{pluralize(stats.registeredWorkers, 'worker')}</span>
      {quiet ? (
        <>
          <span aria-hidden="true">-</span>
          <span>Be among the first to post</span>
        </>
      ) : (
        <>
          <span aria-hidden="true">-</span>
          <span>{stats.activeWorkers7d} active this week</span>
        </>
      )}
    </p>
  );
}

export function MarketLiquidityPanel({ stats }: MarketLiquidityProps) {
  if (!stats) {
    return null;
  }

  const quiet = stats.activeWorkers7d < ACTIVE_THRESHOLD;
  const context = quiet
    ? 'A quiet market right now. Post early and be among the first tasks workers see.'
    : 'Plenty of workers have been active this week, so a well-scoped task should get picked up.';

  return (
    <section
      aria-label="Labour market depth"
      className="grid gap-4 rounded-xl border border-border/68 bg-surface/42 p-4 shadow-[var(--shadow-soft)]"
    >
      <div className="flex items-center gap-2 font-mono text-xs uppercase tracking-[0.08em] text-muted-foreground">
        <IconUsers aria-hidden="true" className="size-4" />
        Labour market
      </div>
      <dl className="grid grid-cols-3 gap-3 font-mono text-xs uppercase">
        <div className="grid gap-1">
          <dt className="text-muted-foreground">Workers</dt>
          <dd className="text-base font-semibold tracking-tight text-foreground">
            {stats.registeredWorkers}
          </dd>
        </div>
        <div className="grid gap-1">
          <dt className="text-muted-foreground">Active 7d</dt>
          <dd className="text-base font-semibold tracking-tight text-foreground">
            {stats.activeWorkers7d}
          </dd>
        </div>
        <div className="grid gap-1">
          <dt className="text-muted-foreground">Open tasks</dt>
          <dd className="text-base font-semibold tracking-tight text-foreground">
            {stats.openTasks}
          </dd>
        </div>
      </dl>
      <p className="text-xs leading-5 text-muted-foreground">{context}</p>
    </section>
  );
}

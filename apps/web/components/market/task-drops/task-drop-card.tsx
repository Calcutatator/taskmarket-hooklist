import type { Route } from 'next';
import type { TaskDropDirectoryItem } from '@taskmarket/shared';
import Link from 'next/link';

import { Badge } from '@/components/ui/badge';
import { compactAddress, formatDateTime, formatUsdcUnits } from '@/lib/format';
import { cn } from '@/lib/utils';

const visualFields = [
  'from-chart-1/28 via-chart-5/12 to-chart-2/24',
  'from-chart-2/26 via-chart-3/12 to-chart-1/22',
  'from-chart-3/26 via-chart-1/12 to-chart-4/22',
  'from-chart-4/24 via-chart-2/12 to-chart-5/24',
  'from-chart-5/26 via-chart-4/12 to-chart-3/22',
] as const;

function visualFieldFor(id: string) {
  const hash = Array.from(id).reduce((total, character) => total + character.charCodeAt(0), 0);
  return visualFields[hash % visualFields.length];
}

export function TaskDropCard({
  className,
  featured = false,
  item,
}: {
  className?: string;
  featured?: boolean;
  item: TaskDropDirectoryItem;
}) {
  const href = `/dashboard/drops/${encodeURIComponent(item.drop.id)}` as Route;
  const unresolvedTaskCount = Math.max(item.taskCount - item.resolvedTaskCount, 0);

  return (
    <article className={cn('min-w-0', className)}>
      <Link
        aria-label={`View ${item.drop.name} Task Drop`}
        className={cn(
          'group grid h-full min-h-80 overflow-hidden rounded-lg border border-border/58 bg-card/44 shadow-none',
          'transition-[background-color,border-color,transform] duration-200 ease-[var(--ease-premium)]',
          'hover:-translate-y-0.5 hover:border-primary/36 hover:bg-card/58',
          'focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/35',
          featured && 'min-h-72 md:grid-cols-[minmax(14rem,0.8fr)_minmax(0,1.2fr)]'
        )}
        href={href}
      >
        <div
          aria-hidden="true"
          className={cn(
            'relative min-h-24 overflow-hidden border-b border-border/58 bg-linear-to-br',
            visualFieldFor(item.drop.id),
            featured && 'md:min-h-full md:border-r md:border-b-0'
          )}
        >
          <div className="absolute inset-x-[12%] top-[28%] h-px rotate-[-8deg] bg-foreground/20" />
          <div className="absolute inset-x-[7%] top-[58%] h-px rotate-[5deg] bg-foreground/14" />
          <div className="absolute right-[12%] bottom-[16%] size-14 rounded-full border border-foreground/14 bg-background/18" />
        </div>

        <div className="flex min-w-0 flex-col gap-5 p-5 sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Badge variant={item.drop.isOfficial ? 'default' : 'terminal'}>
              {item.drop.isOfficial ? 'Official drop' : 'Community drop'}
            </Badge>
            <span className="grid justify-items-end gap-0.5 font-mono text-xs text-muted-foreground">
              <span title={item.drop.ownerAddress}>{compactAddress(item.drop.ownerAddress)}</span>
              <span>
                Updated{' '}
                <time dateTime={item.latestTaskAt}>{formatDateTime(item.latestTaskAt)}</time>
              </span>
            </span>
          </div>

          <div className="grid gap-2">
            <h3 className="line-clamp-2 font-display text-2xl font-semibold tracking-tight text-foreground transition-colors group-hover:text-primary">
              {item.drop.name}
            </h3>
            <p className="line-clamp-2 text-sm leading-6 text-muted-foreground">
              {item.drop.description || 'A collection of funded work ready for contributors.'}
            </p>
          </div>

          <dl className="mt-auto grid grid-cols-2 gap-x-4 gap-y-3 border-t border-border/58 pt-4">
            <div>
              <dt className="font-mono text-[0.65rem] uppercase tracking-[0.08em] text-muted-foreground">
                Available
              </dt>
              <dd className="mt-1 text-sm font-medium text-foreground">
                {item.availableTaskCount} available
              </dd>
            </div>
            <div>
              <dt className="font-mono text-[0.65rem] uppercase tracking-[0.08em] text-muted-foreground">
                Tasks
              </dt>
              <dd className="mt-1 text-sm font-medium text-foreground">{item.taskCount} total</dd>
            </div>
            <div>
              <dt className="font-mono text-[0.65rem] uppercase tracking-[0.08em] text-muted-foreground">
                Reward pool
              </dt>
              <dd className="mt-1 text-sm font-medium text-foreground">
                {formatUsdcUnits(item.totalReward)}
              </dd>
            </div>
            <div>
              <dt className="font-mono text-[0.65rem] uppercase tracking-[0.08em] text-muted-foreground">
                {item.nextExpiryTime
                  ? 'Next deadline'
                  : unresolvedTaskCount > 0
                    ? 'In progress'
                    : 'Resolved'}
              </dt>
              <dd className="mt-1 text-sm font-medium text-foreground">
                {item.nextExpiryTime ? (
                  <time dateTime={item.nextExpiryTime}>{formatDateTime(item.nextExpiryTime)}</time>
                ) : unresolvedTaskCount > 0 ? (
                  `${unresolvedTaskCount} ${unresolvedTaskCount === 1 ? 'task' : 'tasks'}`
                ) : (
                  `${item.resolvedTaskCount} resolved`
                )}
              </dd>
            </div>
          </dl>
        </div>
      </Link>
    </article>
  );
}

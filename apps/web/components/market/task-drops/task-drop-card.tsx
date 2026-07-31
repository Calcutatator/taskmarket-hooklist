import type { Route } from 'next';
import type { TaskDropDirectoryItem } from '@taskmarket/shared';
import { ArrowRightIcon } from 'lucide-react';
import Link from 'next/link';

import { Badge } from '@/components/ui/badge';
import { compactAddress, formatDateTime, formatUsdcUnits } from '@/lib/format';
import { cn } from '@/lib/utils';

const artworkCompositions = [
  {
    circle: 'top-[20%] size-24 sm:size-28',
    glow: 'top-[22%] size-36',
    line: 'top-[34%] rotate-[-13deg]',
  },
  {
    circle: 'top-[14%] size-28 sm:size-32',
    glow: 'top-[18%] size-40',
    line: 'top-[48%] rotate-[-8deg]',
  },
  {
    circle: 'top-[30%] size-20 sm:size-24',
    glow: 'top-[28%] size-32',
    line: 'top-[26%] rotate-[-17deg]',
  },
] as const;

function artworkCompositionFor(id: string) {
  const hash = Array.from(id).reduce((total, character) => total + character.charCodeAt(0), 0);
  return {
    composition: artworkCompositions[hash % artworkCompositions.length],
    mirrored: hash % 2 === 0,
  };
}

function statusFor(item: TaskDropDirectoryItem, unresolvedTaskCount: number) {
  if (item.availableTaskCount > 0) {
    return {
      artwork: {
        circle: 'border-primary/28 bg-primary/8',
        glow: 'bg-primary/14',
        gradient: 'from-primary/24 via-card to-primary/8',
        line: 'bg-primary/42',
      },
      border: 'border-primary/46 hover:border-primary/68',
      chip: 'border-primary/46 bg-primary/12 text-primary',
      label: 'Available',
      ring: 'border-primary text-primary',
      text: 'text-primary',
    };
  }

  if (unresolvedTaskCount > 0) {
    return {
      artwork: {
        circle: 'border-accent/28 bg-accent/8',
        glow: 'bg-accent/14',
        gradient: 'from-accent/22 via-card to-info/14',
        line: 'bg-accent/40',
      },
      border: 'border-border/58 hover:border-accent/54',
      chip: 'border-accent/46 bg-accent/12 text-accent',
      label: 'In progress',
      ring: 'border-accent text-accent',
      text: 'text-accent',
    };
  }

  return {
    artwork: {
      circle: 'border-drop-directory-resolved/28 bg-drop-directory-resolved/8',
      glow: 'bg-drop-directory-resolved/14',
      gradient: 'from-drop-directory-resolved/22 via-card to-info/8',
      line: 'bg-drop-directory-resolved/40',
    },
    border: 'border-border/58 hover:border-drop-directory-resolved/54',
    chip: 'border-drop-directory-resolved/46 bg-drop-directory-resolved/12 text-drop-directory-resolved',
    label: 'Resolved',
    ring: 'border-drop-directory-resolved text-drop-directory-resolved',
    text: 'text-drop-directory-resolved',
  };
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
  const status = statusFor(item, unresolvedTaskCount);
  const artwork = artworkCompositionFor(item.drop.id);

  return (
    <article className={cn('min-w-0', className)}>
      <Link
        aria-label={`View ${item.drop.name} Task Drop`}
        className={cn(
          'group grid h-full min-h-96 overflow-hidden rounded-lg border bg-card/44 shadow-none',
          'transition-[background-color,border-color,box-shadow,transform] duration-300 ease-[var(--ease-premium)]',
          'hover:-translate-y-1 hover:bg-card/58 hover:shadow-[var(--shadow-soft)]',
          'motion-reduce:transform-none motion-reduce:transition-none',
          'focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/35',
          status.border,
          featured && 'min-h-80 md:grid-cols-[minmax(16rem,0.8fr)_minmax(0,1.2fr)]'
        )}
        href={href}
      >
        <div
          aria-hidden="true"
          className={cn(
            'relative min-h-36 overflow-hidden border-b border-border/58 bg-linear-to-br',
            status.artwork.gradient,
            featured && 'md:min-h-full md:border-r md:border-b-0'
          )}
        >
          <div className="task-drop-art-grid absolute inset-0 opacity-70" />
          <Badge
            className={cn('absolute top-4 left-4 z-10 backdrop-blur-sm', status.chip)}
            variant="outline"
          >
            <span className="size-1.5 rounded-full bg-current" />
            {status.label}
          </Badge>
          <div
            className={cn(
              'absolute rounded-full blur-3xl',
              artwork.composition.glow,
              status.artwork.glow,
              artwork.mirrored ? 'right-[4%]' : 'left-[8%]'
            )}
          />
          <div
            className={cn(
              'absolute rounded-full border bg-background/12',
              artwork.composition.circle,
              status.artwork.circle,
              artwork.mirrored ? 'right-[12%]' : 'left-[16%]'
            )}
          />
          <div
            className={cn(
              'absolute h-px w-[120%] origin-center',
              artwork.composition.line,
              status.artwork.line,
              artwork.mirrored ? '-left-[10%]' : '-right-[10%]'
            )}
          />
          <div className="absolute top-[63%] -left-[8%] h-px w-[116%] rotate-[7deg] bg-foreground/18" />
          <div className="absolute right-[6%] bottom-[12%] left-[6%] h-px bg-foreground/10" />
        </div>

        <div className="flex min-w-0 flex-col p-5 sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Badge variant={item.drop.isOfficial ? 'default' : 'terminal'}>
              {item.drop.isOfficial ? 'Official drop' : 'Community drop'}
            </Badge>
            <span
              className="font-mono text-xs text-muted-foreground"
              title={item.drop.ownerAddress}
            >
              {compactAddress(item.drop.ownerAddress)}
            </span>
          </div>

          <p className="mt-3 font-mono text-xs text-muted-foreground">
            Updated <time dateTime={item.latestTaskAt}>{formatDateTime(item.latestTaskAt)}</time>
          </p>

          <div className="mt-4 grid gap-2">
            <h3 className="line-clamp-2 font-display text-2xl font-semibold tracking-tight text-foreground transition-colors group-hover:text-primary">
              {item.drop.name}
            </h3>
            <p className="line-clamp-2 text-sm leading-6 text-muted-foreground">
              {item.drop.description || 'A collection of funded work ready for contributors.'}
            </p>
          </div>

          <dl className="mt-5 grid grid-cols-[minmax(0,1.2fr)_minmax(5.5rem,0.8fr)] border-t border-border/58">
            <div className="flex min-w-0 items-center gap-3 border-r border-border/58 py-4 pr-4">
              <div
                aria-hidden="true"
                className={cn(
                  'grid size-12 shrink-0 place-items-center rounded-full border-2 font-mono text-sm font-semibold',
                  status.ring
                )}
              >
                {item.availableTaskCount}
              </div>
              <div className="min-w-0">
                <dt className="font-mono text-[0.65rem] uppercase tracking-[0.08em] text-muted-foreground">
                  Availability
                </dt>
                <dd className="mt-1">
                  <span className={cn('block text-sm font-semibold uppercase', status.text)}>
                    {item.availableTaskCount} available
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    of {item.taskCount} tasks
                  </span>
                </dd>
              </div>
            </div>
            <div className="min-w-0 py-4 pl-4">
              <dt className="font-mono text-[0.65rem] uppercase tracking-[0.08em] text-muted-foreground">
                Tasks
              </dt>
              <dd className="mt-2 font-mono text-xl font-semibold text-foreground">
                {item.taskCount}
                <span className="mt-0.5 block font-mono text-[0.65rem] font-normal uppercase tracking-[0.08em] text-muted-foreground">
                  Total
                </span>
              </dd>
            </div>
            <div className="min-w-0 border-t border-r border-border/58 py-4 pr-4">
              <dt className="font-mono text-[0.65rem] uppercase tracking-[0.08em] text-muted-foreground">
                Reward pool
              </dt>
              <dd className="mt-2 font-mono text-base font-semibold text-foreground">
                {formatUsdcUnits(item.totalReward)}
              </dd>
            </div>
            <div className="min-w-0 border-t border-border/58 py-4 pl-4">
              <dt className="font-mono text-[0.65rem] uppercase tracking-[0.08em] text-muted-foreground">
                {item.nextExpiryTime ? 'Next deadline' : 'Status'}
              </dt>
              <dd className="mt-2 text-sm font-medium text-foreground">
                {item.nextExpiryTime ? (
                  <time dateTime={item.nextExpiryTime}>{formatDateTime(item.nextExpiryTime)}</time>
                ) : unresolvedTaskCount > 0 ? (
                  <>
                    <span className={cn('block font-mono text-sm uppercase', status.text)}>
                      In progress
                    </span>
                    <span className="mt-1 block text-xs text-muted-foreground">
                      {unresolvedTaskCount} {unresolvedTaskCount === 1 ? 'task' : 'tasks'}
                    </span>
                  </>
                ) : (
                  <>
                    <span className={cn('block font-mono text-sm uppercase', status.text)}>
                      Resolved
                    </span>
                    <span className="mt-1 block text-xs text-muted-foreground">
                      {item.resolvedTaskCount} resolved
                    </span>
                  </>
                )}
              </dd>
            </div>
          </dl>

          <ArrowRightIcon
            aria-hidden="true"
            className={cn(
              'mt-1 ml-auto size-5 transition-transform duration-300 ease-[var(--ease-premium)] group-hover:translate-x-1 motion-reduce:transform-none motion-reduce:transition-none',
              status.text
            )}
          />
        </div>
      </Link>
    </article>
  );
}

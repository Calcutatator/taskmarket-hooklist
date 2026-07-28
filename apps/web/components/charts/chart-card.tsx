'use client';

import type { CSSProperties, ReactNode } from 'react';
import Link from 'next/link';
import type { Route } from 'next';

import { RelativeTime } from '@/components/market/motion/relative-time';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

const DEFAULT_HEIGHT = 250;

export type ChartCardProps = {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  isLoading?: boolean;
  errorMessage?: string;
  isEmpty?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
  emptyAction?: ReactNode;
  onRetryHref?: string;
  height?: number;
  // Bodies that are row-count driven rather than fixed-height (the heat map, for
  // example) render taller on mobile than on desktop. Pass the mobile height so
  // the loading placeholder reserves the right space at both widths.
  mobileHeight?: number;
  liveUpdatedAt?: Date | string;
  className?: string;
  contentClassName?: string;
  children: ReactNode;
};

function toIsoString(value: Date | string): string {
  return typeof value === 'string' ? value : value.toISOString();
}

// The card chrome shared by every state. The error and empty states render it too
// so the title, description, and the action controls (a range toggle, say) stay
// on screen: a range that happens to hold no data must not strand the viewer with
// no way back to a range that does.
function ChartCardHeader({
  title,
  description,
  action,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <CardHeader>
      <CardTitle>{title}</CardTitle>
      {description ? <CardDescription>{description}</CardDescription> : null}
      {action ? <CardAction>{action}</CardAction> : null}
    </CardHeader>
  );
}

// The shared chart shell. Precedence is error -> loading -> empty -> content, and
// every state renders a real Card so a chart slots into the same layouts as the
// task table treatments it mirrors (see components/market/tasks.tsx). Every state
// also opens the `card` container so an action's container queries (RangeToggle
// swaps to a Select below 767px) resolve the same way in all of them.
export function ChartCard({
  title,
  description,
  action,
  isLoading,
  errorMessage,
  isEmpty,
  emptyTitle = 'Nothing to chart yet',
  emptyDescription = 'Data will appear here once there is activity to show.',
  emptyAction,
  onRetryHref = '/dashboard',
  height = DEFAULT_HEIGHT,
  mobileHeight,
  liveUpdatedAt,
  className,
  contentClassName,
  children,
}: ChartCardProps) {
  if (errorMessage) {
    return (
      <Card className={cn('@container/card', className)}>
        <ChartCardHeader action={action} description={description} title={title} />
        <CardContent className="grid gap-4">
          <p className="font-mono text-sm text-destructive" role="alert">
            {errorMessage}
          </p>
          <Button asChild className="w-fit" variant="outline">
            <Link href={onRetryHref as Route}>Reload</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (isLoading) {
    return (
      <ChartCardSkeleton
        className={className}
        hasAction={Boolean(action)}
        hasDescription={Boolean(description)}
        height={height}
        mobileHeight={mobileHeight}
        title={title}
      />
    );
  }

  if (isEmpty) {
    return (
      <Card
        className={cn(
          '@container/card w-full border-dashed border-border/68 bg-card/60 shadow-[var(--shadow-soft)]',
          className
        )}
      >
        <ChartCardHeader action={action} description={description} title={title} />
        <CardContent className="flex items-center justify-center py-9">
          <div className="grid max-w-md gap-4 text-center">
            <div className="grid gap-2">
              <p className="font-sans text-sm font-semibold tracking-tight text-foreground">
                {emptyTitle}
              </p>
              <p className="text-sm text-muted-foreground">{emptyDescription}</p>
            </div>
            {emptyAction ? (
              <div className="flex flex-col justify-center gap-2 sm:flex-row">{emptyAction}</div>
            ) : null}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={cn('@container/card', className)}>
      <ChartCardHeader action={action} description={description} title={title} />
      <CardContent className={cn('px-2 pt-4 sm:px-6 sm:pt-6', contentClassName)}>
        {children}
        {liveUpdatedAt ? (
          <p className="mt-3 font-mono text-[0.65rem] text-muted-foreground">
            updated <RelativeTime value={toIsoString(liveUpdatedAt)} />
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

// The loading placeholder for a chart card. Exported so consumers can render it
// directly while data is in flight without committing to the full ChartCard.
// hasDescription/hasAction reserve the header chrome the loaded card will render
// (a description line, an action control such as a RangeToggle) so the card does
// not grow by a header row the moment data lands.
export function ChartCardSkeleton({
  title,
  hasDescription,
  hasAction,
  height = DEFAULT_HEIGHT,
  mobileHeight,
  className,
}: {
  title?: ReactNode;
  hasDescription?: boolean;
  hasAction?: boolean;
  height?: number;
  mobileHeight?: number;
  className?: string;
}) {
  // Two heights behind custom properties rather than one inline height: the
  // breakpoint has to live in a class for the mobile/desktop swap to work.
  const bodyStyle = {
    '--chart-skeleton-height': `${height}px`,
    '--chart-skeleton-mobile-height': `${mobileHeight ?? height}px`,
  } as CSSProperties;

  return (
    <Card className={cn('@container/card', className)}>
      <CardHeader>
        <CardTitle>{title ?? <Skeleton className="h-5 w-40" />}</CardTitle>
        {hasDescription ? (
          <CardDescription>
            <Skeleton className="h-5 w-64 max-w-full" />
          </CardDescription>
        ) : null}
        {hasAction ? (
          <CardAction>
            <Skeleton className="h-9 w-40" />
          </CardAction>
        ) : null}
      </CardHeader>
      <CardContent className="px-2 pt-4 sm:px-6 sm:pt-6">
        <Skeleton
          className="h-[var(--chart-skeleton-mobile-height)] w-full sm:h-[var(--chart-skeleton-height)]"
          style={bodyStyle}
        />
      </CardContent>
    </Card>
  );
}

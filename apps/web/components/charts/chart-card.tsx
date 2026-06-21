'use client';

import type { ReactNode } from 'react';
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
  liveUpdatedAt?: Date | string;
  className?: string;
  contentClassName?: string;
  children: ReactNode;
};

function toIsoString(value: Date | string): string {
  return typeof value === 'string' ? value : value.toISOString();
}

// The shared chart shell. Precedence is error -> loading -> empty -> content, and
// every state renders a real Card so a chart slots into the same layouts as the
// task table treatments it mirrors (see components/market/tasks.tsx).
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
  liveUpdatedAt,
  className,
  contentClassName,
  children,
}: ChartCardProps) {
  if (errorMessage) {
    return (
      <Card className={className}>
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
    return <ChartCardSkeleton title={title} height={height} className={className} />;
  }

  if (isEmpty) {
    return (
      <Card
        className={cn(
          'w-full border-dashed border-border/68 bg-card/60 py-14 shadow-[var(--shadow-soft)]',
          className
        )}
      >
        <CardContent className="flex items-center justify-center">
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
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {description ? <CardDescription>{description}</CardDescription> : null}
        {action ? <CardAction>{action}</CardAction> : null}
      </CardHeader>
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
export function ChartCardSkeleton({
  title,
  height = DEFAULT_HEIGHT,
  className,
}: {
  title?: ReactNode;
  height?: number;
  className?: string;
}) {
  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>{title ?? <Skeleton className="h-5 w-40" />}</CardTitle>
      </CardHeader>
      <CardContent className="px-2 pt-4 sm:px-6 sm:pt-6">
        <Skeleton className="w-full" style={{ height }} />
      </CardContent>
    </Card>
  );
}

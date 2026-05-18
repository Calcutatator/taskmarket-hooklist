import type { ReactNode } from 'react';

import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

const metricSlots = ['metric-1', 'metric-2', 'metric-3', 'metric-4'];
const tableRows = ['row-1', 'row-2', 'row-3', 'row-4', 'row-5', 'row-6'];
const filterRows = ['filter-1', 'filter-2', 'filter-3', 'filter-4', 'filter-5'];

function LoadingFrame({
  children,
  className,
  label,
}: {
  children: ReactNode;
  className?: string;
  label: string;
}) {
  return (
    <div aria-busy="true" aria-label={label} className={cn('w-full', className)} role="status">
      <span className="sr-only">{label}</span>
      {children}
    </div>
  );
}

function PageHeadingSkeleton({
  action = true,
  className,
}: {
  action?: boolean;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-wrap items-end justify-between gap-3', className)}>
      <div className="grid gap-3">
        <Skeleton className="h-3 w-20" />
        <Skeleton className="h-10 w-56 max-w-[70vw]" />
      </div>
      {action ? <Skeleton className="h-10 w-28" /> : null}
    </div>
  );
}

function MetricCardsSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 gap-4 px-4 lg:px-6 @xl/main:grid-cols-2 @5xl/main:grid-cols-4">
      {metricSlots.slice(0, count).map((slot) => (
        <Card className="py-5" key={slot}>
          <CardContent className="grid gap-4">
            <div className="flex items-start justify-between gap-4">
              <div className="grid gap-2">
                <Skeleton className="h-3 w-24" />
                <Skeleton className="h-8 w-28" />
              </div>
              <Skeleton className="size-9 rounded-full" />
            </div>
            <Skeleton className="h-3 w-36" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function TableSkeleton({ columns = 5, rows = 6 }: { columns?: number; rows?: number }) {
  return (
    <div className="min-w-0 max-w-full overflow-hidden rounded-lg border border-border/58 bg-card/38">
      <div className="hidden w-full max-w-full overflow-x-auto md:block">
        <div className="grid min-w-[48rem] gap-0">
          <div
            className="grid border-b border-border/70"
            style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
          >
            {Array.from({ length: columns }, (_, index) => (
              <div className="p-3" key={`head-${index}`}>
                <Skeleton className="h-3 w-20" />
              </div>
            ))}
          </div>
          {Array.from({ length: rows }, (_, rowIndex) => (
            <div
              className="grid border-b border-border/62 last:border-b-0"
              key={`row-${rowIndex}`}
              style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
            >
              {Array.from({ length: columns }, (_, columnIndex) => (
                <div className="p-3" key={`cell-${rowIndex}-${columnIndex}`}>
                  <Skeleton className={columnIndex === 0 ? 'h-5 w-44' : 'h-4 w-24'} />
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
      <div className="grid gap-3 p-3 md:hidden">
        {tableRows.slice(0, Math.min(rows, tableRows.length)).map((row) => (
          <Card className="py-4" key={row}>
            <CardContent className="grid gap-4">
              <div className="flex items-start justify-between gap-4">
                <Skeleton className="h-5 w-40" />
                <Skeleton className="h-6 w-16 rounded-full" />
              </div>
              <div className="grid gap-2">
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-4/5" />
              </div>
              <Skeleton className="h-9 w-full" />
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

function FilterRailSkeleton() {
  return (
    <aside className="hidden lg:block">
      <Card className="sticky top-20 py-5">
        <CardContent className="grid gap-5">
          <Skeleton className="h-4 w-24" />
          {filterRows.map((row) => (
            <div className="grid gap-2" key={row}>
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-9 w-full" />
            </div>
          ))}
        </CardContent>
      </Card>
    </aside>
  );
}

function FormSkeleton({ fields = 6 }: { fields?: number }) {
  return (
    <Card>
      <CardHeader>
        <Skeleton className="h-6 w-32" />
      </CardHeader>
      <CardContent className="grid gap-5">
        {Array.from({ length: fields }, (_, index) => (
          <div className="grid gap-2" key={`field-${index}`}>
            <Skeleton className="h-3 w-24" />
            <Skeleton className={index === 1 ? 'h-24 w-full' : 'h-10 w-full'} />
          </div>
        ))}
        <div className="flex justify-end">
          <Skeleton className="h-10 w-36" />
        </div>
      </CardContent>
    </Card>
  );
}

export function DashboardOverviewLoading() {
  return (
    <LoadingFrame className="flex flex-1 flex-col" label="Loading dashboard">
      <div className="@container/main flex flex-1 flex-col gap-2">
        <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6">
          <MetricCardsSkeleton />
          <div className="grid gap-6 px-4 lg:px-6">
            <section className="grid gap-4">
              <PageHeadingSkeleton />
              <TableSkeleton columns={5} rows={6} />
            </section>
            <section className="grid gap-4">
              <PageHeadingSkeleton />
              <TableSkeleton columns={6} rows={5} />
            </section>
          </div>
        </div>
      </div>
    </LoadingFrame>
  );
}

export function TaskListLoading() {
  return (
    <LoadingFrame
      className="@container/main grid w-full grid-cols-[minmax(0,1fr)] items-start gap-5 px-4 py-4 md:gap-6 md:py-6 lg:grid-cols-[210px_minmax(0,1fr)] lg:px-6 xl:grid-cols-[220px_minmax(0,1fr)]"
      label="Loading tasks"
    >
      <FilterRailSkeleton />
      <section className="grid w-full min-w-0 max-w-full gap-5 overflow-hidden">
        <PageHeadingSkeleton />
        <TableSkeleton columns={5} rows={6} />
      </section>
    </LoadingFrame>
  );
}

export function TaskDetailLoading() {
  return (
    <LoadingFrame
      className="mx-auto w-full max-w-7xl px-4 py-10 sm:px-6 lg:px-8"
      label="Loading task detail"
    >
      <div className="grid w-full min-w-0 gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="grid gap-6">
          <Skeleton className="h-4 w-56" />
          <section className="grid overflow-hidden rounded-lg border border-border/58 bg-card/38 md:grid-cols-2">
            <div className="grid gap-3 border-b border-border/58 p-5 md:border-r md:border-b-0">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-9 w-36" />
              <Skeleton className="h-3 w-44" />
            </div>
            <div className="grid gap-3 p-5">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-9 w-40" />
              <Skeleton className="h-3 w-36" />
            </div>
          </section>
          <Card>
            <CardContent className="grid gap-5">
              <div className="flex flex-wrap gap-2">
                <Skeleton className="h-6 w-20 rounded-full" />
                <Skeleton className="h-6 w-24 rounded-full" />
              </div>
              <Skeleton className="h-10 w-4/5" />
              <div className="grid gap-2">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-3/4" />
              </div>
            </CardContent>
          </Card>
        </div>
        <div className="grid gap-4">
          <Card>
            <CardContent className="grid gap-4">
              <Skeleton className="h-5 w-32" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </CardContent>
          </Card>
          <Card>
            <CardContent className="grid gap-3">
              <Skeleton className="h-5 w-28" />
              <Skeleton className="h-16 w-full" />
            </CardContent>
          </Card>
        </div>
      </div>
    </LoadingFrame>
  );
}

export function NewTaskLoading() {
  return (
    <LoadingFrame
      className="mx-auto grid w-full max-w-6xl gap-6 px-4 py-6 sm:px-6 lg:px-8"
      label="Loading task form"
    >
      <div className="grid gap-5 border-b border-border/75 pb-6 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-end">
        <div className="grid gap-3">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-10 w-52" />
          <Skeleton className="h-4 w-full max-w-2xl" />
        </div>
        <Skeleton className="h-20 w-full rounded-xl" />
      </div>
      <FormSkeleton fields={7} />
    </LoadingFrame>
  );
}

export function DirectoryLoading({ label = 'Loading directory' }: { label?: string }) {
  return (
    <LoadingFrame className="mx-auto grid max-w-7xl gap-6 px-4 py-10 sm:px-6 lg:px-8" label={label}>
      <PageHeadingSkeleton />
      <FormSkeleton fields={4} />
      <TableSkeleton columns={6} rows={6} />
    </LoadingFrame>
  );
}

export function LeaderboardLoading() {
  return (
    <LoadingFrame
      className="@container/main grid w-full gap-6 px-4 py-4 md:gap-6 md:py-6 lg:px-6"
      label="Loading leaderboard"
    >
      <PageHeadingSkeleton action={false} />
      <FormSkeleton fields={5} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-2">
          <Skeleton className="h-9 w-28 rounded-full" />
          <Skeleton className="h-9 w-28 rounded-full" />
        </div>
        <Skeleton className="h-3 w-16" />
      </div>
      <TableSkeleton columns={6} rows={6} />
    </LoadingFrame>
  );
}

export function AgentProfileLoading() {
  return (
    <LoadingFrame
      className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8"
      label="Loading agent profile"
    >
      <div className="grid gap-6">
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
          <Card className="overflow-hidden">
            <CardContent className="grid gap-7 pt-0">
              <div className="-mx-6 -mt-6 border-b border-border/68 bg-surface/58 px-6 py-6">
                <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
                  <Skeleton className="size-16 rounded-full" />
                  <div className="grid flex-1 gap-3">
                    <div className="flex gap-2">
                      <Skeleton className="h-6 w-20 rounded-full" />
                      <Skeleton className="h-6 w-24 rounded-full" />
                    </div>
                    <Skeleton className="h-10 w-64 max-w-full" />
                    <Skeleton className="h-4 w-80 max-w-full" />
                  </div>
                </div>
              </div>
              <div className="grid gap-3">
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
              </div>
            </CardContent>
          </Card>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
            {metricSlots.map((slot) => (
              <Card className="py-4" key={slot}>
                <CardContent className="grid gap-3">
                  <Skeleton className="size-8 rounded-full" />
                  <Skeleton className="h-3 w-24" />
                  <Skeleton className="h-7 w-20" />
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <Card>
            <CardContent className="grid gap-4">
              <Skeleton className="h-6 w-36" />
              <Skeleton className="h-64 w-full" />
            </CardContent>
          </Card>
          <Card>
            <CardContent className="grid gap-4">
              <Skeleton className="h-6 w-32" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </CardContent>
          </Card>
        </div>
      </div>
    </LoadingFrame>
  );
}

export function AccountLoading() {
  return (
    <LoadingFrame
      className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6 lg:px-8"
      label="Loading account"
    >
      <div className="mb-6 grid gap-3">
        <Skeleton className="h-8 w-36" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-4/5" />
      </div>
      <IdentityCardLoading />
    </LoadingFrame>
  );
}

export function InboxLoading() {
  return (
    <LoadingFrame
      className="mx-auto w-full max-w-5xl px-4 py-10 sm:px-6 lg:px-8"
      label="Loading inbox"
    >
      <div className="mb-6 grid gap-3">
        <Skeleton className="h-8 w-28" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      <Card>
        <CardContent className="grid gap-3">
          <Skeleton className="h-5 w-36" />
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </CardContent>
      </Card>
    </LoadingFrame>
  );
}

export function StaticDashboardLoading({ label = 'Loading page' }: { label?: string }) {
  return (
    <LoadingFrame
      className="mx-auto grid w-full max-w-7xl gap-6 px-4 py-8 sm:px-6 lg:px-8"
      label={label}
    >
      <PageHeadingSkeleton action={false} />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <Card>
          <CardContent className="grid gap-4">
            <Skeleton className="h-6 w-48" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/4" />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="grid gap-3">
            <Skeleton className="h-5 w-28" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </CardContent>
        </Card>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        {['static-1', 'static-2', 'static-3'].map((slot) => (
          <Card key={slot}>
            <CardContent className="grid gap-3">
              <Skeleton className="h-5 w-32" />
              <Skeleton className="h-24 w-full" />
            </CardContent>
          </Card>
        ))}
      </div>
    </LoadingFrame>
  );
}

export function IdentityCardLoading() {
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <Skeleton className="h-6 w-24" />
          <Skeleton className="h-6 w-16 rounded-full" />
        </div>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="grid gap-2">
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-4 w-full" />
        </div>
        <Skeleton className="h-4 w-48" />
        <Skeleton className="h-9 w-36" />
      </CardContent>
    </Card>
  );
}

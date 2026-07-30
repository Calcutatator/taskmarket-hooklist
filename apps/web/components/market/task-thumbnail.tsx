'use client';

import type { TaskResponse } from '@taskmarket/shared';
import { LayoutGrid, Rows3 } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { TaskTable } from '@/components/market/tasks';
import { Button } from '@/components/ui/button';
import { useIsMobile } from '@/hooks/use-mobile';
import {
  taskFiltersHref,
  type TaskListView,
  type TaskSearchParams,
} from '@/lib/market/task-filters';

// Table/Gallery toggle, shared by the desktop toolbar (TaskListBoard, below) and the
// mobile filter drawer (MobileTaskFilterDrawer in tasks.tsx) -- see tasks.tsx for why
// the drawer needs its own copy of this control rather than the desktop toolbar row.
export function TaskViewToggle({
  basePath = '/dashboard/tasks',
  currentFilters = {},
  view = 'table',
}: {
  basePath?: string;
  currentFilters?: TaskSearchParams;
  view?: TaskListView;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="mr-1 font-mono text-xs uppercase text-muted-foreground">View</span>
      <Button asChild size="chip" variant="chip">
        <Link
          aria-current={view === 'table' ? 'page' : undefined}
          aria-label="Table view"
          data-active={view === 'table'}
          href={
            taskFiltersHref(basePath, currentFilters, {
              cursor: undefined,
              cursorStack: undefined,
              view: 'table',
            }) as Route
          }
        >
          <Rows3 className="size-3" />
          Table
        </Link>
      </Button>
      <Button asChild size="chip" variant="chip">
        <Link
          aria-current={view === 'gallery' ? 'page' : undefined}
          aria-label="Gallery view"
          data-active={view === 'gallery'}
          href={
            taskFiltersHref(basePath, currentFilters, {
              cursor: undefined,
              cursorStack: undefined,
              view: 'gallery',
            }) as Route
          }
        >
          <LayoutGrid className="size-3" />
          Gallery
        </Link>
      </Button>
    </div>
  );
}

// Client wrapper that lets a viewer flip the task list between an image-forward gallery and the
// lightweight table. Kept here, in the client module, so TaskListPageContent (a server
// component) can stay server-rendered and simply mount this island.
export function TaskListBoard({
  basePath = '/dashboard/tasks',
  createHref,
  currentFilters = {},
  detailBasePath = '/dashboard/tasks',
  errorMessage,
  hasActiveFilters,
  listHref,
  tasks,
  toolbarStart,
  view,
}: {
  basePath?: string;
  createHref?: string;
  currentFilters?: TaskSearchParams;
  detailBasePath?: string;
  errorMessage?: string;
  hasActiveFilters?: boolean;
  listHref?: string;
  tasks: TaskResponse[];
  toolbarStart?: ReactNode;
  view?: TaskListView;
}) {
  const isMobile = useIsMobile();
  // `view` is undefined when parseTaskFilters found no explicit ?view= param --
  // TaskListPageContent runs on the server and cannot call useIsMobile itself, so it
  // leaves the choice unresolved and this client island picks a device-appropriate
  // default: gallery (media-forward) on mobile, table (lightweight) on desktop. An
  // explicit param is always authoritative regardless of device. useIsMobile()
  // resolves to `false` until its effect runs post-mount, so the first client render
  // matches the server's implicit table output exactly -- no hydration mismatch, at
  // the cost of a brief table-to-gallery flash on real mobile devices, the same
  // trade-off this codebase already accepts for the Dialog/Drawer swap in
  // artifact-preview-button.tsx and components/ui/sidebar.tsx.
  const resolvedView: TaskListView = view ?? (isMobile ? 'gallery' : 'table');
  // The toggle hides in error/empty states where there is nothing to lay out; the
  // caller-provided sort control (toolbarStart) stays visible so a filtered-to-empty
  // view can still be re-sorted. Sort and view share one toolbar row to keep the
  // vertical rhythm tight above the grid -- desktop only, since the mobile filter
  // drawer (MobileTaskFilterDrawer in tasks.tsx) carries its own copies for phones.
  const showToggle = !errorMessage && tasks.length > 0;

  return (
    <div className="grid gap-3">
      {toolbarStart || showToggle ? (
        <div
          className="hidden flex-wrap items-center justify-between gap-3 lg:flex"
          data-testid="task-toolbar"
        >
          <div className="min-w-0">{toolbarStart}</div>
          {showToggle ? (
            <TaskViewToggle
              basePath={basePath}
              currentFilters={currentFilters}
              view={resolvedView}
            />
          ) : null}
        </div>
      ) : null}
      <TaskTable
        createHref={createHref}
        detailBasePath={detailBasePath}
        errorMessage={errorMessage}
        hasActiveFilters={hasActiveFilters}
        listHref={listHref}
        tasks={tasks}
        view={resolvedView}
      />
    </div>
  );
}

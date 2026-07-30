'use client';

import type { TaskResponse } from '@taskmarket/shared';
import { LayoutGrid, Rows3 } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { TaskTable } from '@/components/market/tasks';
import { Button } from '@/components/ui/button';
import {
  taskFiltersHref,
  type TaskListView,
  type TaskSearchParams,
} from '@/lib/market/task-filters';

// Table/Gallery toggle shared by the compact mobile browse toolbar and desktop board.
// The mobile presentation changes layout and copy, but URL and active-state behaviour
// stay in one place.
export function TaskViewToggle({
  basePath = '/dashboard/tasks',
  currentFilters = {},
  presentation = 'desktop',
  view = 'table',
}: {
  basePath?: string;
  currentFilters?: TaskSearchParams;
  presentation?: 'desktop' | 'mobile';
  view?: TaskListView;
}) {
  const mobile = presentation === 'mobile';
  const controlClassName = mobile ? 'h-11 min-h-11 w-full px-0 sm:h-11 sm:min-h-11' : undefined;

  return (
    <div
      aria-label={mobile ? 'Task view' : undefined}
      className={mobile ? 'col-span-2 grid grid-cols-2 gap-2' : 'flex items-center gap-1.5'}
      role={mobile ? 'group' : undefined}
    >
      {mobile ? null : (
        <span className="mr-1 font-mono text-xs uppercase text-muted-foreground">View</span>
      )}
      <Button asChild className={controlClassName} size="chip" variant="chip">
        <Link
          aria-current={view === 'table' ? 'page' : undefined}
          aria-label={mobile ? 'List view' : 'Table view'}
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
          {mobile ? <span className="sr-only">List</span> : 'Table'}
        </Link>
      </Button>
      <Button asChild className={controlClassName} size="chip" variant="chip">
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
          {mobile ? <span className="sr-only">Gallery</span> : 'Gallery'}
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
  // The compact table/card layout is the deterministic default on every viewport.
  // Gallery remains available when the URL carries the explicit preference, without
  // a post-hydration viewport check that swaps the feed after first paint.
  const resolvedView: TaskListView = view ?? 'table';
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

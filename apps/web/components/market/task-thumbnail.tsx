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
  view = 'table',
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
  // The toggle hides in error/empty states where there is nothing to lay out; the
  // caller-provided sort control (toolbarStart) stays visible so a filtered-to-empty
  // view can still be re-sorted. Sort and view share one toolbar row to keep the
  // vertical rhythm tight above the grid.
  const showToggle = !errorMessage && tasks.length > 0;

  return (
    <div className="grid gap-3">
      {toolbarStart || showToggle ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">{toolbarStart}</div>
          {showToggle ? (
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
        view={view}
      />
    </div>
  );
}

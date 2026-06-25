'use client';

import type { TaskResponse } from '@taskmarket/shared';
import { LayoutGrid, Rows3 } from 'lucide-react';
import { useEffect, useState } from 'react';

import { TaskTable, type TaskListView } from '@/components/market/tasks';
import { Button } from '@/components/ui/button';

// Persisted view preference. Gallery is the default first paint (SSR-safe), and a viewer who
// previously chose the table is restored to it after mount. The key is namespaced so it does
// not collide with other surfaces.
const VIEW_STORAGE_KEY = 'taskmarket.task-list-view';

function isTaskListView(value: string | null): value is TaskListView {
  return value === 'table' || value === 'gallery';
}

// Client wrapper that lets a viewer flip the task list between an image-forward gallery and the
// lightweight table. Kept here, in the client module, so TaskListPageContent (a server
// component) can stay server-rendered and simply mount this island.
//
// SSR safety: useState initialises to the SSR default ('gallery') so the server HTML and the
// first client render agree (no hydration mismatch). A useEffect then reads localStorage on the
// client and restores a previously stored choice only when it is a valid, different value.
export function TaskListBoard({
  createHref,
  detailBasePath = '/dashboard/tasks',
  errorMessage,
  hasActiveFilters,
  listHref,
  tasks,
}: {
  createHref?: string;
  detailBasePath?: string;
  errorMessage?: string;
  hasActiveFilters?: boolean;
  listHref?: string;
  tasks: TaskResponse[];
}) {
  const [view, setView] = useState<TaskListView>('gallery');

  // Restore the persisted preference after mount. Guarded for storage being unavailable
  // (private browsing / blocked storage) so the shell never breaks.
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(VIEW_STORAGE_KEY);
      if (isTaskListView(stored) && stored !== view) {
        setView(stored);
      }
    } catch {
      // Ignore storage failures and keep the gallery default.
    }
    // Run once on mount; the dependency on `view` is intentionally omitted so a later toggle
    // does not re-read storage and clobber the user's in-session choice.
  }, []);

  function selectView(next: TaskListView) {
    setView(next);
    try {
      window.localStorage.setItem(VIEW_STORAGE_KEY, next);
    } catch {
      // Ignore storage failures so the toggle still works in-session.
    }
  }

  return (
    <div className="grid gap-3">
      {/* Hide the toggle in error/empty states where there is nothing to lay out. */}
      {!errorMessage && tasks.length > 0 ? (
        <div className="flex items-center justify-end gap-1.5">
          <span className="mr-1 font-mono text-xs uppercase text-muted-foreground">View</span>
          <Button
            aria-label="Table view"
            aria-pressed={view === 'table'}
            data-active={view === 'table'}
            onClick={() => selectView('table')}
            size="chip"
            type="button"
            variant="chip"
          >
            <Rows3 className="size-3" />
            Table
          </Button>
          <Button
            aria-label="Gallery view"
            aria-pressed={view === 'gallery'}
            data-active={view === 'gallery'}
            onClick={() => selectView('gallery')}
            size="chip"
            type="button"
            variant="chip"
          >
            <LayoutGrid className="size-3" />
            Gallery
          </Button>
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

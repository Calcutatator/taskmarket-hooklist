import { useMemo, useState } from 'react';
import { Link, useSearch } from '@tanstack/react-router';
import { trpc } from '@/contexts/TRPCProvider';
import { TerminalButton, TerminalSection } from '../landing/terminal';
import { TaskBrowseFilters } from '../tasks/TaskBrowseFilters';
import { TaskBrowseTable } from '../tasks/TaskBrowseTable';
import {
  DEFAULT_TASK_FILTERS,
  parseTags,
  toBaseUnits,
  type TaskListFilters,
} from '../tasks/taskBrowseUtils';

export function TasksView() {
  const { q } = useSearch({ from: '/tasks/' });
  const [filters, setFilters] = useState<TaskListFilters>(DEFAULT_TASK_FILTERS);

  const handleFilterChange = (key: keyof TaskListFilters, value: string) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
  };

  const handleClearFilters = () => {
    setFilters(DEFAULT_TASK_FILTERS);
  };

  const { data, isLoading, error, fetchNextPage, hasNextPage, isFetchingNextPage } =
    trpc.tasks.list.useInfiniteQuery(
      {
        mode: filters.mode as 'ALL' | 'bounty' | 'claim' | 'pitch' | 'benchmark' | 'auction',
        status: filters.status as
          | 'ALL'
          | 'open'
          | 'claimed'
          | 'worker_selected'
          | 'pending_approval'
          | 'completed'
          | 'expired'
          | 'disputed',
        tags: parseTags(filters.tags),
        minReward: toBaseUnits(filters.minReward) || undefined,
        maxReward: toBaseUnits(filters.maxReward) || undefined,
        deadlineHours: filters.deadlineHours ? Number(filters.deadlineHours) : undefined,
      },
      {
        initialCursor: undefined,
        getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
      }
    );

  const allTasks = data?.pages.flatMap((page) => page.tasks) ?? [];
  const searchLower = q?.toLowerCase() ?? '';
  const tasks = useMemo(
    () =>
      searchLower
        ? allTasks.filter((task) => task.description.toLowerCase().includes(searchLower))
        : allTasks,
    [allTasks, searchLower]
  );

  return (
    <div className="tm-page">
      <TerminalSection eyebrow="Task marketplace" contentClassName="py-8 lg:py-10">
        <div className="tm-divider flex flex-col gap-5 border-b pb-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="mt-2 font-heading text-4xl font-semibold tracking-tight text-text-primary">
              Browse tasks
            </h1>
            <p className="tm-muted mt-3 max-w-2xl text-sm">
              Filter active marketplace work by mode, reward, status, tag, and deadline.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {q && (
              <Link
                to="/tasks"
                className="tm-muted font-mono text-xs underline-offset-4 hover:text-button-primary-bg hover:underline"
              >
                clear search: {q}
              </Link>
            )}
            <TerminalButton to="/tasks/new" variant="default">
              Create task
            </TerminalButton>
          </div>
        </div>

        <div className="mt-6 grid gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
          <TaskBrowseFilters
            filters={filters}
            onFilterChange={handleFilterChange}
            onClear={handleClearFilters}
          />
          <div className="min-w-0">
            <div className="tm-faint mb-3 flex flex-col gap-2 font-mono text-xs sm:flex-row sm:items-center sm:justify-between">
              <span>
                <b className="font-medium text-text-primary">{tasks.length}</b> tasks
              </span>
            </div>
            <TaskBrowseTable
              tasks={tasks}
              isLoading={isLoading}
              errorMessage={error?.message}
              hasNextPage={hasNextPage}
              isFetchingNextPage={isFetchingNextPage}
              onLoadMore={() => fetchNextPage()}
            />
          </div>
        </div>
      </TerminalSection>
    </div>
  );
}

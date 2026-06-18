import type { Metadata } from 'next';

import { TaskListPageContent } from '@/components/market/tasks';
import { ApiConnectionError, fetchTasks } from '@/lib/api/server';
import { parseTaskFilters } from '@/lib/market/task-filters';
import { buildPageMetadata } from '@/lib/seo';

export const metadata: Metadata = buildPageMetadata({
  description:
    'Browse open Taskmarket work across bounties, claims, pitches, benchmarks, and auctions.',
  path: '/tasks',
  title: 'Open tasks',
});

type TasksPageProps = {
  searchParams: Promise<{
    actor?: string;
    deadlineHours?: string;
    maxReward?: string;
    minReward?: string;
    mode?: string;
    requester?: string;
    status?: string;
    tags?: string;
    worker?: string;
  }>;
};

export default async function TasksPage({ searchParams }: TasksPageProps) {
  const params = await searchParams;
  const filters = parseTaskFilters(params);

  let tasks: Awaited<ReturnType<typeof fetchTasks>>['tasks'] = [];
  let errorMessage: string | undefined;
  try {
    const taskList = await fetchTasks({
      deadlineHours: filters.deadlineHours,
      limit: 40,
      maxReward: filters.maxReward,
      minReward: filters.minReward,
      mode: filters.mode,
      requester: filters.requester,
      requesterActorType: filters.actor,
      status: filters.status,
      tags: filters.tags,
      worker: filters.worker,
    });
    tasks = taskList.tasks;
  } catch (error) {
    if (!(error instanceof ApiConnectionError)) {
      throw error;
    }
    errorMessage = 'Could not load tasks right now. The marketplace API may be unavailable.';
  }

  return (
    <TaskListPageContent
      activeFilters={filters.activeFilters}
      basePath="/tasks"
      createHref="/dashboard/tasks/new"
      detailBasePath="/tasks"
      errorMessage={errorMessage}
      filterParams={{
        deadlineHours: params.deadlineHours,
        maxReward: params.maxReward,
        minReward: params.minReward,
        selectedActor: filters.selectedActor,
        selectedMode: filters.selectedMode,
        selectedStatus: filters.selectedStatus,
        tags: params.tags,
      }}
      listHref="/tasks"
      tasks={tasks}
    />
  );
}

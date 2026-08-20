import type { Metadata } from 'next';

import { TaskListPageContent } from '@/components/market/tasks';
import { ApiConnectionError, fetchTasks } from '@/lib/api/server';
import { parseTaskFilters, type TaskSearchParams } from '@/lib/market/task-filters';
import { buildStaticPageMetadata } from '@/lib/static-og';

export const metadata: Metadata = buildStaticPageMetadata('tasks');

type TasksPageProps = {
  searchParams: Promise<TaskSearchParams>;
};

export default async function TasksPage({ searchParams }: TasksPageProps) {
  const params = await searchParams;
  const filters = parseTaskFilters(params);

  let taskList: Awaited<ReturnType<typeof fetchTasks>> = {
    hasMore: false,
    nextCursor: null,
    tasks: [],
  };
  let errorMessage: string | undefined;
  try {
    taskList = await fetchTasks({
      cursor: filters.selectedSort === 'newest' ? params.cursor : undefined,
      deadlineHours: filters.deadlineHours,
      limit: 40,
      maxReward: filters.maxReward,
      minReward: filters.minReward,
      mode: filters.mode,
      q: filters.q,
      requester: filters.requester,
      requesterActorType: filters.actor,
      sort: filters.sort,
      status: filters.status,
      tags: filters.tags,
      taskDropId: filters.taskDropId,
      worker: filters.worker,
    });
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
        selectedSort: filters.selectedSort,
        selectedStatus: filters.selectedStatus,
        selectedView: filters.selectedView,
        q: params.q,
        tags: params.tags,
        taskDropId: filters.taskDropId,
        requester: filters.requester,
        worker: filters.worker,
      }}
      listHref="/tasks"
      pagination={{
        currentCursor: params.cursor,
        cursorStack: params.cursorStack,
        hasMore: taskList.hasMore,
        nextCursor: taskList.nextCursor,
      }}
      tasks={taskList.tasks}
    />
  );
}

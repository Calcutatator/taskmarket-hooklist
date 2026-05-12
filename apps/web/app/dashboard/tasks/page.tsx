import type { Metadata } from 'next';

import { TaskListPageContent } from '@/components/market/tasks';
import { fetchTasks } from '@/lib/api/server';
import { parseTaskFilters } from '@/lib/market/task-filters';
import { buildDashboardPageMetadata } from '@/lib/seo';

export const metadata: Metadata = buildDashboardPageMetadata({
  description:
    'Browse open Taskmarket work across bounties, claims, pitches, benchmarks, and auctions.',
  path: '/dashboard/tasks',
  title: 'Open tasks',
});

type TasksPageProps = {
  searchParams: Promise<{
    deadlineHours?: string;
    maxReward?: string;
    minReward?: string;
    mode?: string;
    status?: string;
    tags?: string;
  }>;
};

export default async function TasksPage({ searchParams }: TasksPageProps) {
  const params = await searchParams;
  const filters = parseTaskFilters(params);
  const taskList = await fetchTasks({
    deadlineHours: filters.deadlineHours,
    limit: 40,
    maxReward: filters.maxReward,
    minReward: filters.minReward,
    mode: filters.mode,
    status: filters.status,
    tags: filters.tags,
  });

  return (
    <TaskListPageContent
      activeFilters={filters.activeFilters}
      filterParams={{
        deadlineHours: params.deadlineHours,
        maxReward: params.maxReward,
        minReward: params.minReward,
        selectedMode: filters.selectedMode,
        selectedStatus: filters.selectedStatus,
        tags: params.tags,
      }}
      tasks={taskList.tasks}
    />
  );
}

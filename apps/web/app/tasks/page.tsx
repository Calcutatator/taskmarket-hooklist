import type { Route } from 'next';
import { redirect } from 'next/navigation';

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
  const query = new URLSearchParams();
  if (params.mode) {
    query.set('mode', params.mode);
  }
  if (params.status) {
    query.set('status', params.status);
  }
  if (params.tags) {
    query.set('tags', params.tags);
  }
  if (params.minReward) {
    query.set('minReward', params.minReward);
  }
  if (params.maxReward) {
    query.set('maxReward', params.maxReward);
  }
  if (params.deadlineHours) {
    query.set('deadlineHours', params.deadlineHours);
  }

  redirect(`/dashboard/tasks${query.size > 0 ? `?${query.toString()}` : ''}` as Route);
}

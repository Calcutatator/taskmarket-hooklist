import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { cache } from 'react';

import { TaskDetailPanel } from '@/components/market/tasks';
import { fetchTask, fetchTaskModeData } from '@/lib/api/server';
import { buildPageMetadata, buildTaskMetadata, decodeRouteParam } from '@/lib/seo';

type TaskDetailPageProps = {
  params: Promise<{
    taskId: string;
  }>;
};

const getTask = cache(fetchTask);

export async function generateMetadata({ params }: TaskDetailPageProps): Promise<Metadata> {
  const { taskId } = await params;
  const decodedTaskId = decodeRouteParam(taskId);

  try {
    const task = await getTask(decodedTaskId);
    if (task) {
      return buildTaskMetadata(task);
    }
  } catch {
    return buildPageMetadata({
      description: 'Browse this Taskmarket task and related marketplace details.',
      path: `/tasks/${encodeURIComponent(decodedTaskId)}`,
      title: 'Taskmarket task',
    });
  }

  return buildPageMetadata({
    description: 'Browse open Taskmarket work across all marketplace modes.',
    path: '/tasks',
    title: 'Task not found',
  });
}

export default async function TaskDetailPage({ params }: TaskDetailPageProps) {
  const { taskId } = await params;
  const task = await getTask(decodeRouteParam(taskId));

  if (!task) {
    notFound();
  }

  const modeData = await fetchTaskModeData(task);

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
      <TaskDetailPanel backHref="/tasks" modeData={modeData} task={task} />
    </div>
  );
}

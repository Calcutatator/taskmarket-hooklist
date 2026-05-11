import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { cache } from 'react';

import { TaskDetailPanel } from '@/components/market/tasks';
import {
  fetchTask,
  fetchTaskBids,
  fetchTaskClaim,
  fetchTaskPitches,
  fetchTaskProofs,
  fetchTaskSubmissions,
} from '@/lib/api/server';
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

  const [submissions, pitches, proofs, bids, claim] = await Promise.all([
    task.mode === 'bounty' || task.mode === 'claim' ? fetchTaskSubmissions(task.id) : [],
    task.mode === 'pitch' ? fetchTaskPitches(task.id) : [],
    task.mode === 'benchmark' ? fetchTaskProofs(task.id) : [],
    task.mode === 'auction' ? fetchTaskBids(task.id) : [],
    task.mode === 'claim' ? fetchTaskClaim(task.id) : null,
  ]);

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
      <TaskDetailPanel
        backHref="/tasks"
        modeData={{ bids, claim, pitches, proofs, submissions }}
        task={task}
      />
    </div>
  );
}
